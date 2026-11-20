-- Restaura o corpo da base de vendas da 20261399990000 e os dois corpos da
-- 20261403000000, sem mudar dados nem grants.

CREATE OR REPLACE FUNCTION public.crm__vendas(p_ate timestamptz)
RETURNS TABLE (
  order_id uuid, total numeric, canal text, forma text, pago_em timestamptz, dia date,
  chave text, user_id uuid, nome text, whatsapp text, email text
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH base AS (
    SELECT o.id, o.total::numeric AS total, o.canal, o.user_id, o.customer_name,
           public.fin__forma_do_pedido(o.payment_method, o.metodo_online) AS forma,
           COALESCE(o.pagamento_recebido_em, o.paid_at) AS pago_em,
           NULLIF(regexp_replace(COALESCE(o.customer_data ->> 'whatsapp', ''), '\D', '', 'g'), '') AS wa,
           NULLIF(btrim(COALESCE(o.customer_data ->> 'email', '')), '') AS email
      FROM public.marketplace_orders o
     WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
       AND o.status NOT IN ('cancelled', 'returned')
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) <= p_ate
  ), base_chave AS (
    -- O MESMO WhatsApp gravado uma vez com o 55 (balcao, "+55...") e outra sem (conta, "(34)...") e UM comprador: a chave e a fusao comparam o
    -- numero SEM o 55 quando ele tem DDI (12 ou 13 digitos comecando por 55), a mesma expressao de crm__pedidos_nao_pagos e crm__nunca_comprou
    -- (20261183000000, N4). O DDD 55 com 11 digitos nao perde o 55. `wa` (o que se exibe) continua o numero original do pedido.
    SELECT b.*,
           CASE WHEN length(b.wa) IN (12, 13) AND left(b.wa, 2) = '55'
                THEN substring(b.wa FROM 3) ELSE b.wa END AS wa_chave
      FROM base b
  ), wa_da_conta AS (
    SELECT DISTINCT ON (b.wa_chave) b.wa_chave, b.user_id
      FROM base_chave b
     WHERE b.wa_chave IS NOT NULL AND b.user_id IS NOT NULL
     ORDER BY b.wa_chave, b.pago_em DESC
  )
  SELECT b.id, b.total, b.canal, b.forma, b.pago_em, public.fin__dia(b.pago_em),
         COALESCE(b.user_id::text, w.user_id::text, CASE WHEN b.wa_chave IS NOT NULL THEN 'wa:' || b.wa_chave END),
         COALESCE(b.user_id, w.user_id),
         NULLIF(btrim(b.customer_name), ''), b.wa, b.email
    FROM base_chave b
    LEFT JOIN wa_da_conta w ON w.wa_chave = b.wa_chave AND b.user_id IS NULL
$$;

CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(p_search text DEFAULT ''::text, p_sort_field text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;

    -- Global stats variables
    v_global_total_customers BIGINT;
    v_global_new_customers_30d BIGINT;
    v_global_ltv NUMERIC;
    v_global_orders BIGINT;
    v_stats JSONB;
    v_clean_search TEXT;
    v_search_digitos TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    -- So os digitos do que a pessoa digitou (o WhatsApp e' gravado MASCARADO, "(34) 99999-1234", e a
    -- comparacao crua de texto nunca casava quem digitava so os numeros). Com 12 ou 13 digitos que
    -- comecam por 55 (o +55 do Brasil colado do WhatsApp), o 55 sai: o cadastro nao o guarda.
    v_search_digitos := regexp_replace(COALESCE(v_clean_search, ''), '[^0-9]', '', 'g');
    IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN
        v_search_digitos := substr(v_search_digitos, 3);
    END IF;

    -- Calculate global stats (not filtered by search for global dashboard consistency)
    SELECT COUNT(id) INTO v_global_total_customers
    FROM public.profiles;

    SELECT COUNT(id) INTO v_global_new_customers_30d
    FROM public.profiles
    WHERE created_at >= NOW() - INTERVAL '30 days';

    SELECT COUNT(id) INTO v_global_orders
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    -- LTV global: mesma correção do achado 17, dinheiro reconhecido só.
    SELECT COALESCE(SUM(total::numeric), 0) INTO v_global_ltv
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    v_stats := JSONB_BUILD_OBJECT(
        'total_customers', v_global_total_customers,
        'new_customers_30d', v_global_new_customers_30d,
        'global_ltv', v_global_ltv,
        'global_orders', v_global_orders
    );

    -- CTE to gather aggregated stats per customer with unaccent filtering and pagination count
    -- Compras de balcao (SEM conta) que o CRM atribui a cada conta (20261403000000): a regra de "quem e a mesma pessoa" mora em
    -- crm__vendas (o MESMO WhatsApp, com ou sem o 55, de um pedido pago da conta) e e LIDA daqui, nunca repetida. So o pedido sem
    -- conta (bo.user_id IS NULL) entra: o pedido da propria conta ja e somado pelo JOIN com marketplace_orders mais abaixo, entao
    -- nada conta duas vezes. Uma linha por conta, juntada UMA vez (nao ha subconsulta por cliente); MATERIALIZED garante uma unica
    -- avaliacao de crm__vendas por chamada. Com o WhatsApp em duas contas o balcao vai para UMA so (a que comprou por ultimo, regra do CRM).
    WITH balcao_da_conta AS MATERIALIZED (
        SELECT v.user_id, COUNT(*) AS pedidos, COALESCE(SUM(v.total), 0) AS total
        FROM public.crm__vendas(now()) v
        JOIN public.marketplace_orders bo ON bo.id = v.order_id AND bo.user_id IS NULL
        WHERE v.user_id IS NOT NULL
        GROUP BY v.user_id
    ),
    customer_stats AS (
        SELECT
            p.id,
            u.email,
            p.full_name,
            COALESCE(p.whatsapp, u.phone) as phone,
            p.role,
            p.created_at,
            p.avatar_url,
            addr.city,
            addr.state,
            EXISTS (
                SELECT 1
                FROM public.push_subscriptions
                WHERE user_id = p.id
            ) as is_push_subscribed,
            COUNT(o.id) + COALESCE(bal.pedidos, 0) as orders_count,
            -- LTV por cliente: só dinheiro reconhecido (achado 17). O CASE
            -- fica dentro do SUM, e não na condição do JOIN, de propósito:
            -- orders_count e last_order_date continuam contando qualquer
            -- pedido não cancelado/devolvido, a mesma regra da coluna
            -- "Pedidos" e da ficha do cliente (achado 5).
            COALESCE(SUM(
                CASE
                    WHEN o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
                    THEN o.total::numeric
                    ELSE 0
                END
            ), 0) + COALESCE(bal.total, 0) as total_spent,
            MAX(o.created_at) as last_order_date
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        -- UM endereco principal por cliente (o mais novo; no empate, o de menor id) ANTES de juntar os pedidos: dois
        -- enderecos is_default na mesma conta (dois aparelhos salvando o primeiro endereco ao mesmo tempo) dobravam a
        -- contagem e a soma dos pedidos, ou repetiam a cliente uma vez por cidade (20261399993000).
        LEFT JOIN LATERAL (
            SELECT a.city, a.state
            FROM public.user_addresses a
            WHERE a.user_id = p.id AND a.is_default = true
            ORDER BY a.created_at DESC NULLS LAST, a.id
            LIMIT 1
        ) addr ON true
        LEFT JOIN balcao_da_conta bal ON bal.user_id = p.id
        LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
        WHERE (
            v_clean_search = '' OR (
                unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(u.email) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(u.phone) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR
                -- TELEFONE por DIGITOS, nos dois lados, so com 4 ou mais digitos (a mesma regra da
                -- busca de pedidos e do CRM: com menos, um digito solto casaria quase todo mundo).
                (length(v_search_digitos) >= 4 AND (
                    regexp_replace(COALESCE(p.whatsapp, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%' OR
                    regexp_replace(COALESCE(u.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%'
                )) OR
                unaccent(addr.city) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(addr.state) ILIKE unaccent('%' || v_clean_search || '%')
            )
        )
        GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state, bal.pedidos, bal.total
    ),
    sorted_data AS (
        SELECT *, COUNT(*) OVER() as full_count FROM customer_stats
        ORDER BY
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    WHEN p_sort_field = 'city' THEN city
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    WHEN p_sort_field = 'city' THEN city
                    ELSE NULL
                END
            END DESC,
            -- Numeric ordering
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE
                    WHEN p_sort_field = 'total_spent' THEN total_spent
                    WHEN p_sort_field = 'orders_count' THEN orders_count::NUMERIC
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE
                    WHEN p_sort_field = 'total_spent' THEN total_spent
                    WHEN p_sort_field = 'orders_count' THEN orders_count::NUMERIC
                    ELSE NULL
                END
            END DESC,
            -- Temporal ordering
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE
                    WHEN p_sort_field = 'created_at' THEN created_at
                    WHEN p_sort_field = 'last_order_date' THEN last_order_date
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE
                    WHEN p_sort_field = 'created_at' THEN created_at
                    WHEN p_sort_field = 'last_order_date' THEN last_order_date
                    ELSE NULL
                END
            END DESC,
            -- Desempate pelo id (unico): sem ele, quem empata no criterio escolhido (toda conta nova
            -- tem total 0) sai numa ordem que pode mudar de uma chamada para outra, e a paginacao por
            -- OFFSET repete a mesma cliente em duas paginas e esconde outra (20261392000000).
            id
    ),
    paginated_data AS (
        SELECT *
        FROM sorted_data
        LIMIT p_page_size
        OFFSET v_offset
    )
    SELECT
        COALESCE((SELECT full_count FROM sorted_data LIMIT 1), 0),
        COALESCE(jsonb_agg(pd), '[]'::JSONB)
    INTO v_total_count, v_data
    FROM paginated_data pd;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'stats', v_stats
    );
END;
$$;

-- O literal E conserva os quatro espaços de fim de linha do corpo anterior.
CREATE OR REPLACE FUNCTION public.get_admin_user_detail(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS E'
DECLARE
    v_profile JSONB;
    v_orders JSONB;
    v_cart_items JSONB;
    v_addresses JSONB;
    v_balcao JSONB;
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION ''Acesso negado: privilégios de administrador necessários.'';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION ''Acesso negado: privilégios de administrador necessários.'';
    END IF;

    -- 1. Fetch profile info (join auth.users to get email)
    SELECT JSONB_BUILD_OBJECT(
        ''id'', p.id,
        ''full_name'', p.full_name,
        ''avatar_url'', p.avatar_url,
        ''whatsapp'', p.whatsapp,
        ''role'', p.role,
        ''created_at'', p.created_at,
        ''email'', u.email
    ) INTO v_profile
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_user_id;

    -- 2. Fetch marketplace orders (including order items)
    SELECT COALESCE(JSONB_AGG(o_data), ''[]''::JSONB) INTO v_orders
    FROM (
        SELECT\x20
            mo.*,
            COALESCE(
                (
                    SELECT JSONB_AGG(item)\x20
                    FROM public.marketplace_order_items item\x20
                    WHERE item.order_id = mo.id
                ),\x20
                ''[]''::JSONB
            ) as items
        FROM public.marketplace_orders mo
        WHERE mo.user_id = p_user_id
        ORDER BY mo.created_at DESC
    ) o_data;

    -- 3. Fetch cart items
    SELECT COALESCE(JSONB_AGG(c), ''[]''::JSONB) INTO v_cart_items
    FROM public.cart_items c
    WHERE c.user_id = p_user_id;

    -- 4. Fetch user addresses
    SELECT COALESCE(JSONB_AGG(a), ''[]''::JSONB) INTO v_addresses
    FROM public.user_addresses a
    WHERE a.user_id = p_user_id;

    -- 5. Compras de balcao que o CRM atribui a esta pessoa (20261403000000): pedidos pagos SEM conta feitos com o MESMO WhatsApp de um
    -- pedido pago desta conta (com ou sem o 55). A regra de identidade e a de crm__vendas, lida daqui e nunca copiada. Campo SEPARADO:
    -- a lista de pedidos acima nao muda (so os pedidos da conta aparecem nela). Sem balcao: pedidos 0 e total 0 (nunca nulo).
    SELECT jsonb_build_object(''pedidos'', COUNT(*), ''total'', COALESCE(SUM(v.total), 0)) INTO v_balcao
    FROM public.crm__vendas(now()) v
    JOIN public.marketplace_orders bo ON bo.id = v.order_id AND bo.user_id IS NULL
    WHERE v.user_id = p_user_id;

    -- Return Consolidated Object
    RETURN JSONB_BUILD_OBJECT(
        ''profile'', v_profile,
        ''orders'', v_orders,
        ''cart_items'', v_cart_items,
        ''addresses'', v_addresses,
        ''balcao_mesmo_whatsapp'', v_balcao
    );
END;
';

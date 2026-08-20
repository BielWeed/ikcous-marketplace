-- O LTV de cada cliente, na lista de Clientes, passa a contar só dinheiro
-- reconhecido (achado 17 da auditoria do painel, 20/08/2026).
--
-- O DEFEITO, MEDIDO NA FONTE
--   `get_admin_customers_paged` soma `total_spent` de todo pedido do cliente
--   com `status NOT IN ('cancelled', 'returned')`, sem olhar `payment_status`.
--   Todo pedido do checkout nasce `status='pending'` + `payment_status=
--   'aguardando'` e tem 30 minutos para ser pago (ou o pg_cron cancela). Um
--   cliente que gerou um PIX e ainda não pagou entra na soma como se já
--   tivesse gasto o dinheiro — a mesma raiz do achado 2/3 que a migration
--   20260822000100 já fechou em `get_admin_analytics_v2`, num lugar que
--   aquela correção não alcança: aqui ninguém mais calcula gasto por cliente.
--
-- A REGRA, A MESMA DE 20260822000100 — NÃO É REGRA NOVA
--   status NOT IN ('cancelled', 'returned')
--   AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'))
--
--   payment_status IS NULL CONTA, de propósito: NULL significa "sem cobrança
--   online" (pedido pago na entrega, pedido histórico), não "não pago". Ficam
--   de fora 'aguardando', 'recusado', 'expirado' e 'estornado'.
--
-- ONDE ENTRA, E ONDE NÃO ENTRA — E POR QUÊ
--   ENTRA em `total_spent` (a CTE `customer_stats`, por cliente) e em
--   `v_global_ltv` (o agregado global de `v_stats`, a MESMA soma sem recorte
--   por cliente — mesmo defeito, mesmo lugar certo de corrigir).
--
--   NÃO ENTRA em `orders_count` (por cliente) nem em `v_global_orders`
--   (global). Achado 17 é só sobre DINHEIRO ("LTV Total"): a coluna "Pedidos"
--   da mesma tela já foi acertada pelo achado 5 (commit 76de007) para contar
--   pela MESMA regra que `AdminUserDetailView.tsx` usa (`status NOT IN
--   ('cancelled','returned')`, sem olhar pagamento) — os dois lugares que
--   mostram "quantos pedidos" continuam de acordo um com o outro. Se a
--   contagem também passasse a exigir pagamento, o card "Cesta / Pedidos" da
--   ficha (que não muda nesta migration) voltaria a discordar da lista, que é
--   exatamente o achado 5 que acabou de ser fechado.
--
--   Por isso a correção NÃO troca a condição do LEFT JOIN (que alimenta
--   COUNT(o.id) e SUM(o.total) ao mesmo tempo): o filtro de pagamento entra
--   só dentro do SUM, com CASE, para não mexer em orders_count nem em
--   last_order_date.
--
-- O QUE NÃO MUDA
--   Assinatura (p_search, p_sort_field, p_sort_direction, p_page,
--   p_page_size), SECURITY DEFINER, SET search_path, a guarda is_admin() no
--   topo, orders_count, last_order_date, a ordenação, a paginação, a busca
--   por unaccent, v_global_total_customers, v_global_new_customers_30d e
--   v_global_orders. `total_customers` e `new_customers_30d` (os únicos dois
--   campos de `stats` que a tela ainda lê — `global_ltv` e `global_orders`
--   ficaram sem leitor depois do achado 4, ver AdminCustomersView.tsx:234-297)
--   continuam intocados.
--
-- Sem BEGIN/COMMIT, de propósito: com eles o ROLLBACK do script de prova
-- vira no-op e a mudança fica gravada mesmo assim.
-- Prova: node scripts/db-prove-ltv-cliente-dinheiro-real.cjs

CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(p_search text DEFAULT ''::text, p_sort_field text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

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
    AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'));

    v_stats := JSONB_BUILD_OBJECT(
        'total_customers', v_global_total_customers,
        'new_customers_30d', v_global_new_customers_30d,
        'global_ltv', v_global_ltv,
        'global_orders', v_global_orders
    );

    -- CTE to gather aggregated stats per customer with unaccent filtering and pagination count
    WITH customer_stats AS (
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
            COUNT(o.id) as orders_count,
            -- LTV por cliente: só dinheiro reconhecido (achado 17). O CASE
            -- fica dentro do SUM, e não na condição do JOIN, de propósito:
            -- orders_count e last_order_date continuam contando qualquer
            -- pedido não cancelado/devolvido, a mesma regra da coluna
            -- "Pedidos" e da ficha do cliente (achado 5).
            COALESCE(SUM(
                CASE
                    WHEN o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar')
                    THEN o.total::numeric
                    ELSE 0
                END
            ), 0) as total_spent,
            MAX(o.created_at) as last_order_date
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        LEFT JOIN public.user_addresses addr ON addr.user_id = p.id AND addr.is_default = true
        LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
        WHERE (
            v_clean_search = '' OR (
                unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(u.email) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(u.phone) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(addr.city) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(addr.state) ILIKE unaccent('%' || v_clean_search || '%')
            )
        )
        GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state
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
            END DESC
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
$function$;

-- Desfaz a 20261403000000: devolve os DOIS corpos anteriores BYTE A BYTE (get_admin_customers_paged, o da 20261399993000; get_admin_user_detail, o da
-- 20261199000000). Com ele a lista de Clientes e a ficha voltam a somar so os pedidos da conta (o balcao com o mesmo WhatsApp deixa de entrar) e a ficha
-- deixa de trazer 'balcao_mesmo_whatsapp'. Nenhum dado e tocado: so a LEITURA muda. Desfazer esta ANTES do rollback da 20261399993000.
-- Pre-voo fechado: so aceita, em cada funcao, o corpo desta migration ou o anterior (reaplicar o rollback e inofensivo); qualquer outro corpo,
-- atributo ou ACL recusa SEM escrever. Nenhum GRANT nem REVOKE. Sem BEGIN/COMMIT: a transacao pertence ao aplicador.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rb_20261403000000$
DECLARE
  v_oid_lista oid := to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
  v_oid_ficha oid := to_regprocedure('public.get_admin_user_detail(uuid)');
  v_hash text;
  v_atributos jsonb;
  r record;
BEGIN
  -- ---- existem, uma so de cada nome ----
  IF v_oid_lista IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.get_admin_customers_paged(text,text,text,integer,integer) não existe.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_customers_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_customers_paged tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;
  IF v_oid_ficha IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.get_admin_user_detail(uuid) não existe.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_user_detail') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_user_detail tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- ---- corpo identificado pelo CONTEUDO: o anterior (desfaz) ou o desta migration (desfaz) ou o anterior (ja desfeito) ----
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.get_admin_customers_paged(text,text,text,integer,integer)', '35212d373895b2a9ede613198fc4c794', '309bbd903420f146423c7cf0512b91b3'),
        ('public.get_admin_user_detail(uuid)', '4dec3f232e1905ad62688b8bcd098b2a', 'e7977d4d60b6114bb8247097b8ae3d4b')
      ) AS esperado(assinatura, hash_a, hash_b)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_a, r.hash_b) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o anterior — uma redefinição posterior está no ar; recusa corpo desconhecido.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- ---- atributos e ACL das duas ----
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid_lista
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_sort_field text DEFAULT ''created_at''::text, p_sort_direction text DEFAULT ''desc''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.get_admin_customers_paged (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid_lista AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid_lista, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid_lista, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid_lista, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.get_admin_customers_paged não é a conhecida (PUBLIC e anon sem EXECUTE; authenticated e service_role com).';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid_ficha
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_user_id uuid'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.get_admin_user_detail (linguagem, SECURITY DEFINER, volatilidade, search_path, argumento ou retorno) não são os conhecidos.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid_ficha AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid_ficha, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid_ficha, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid_ficha, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.get_admin_user_detail não é a conhecida (PUBLIC e anon sem EXECUTE; authenticated e service_role com).';
  END IF;

  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid_lista;
  PERFORM set_config('ikcous.total3000_rb_lista', v_atributos::text, true);
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid_ficha;
  PERFORM set_config('ikcous.total3000_rb_ficha', v_atributos::text, true);
END $preflight_rb_20261403000000$;

-- get_admin_customers_paged: o corpo da 20261399993000, copiado do arquivo original (o hash do pos-voo prova que e byte a byte).
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
                    WHEN o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
                    THEN o.total::numeric
                    ELSE 0
                END
            ), 0) as total_spent,
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

-- get_admin_user_detail: o corpo da 20261199000000, copiado do arquivo original (o hash do pos-voo prova que e byte a byte).
CREATE OR REPLACE FUNCTION public.get_admin_user_detail(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_profile JSONB;
    v_orders JSONB;
    v_cart_items JSONB;
    v_addresses JSONB;
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Fetch profile info (join auth.users to get email)
    SELECT JSONB_BUILD_OBJECT(
        'id', p.id,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'whatsapp', p.whatsapp,
        'role', p.role,
        'created_at', p.created_at,
        'email', u.email
    ) INTO v_profile
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_user_id;

    -- 2. Fetch marketplace orders (including order items)
    SELECT COALESCE(JSONB_AGG(o_data), '[]'::JSONB) INTO v_orders
    FROM (
        SELECT 
            mo.*,
            COALESCE(
                (
                    SELECT JSONB_AGG(item) 
                    FROM public.marketplace_order_items item 
                    WHERE item.order_id = mo.id
                ), 
                '[]'::JSONB
            ) as items
        FROM public.marketplace_orders mo
        WHERE mo.user_id = p_user_id
        ORDER BY mo.created_at DESC
    ) o_data;

    -- 3. Fetch cart items
    SELECT COALESCE(JSONB_AGG(c), '[]'::JSONB) INTO v_cart_items
    FROM public.cart_items c
    WHERE c.user_id = p_user_id;

    -- 4. Fetch user addresses
    SELECT COALESCE(JSONB_AGG(a), '[]'::JSONB) INTO v_addresses
    FROM public.user_addresses a
    WHERE a.user_id = p_user_id;

    -- Return Consolidated Object
    RETURN JSONB_BUILD_OBJECT(
        'profile', v_profile,
        'orders', v_orders,
        'cart_items', v_cart_items,
        'addresses', v_addresses
    );
END;
$$;

-- Pos-voo: os dois corpos sao os anteriores, e OID, dono, ACL e atributos sao os da fotografia do pre-voo.
DO $conferencia_rb_20261403000000$
DECLARE
  v_oid_lista oid := to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
  v_oid_ficha oid := to_regprocedure('public.get_admin_user_detail(uuid)');
  v_hash text;
BEGIN
  IF v_oid_lista IS NULL OR v_oid_ficha IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_customers_paged ou get_admin_user_detail sumiu depois do CREATE OR REPLACE.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid_lista;
  IF v_hash IS DISTINCT FROM '35212d373895b2a9ede613198fc4c794' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do rollback de get_admin_customers_paged tem hash %; esperado 35212d373895b2a9ede613198fc4c794.', COALESCE(v_hash, 'ausente');
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid_ficha;
  IF v_hash IS DISTINCT FROM '4dec3f232e1905ad62688b8bcd098b2a' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do rollback de get_admin_user_detail tem hash %; esperado 4dec3f232e1905ad62688b8bcd098b2a.', COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_admin_customers_paged', 'get_admin_user_detail')) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: alguma das duas funcoes ficou com sobrecarga.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid_lista
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_sort_field text DEFAULT ''created_at''::text, p_sort_direction text DEFAULT ''desc''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: depois: atributos de public.get_admin_customers_paged (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid_lista AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid_lista, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid_lista, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid_lista, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: depois: ACL de public.get_admin_customers_paged não é a conhecida (PUBLIC e anon sem EXECUTE; authenticated e service_role com).';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid_ficha
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_user_id uuid'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: depois: atributos de public.get_admin_user_detail (linguagem, SECURITY DEFINER, volatilidade, search_path, argumento ou retorno) não são os conhecidos.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid_ficha AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid_ficha, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid_ficha, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid_ficha, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: depois: ACL de public.get_admin_user_detail não é a conhecida (PUBLIC e anon sem EXECUTE; authenticated e service_role com).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = v_oid_lista
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.total3000_rb_lista')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final de get_admin_customers_paged falhou (OID, dono, ACL ou atributo mudou).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = v_oid_ficha
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.total3000_rb_ficha')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final de get_admin_user_detail falhou (OID, dono, ACL ou atributo mudou).';
  END IF;
END $conferencia_rb_20261403000000$;

NOTIFY pgrst, 'reload schema';

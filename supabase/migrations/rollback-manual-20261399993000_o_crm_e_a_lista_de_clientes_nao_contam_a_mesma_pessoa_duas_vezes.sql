-- Desfaz a 20261399993000: devolve os DOIS corpos anteriores BYTE A BYTE (crm__nunca_comprou, o da 20261183000000; get_admin_customers_paged, o da
-- 20261392000000). Com ele voltam os dois defeitos: a pessoa com conta e venda avulsa de mesmo WhatsApp volta a aparecer duas vezes no CRM
-- (Pediu e nao pagou + nunca comprou) e a conta com dois enderecos principais volta a dobrar pedidos e total na lista de clientes.
-- Nenhum dado e tocado: so a LEITURA muda. Desfazer esta ANTES do rollback da 20261392000000 (que recusa com o corpo novo no ar) e do da
-- 20261183000000 (que so da DROP em crm__nunca_comprou).
-- Pre-voo fechado: so aceita, em cada funcao, o corpo desta migration ou o anterior (reaplicar o rollback e inofensivo); qualquer outro corpo,
-- atributo ou ACL recusa SEM escrever. Nenhum GRANT nem REVOKE. Sem BEGIN/COMMIT: a transacao pertence ao aplicador.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rb_20261399993000$
DECLARE
  v_oid_nunca oid := to_regprocedure('public.crm__nunca_comprou(timestamptz)');
  v_oid_clientes oid := to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
  v_hash text;
  v_atributos jsonb;
  r record;
BEGIN
  IF v_oid_nunca IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.crm__nunca_comprou(timestamptz) não existe.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm__nunca_comprou') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm__nunca_comprou tem sobrecarga em public.';
  END IF;
  IF v_oid_clientes IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.get_admin_customers_paged(text,text,text,integer,integer) não existe.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_customers_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_customers_paged tem sobrecarga em public.';
  END IF;

  -- O corpo vivo tem de ser o desta migration (desfaz) ou o anterior (ja desfeito: reescreve o mesmo texto).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.crm__nunca_comprou(timestamptz)', '9a83cf34789b8b67c245648c8d82fc42', '3aa94ac8dc4ce19db958e6d93cbea7a8'),
        ('public.get_admin_customers_paged(text,text,text,integer,integer)', '1c71829d75e3d8f17bf7fb01019c05ec', '35212d373895b2a9ede613198fc4c794')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o anterior — uma redefinição posterior está no ar; recusa corpo desconhecido.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid_nunca
          AND p.prokind = 'f'
          AND l.lanname = 'sql'
          AND NOT p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND p.pronargs = 1
          AND pg_get_function_arguments(p.oid) = 'p_ate timestamp with time zone'
          AND pg_get_function_result(p.oid) = 'TABLE(chave text, user_id uuid, nome text, whatsapp text, email text, cadastrado_em timestamp with time zone)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.crm__nunca_comprou(timestamptz) não são os conhecidos.';
  END IF;
  IF has_function_privilege('anon', v_oid_nunca, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid_nunca, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid_nunca AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.crm__nunca_comprou(timestamptz) não é a conhecida (PUBLIC, anon e authenticated sem EXECUTE).';
  END IF;
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid_nunca;
  PERFORM set_config('ikcous.crm3993_rb_atributos_nunca', v_atributos::text, true);

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid_clientes
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_sort_field text DEFAULT ''created_at''::text, p_sort_direction text DEFAULT ''desc''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.get_admin_customers_paged não são os conhecidos.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid_clientes AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid_clientes, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid_clientes, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid_clientes, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.get_admin_customers_paged não é a conhecida (PUBLIC e anon sem EXECUTE; authenticated e service_role com).';
  END IF;
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid_clientes;
  PERFORM set_config('ikcous.crm3993_rb_atributos_clientes', v_atributos::text, true);
END $preflight_rb_20261399993000$;

-- crm__nunca_comprou: o corpo da 20261183000000, copiado do arquivo original (o hash do pos-voo prova que e byte a byte).
CREATE OR REPLACE FUNCTION public.crm__nunca_comprou(p_ate timestamptz)
RETURNS TABLE (
  chave text, user_id uuid, nome text, whatsapp text, email text, cadastrado_em timestamptz
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH wa_pagos AS (
    -- Achado 6 (revisão de risco): o MESMO WhatsApp que já é uma venda paga
    -- de balcão ('wa:...', crm__vendas) não pode voltar como um SEGUNDO
    -- cliente aqui só porque a pessoa depois criou conta — é a MESMA
    -- identidade, já contada como compradora.
    -- N4 (re-revisão de risco): a chave de comparação sai SEM o "55" quando
    -- o número tem DDI (12-13 dígitos) — a MESMA régua de
    -- crm__pedidos_nao_pagos, para o perfil sem DDI e a venda de balcão com
    -- DDI (ou vice-versa) baterem como a mesma pessoa.
    SELECT DISTINCT
           CASE WHEN length(d) IN (12, 13) AND left(d, 2) = '55'
                THEN substring(d FROM 3) ELSE d END AS wa_chave
      FROM (
        SELECT substring(v.chave FROM 4) AS d
          FROM public.crm__vendas(p_ate) v
         WHERE v.chave LIKE 'wa:%'
      ) x
  )
  SELECT p.id::text, p.id, NULLIF(btrim(COALESCE(p.full_name, '')), ''),
         -- WhatsApp normalizado a dígitos, mesma régua do resto do CRM (era
         -- devolvido cru — achado 6). Exibido no formato ORIGINAL captado
         -- (só a comparação abaixo ignora o "55").
         pw.wa,
         u.email::text, p.created_at
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    CROSS JOIN LATERAL (
      SELECT NULLIF(regexp_replace(COALESCE(p.whatsapp, ''), '\D', '', 'g'), '') AS wa
    ) pw
   WHERE COALESCE(p.role, 'customer') = 'customer'
     -- Achado 8: a checagem que is_admin() de fato lê (app_metadata), não só
     -- profiles.role — defesa em profundidade mesmo com o gatilho que hoje
     -- mantém os dois sincronizados (handle_profile_role_sync_to_auth).
     AND COALESCE(u.raw_app_meta_data ->> 'role', 'customer') NOT IN ('admin', 'gerente', 'vendedor')
     AND p.created_at <= p_ate
     AND NOT EXISTS (
       SELECT 1 FROM public.marketplace_orders o
        WHERE o.user_id = p.id AND o.created_at <= p_ate
     )
     AND NOT EXISTS (
       SELECT 1 FROM wa_pagos wp
        WHERE wp.wa_chave = (
          CASE WHEN length(pw.wa) IN (12, 13) AND left(pw.wa, 2) = '55'
               THEN substring(pw.wa FROM 3) ELSE pw.wa END
        )
     )
$$;

-- get_admin_customers_paged: o corpo da 20261392000000, copiado do arquivo original (o hash do pos-voo prova que e byte a byte).
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
        LEFT JOIN public.user_addresses addr ON addr.user_id = p.id AND addr.is_default = true
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

-- Pos-voo: os dois corpos sao os anteriores, e OID, dono, ACL e atributos sao os da fotografia do pre-voo.
DO $conferencia_rb_20261399993000$
DECLARE
  v_oid_nunca oid := to_regprocedure('public.crm__nunca_comprou(timestamptz)');
  v_oid_clientes oid := to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
  v_hash text;
BEGIN
  IF v_oid_nunca IS NULL OR v_oid_clientes IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm__nunca_comprou ou get_admin_customers_paged sumiu depois do CREATE OR REPLACE.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid_nunca;
  IF v_hash IS DISTINCT FROM '9a83cf34789b8b67c245648c8d82fc42' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do rollback de crm__nunca_comprou tem hash %; esperado 9a83cf34789b8b67c245648c8d82fc42 (o da 20261183000000).', COALESCE(v_hash, 'ausente');
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid_clientes;
  IF v_hash IS DISTINCT FROM '1c71829d75e3d8f17bf7fb01019c05ec' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do rollback de get_admin_customers_paged tem hash %; esperado 1c71829d75e3d8f17bf7fb01019c05ec (o da 20261392000000).', COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('crm__nunca_comprou', 'get_admin_customers_paged')) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: alguma das duas funcoes ficou com sobrecarga.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = v_oid_nunca
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.crm3993_rb_atributos_nunca')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final do rollback de crm__nunca_comprou falhou (OID, dono, ACL ou atributo mudou).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = v_oid_clientes
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.crm3993_rb_atributos_clientes')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final do rollback de get_admin_customers_paged falhou (OID, dono, ACL ou atributo mudou).';
  END IF;
END $conferencia_rb_20261399993000$;

NOTIFY pgrst, 'reload schema';

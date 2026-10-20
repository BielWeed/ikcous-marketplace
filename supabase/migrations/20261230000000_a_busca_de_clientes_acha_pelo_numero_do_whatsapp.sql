-- ============================================================================
-- Migration 20261230000000 — a busca de clientes acha pelo número do WhatsApp
-- (dado de cliente; caçada de 14/10/2026 em Postgres descartável; só LEITURA)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- public.get_admin_customers_paged(...) é a busca de clientes de TRÊS telas do painel: a tela
-- Clientes, o balcão (escolher o cliente da venda presencial) e o cupom exclusivo (escolher a
-- quem o cupom pertence). O cadastro grava o WhatsApp MASCARADO ("(34) 99999-1234") e a busca
-- comparava texto com texto: quem digitava só os números ("34999991234", "999991234") ou o
-- número colado do WhatsApp ("+55 34 99999-1234") não achava ninguém.
--
-- 2. A REGRA NOVA (a mesma da busca de pedidos e do CRM, mais o +55)
--
--   * o termo digitado perde tudo que não é dígito; com 4 ou mais dígitos, a busca TAMBÉM compara
--     só dígitos com só dígitos, dos dois lados, no WhatsApp do perfil (profiles.whatsapp) e no
--     telefone da conta (auth.users.phone);
--   * com 12 ou 13 dígitos começando por 55 (o +55 do Brasil), o 55 sai antes de comparar: o
--     cadastro não o guarda. Um número guardado COM o 55 também casa (a comparação é "contém");
--   * com menos de 4 dígitos, NADA muda: um dígito solto casaria quase toda a base (medido na
--     busca de pedidos em 23/08/2026); o termo segue só como texto, como sempre;
--   * as comparações de texto de antes (nome, e-mail, telefone, WhatsApp, cidade, estado, com
--     unaccent) ficam como estão: a regra nova é um OR a mais, nunca uma troca. Busca vazia
--     continua devolvendo todo mundo.
--
-- 3. O QUE MUDA NO CORPO (só estas três trocas; o resto não muda um byte)
--
--   (a) uma variável nova, v_search_digitos, na DECLARE;
--   (b) depois de v_clean_search := TRIM(p_search), o cálculo dos dígitos e do corte do 55;
--   (c) no WHERE, depois da linha do WhatsApp, a cláusula nova (OR) por dígitos.
-- Assinatura, SECURITY DEFINER, VOLATILE, search_path ('public', 'extensions'), retorno (jsonb),
-- as duas travas de admin (is_admin e is_admin_atual, 20261199000000), as estatísticas, a
-- ordenação e a paginação NÃO mudam. A ACL NÃO é tocada: CREATE OR REPLACE preserva dono e
-- privilégios; nenhum GRANT nem REVOKE aqui (PUBLIC não, anon não, authenticated sim,
-- service_role sim, como hoje).
--
-- 4. O QUE ACONTECE EM CADA CASO
--
--   * "34999991234", "34 99999-1234", "(34) 99999-1234", "999991234", "99999-1234" e
--     "+55 34 99999-1234" acham a cliente gravada como "(34) 99999-1234";
--   * 3 dígitos ou menos ("349"): só texto, como antes (não vira busca por dígitos);
--   * termo sem dígito (um nome): a cláusula nova não atua (length(dígitos) = 0);
--   * cliente sem WhatsApp: a cláusula nova dá falso para ela (COALESCE para ''), nunca erro;
--   * ACEITO (mesma regra da busca de pedidos, medido): um termo com letras E 4 ou mais dígitos
--     ("bruno1985") também compara os dígitos ("1985") com o telefone; o resultado é um conjunto
--     MAIOR, nunca menor: quem a busca de texto achava continua achada.
--
-- 5. QUEM LÊ
--
-- src/hooks/useCoupons.ts, src/views/admin/AdminCustomersView.tsx e
-- src/components/admin/pdv/ClienteDaVenda.tsx (a busca do balcão): o formato do JSON é o mesmo.
-- Nenhum front e nenhuma edge function mudam.
--
-- 6. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar: só o corpo de UMA função muda.
-- Os WhatsApps já gravados (mascarados ou não) passam a ser achados pela próxima busca.
--
-- 7. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de
-- replace(prosrc, E'\r', '')) não for UM dos dois conhecidos (o da 20261199000000 ou o desta
-- migration); os atributos não forem os de sempre; faltar a coluna profiles.whatsapp, a coluna
-- auth.users.phone ou uma das duas travas de admin (o PL/pgSQL só acusa o que falta na hora de
-- EXECUTAR); ou a ACL não for EXATAMENTE a de hoje (PUBLIC não, anon não, authenticated sim,
-- service_role sim). Os hashes são o md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_a_busca_de_clientes_acha_pelo_numero_do_whatsapp_test.ts.
--
-- 8. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Dois estados de entrada: corpo da 20261199000000 (aplica) ou corpo desta migration (reaplicar
-- reescreve o MESMO texto: hash, ACL, dono e oid não mudam). Qualquer outro estado ABORTA. Sem
-- BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador; o pré-voo,
-- a troca do corpo e a conferência final caem juntos ou não caem.
--
-- 9. ORDEM E ROLLBACK
--
-- Depois da 20261199000000 (o pré-voo recusa sem ela). Independe da 20261231000000 (outra
-- função). ROLLBACK MANUAL: rollback-manual-20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql
-- devolve o corpo da 20261199000000 byte a byte. Este rollback vem ANTES do rollback da
-- 20261199000000 (o da 99 recusa enquanto houver redefinição posterior no ar). A 8e (lote 92-202)
-- aceita este corpo como sucessor do da 99.
--
-- 10. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
--      -- esperado: d6c092c3e0d8069891af795147d65e9e.
--   2. Como admin: public.get_admin_customers_paged('34999991234', 'created_at', 'desc', 0, 10)
--      acha a cliente gravada como "(34) 99999-1234".
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/busca-de-clientes-viva.cjs (rpc-ci); portão da release: consultas 32a e 32b.
-- ============================================================================

DO $preflight_20261230$
DECLARE
  v_fn CONSTANT text := 'public.get_admin_customers_paged(text,text,text,integer,integer)';
  v_oid oid := to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
  v_hash text;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_servico boolean;
  v_falta text;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_customers_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_customers_paged tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (o da 20261199000000, aplica) ou o desta migration (reaplicar é no-op).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.get_admin_customers_paged(text,text,text,integer,integer)', '3c4a0fc4ca6f5d1c9a017a38bff2ec49', 'd6c092c3e0d8069891af795147d65e9e')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261199000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_sort_field text DEFAULT ''created_at''::text, p_sort_direction text DEFAULT ''desc''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- O PL/pgSQL só acusa coluna ou função ausente na hora de EXECUTAR, não ao criar: confere antes.
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.profiles.whatsapp', 'auth.users.phone']) AS d(item)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = to_regclass(split_part(d.item, '.', 1) || '.' || split_part(d.item, '.', 2))
              AND a.attname = split_part(d.item, '.', 3)
              AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas que o corpo novo lê não existem: % — aplique as migrations anteriores antes.', v_falta;
  END IF;
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.is_admin()', 'public.is_admin_atual()']) AS d(item)
   WHERE to_regprocedure(d.item) IS NULL;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: funções que o corpo novo chama não existem: % — aplique a 20261199000000 antes.', v_falta;
  END IF;

  -- ACL exatamente a de hoje (PUBLIC medido por aclexplode, grantee = 0): o CREATE OR REPLACE a preserva.
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  v_servico := has_function_privilege('service_role', v_oid, 'EXECUTE');
  IF NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC=%, anon=%, authenticated=%, service_role=%) — meça a loja e revise.', v_fn, v_public, v_anon, v_auth, v_servico;
  END IF;
END $preflight_20261230$;

-- get_admin_customers_paged: corpo vigente da 20261199000000_portas_do_painel_exigem_admin_atual.sql,
-- com a busca por dígitos do WhatsApp (três trocas declaradas no cabeçalho, item 3).
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
$$;

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o novo, se algum atributo
-- mudou, ou se a ACL não ficou PUBLIC não, anon não, authenticated sim, service_role sim.
DO $conferencia_20261230$
DECLARE
  v_fn CONSTANT text := 'public.get_admin_customers_paged(text,text,text,integer,integer)';
  v_oid oid := to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261230: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_customers_paged') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261230: get_admin_customers_paged ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'd6c092c3e0d8069891af795147d65e9e' THEN
    RAISE EXCEPTION 'conferencia 20261230: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_sort_field text DEFAULT ''created_at''::text, p_sort_direction text DEFAULT ''desc''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'conferencia 20261230: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261230: % alcançável por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261230: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261230: authenticated perdeu EXECUTE em %', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261230: service_role perdeu EXECUTE em %', v_fn;
  END IF;
END $conferencia_20261230$;

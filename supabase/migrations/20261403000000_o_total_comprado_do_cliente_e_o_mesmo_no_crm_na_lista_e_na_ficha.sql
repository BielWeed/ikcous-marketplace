-- ============================================================================
-- Migration 20261403000000 -- o total comprado do cliente e o mesmo no CRM, na lista de Clientes e na ficha (dado de cliente e valores de compra; so LEITURA; troca o corpo de DUAS funcoes)
-- ============================================================================
--
-- 1. O DEFEITO (decisao do dono, medida em Postgres 17 com os corpos reais)
--
-- A mesma pessoa mostrava TOTAIS DIFERENTES em tres telas do painel. Quem tem conta e uma compra paga de R$ 100 no app, e depois uma compra avulsa de
-- balcao de R$ 100 registrada SEM conta com o MESMO WhatsApp (com ou sem o 55 do pais), aparece:
--   * no CRM (crm_clientes, crm__vendas): UMA pessoa, 2 pedidos, R$ 200 -- a venda de balcao entra na CONTA pela fusao por WhatsApp (20261399990000);
--   * na lista de Clientes (get_admin_customers_paged): 1 pedido, R$ 100 -- so soma o que tem user_id = conta;
--   * na ficha do cliente (get_admin_user_detail): R$ 100 e 1 pedido -- idem.
--
-- 2. A REGRA NOVA
--
-- A lista e a ficha passam a somar tambem o balcao que o CRM atribui a cada conta. A regra de "quem e a mesma pessoa" NAO e copiada: vem da propria
-- crm__vendas(now()), cujas linhas ja trazem o user_id da conta dona do pedido (a conta, ou a conta fundida pelo WhatsApp). Das linhas de crm__vendas
-- entram aqui SO as de pedido SEM conta (marketplace_orders.user_id nulo): o pedido da propria conta continua somado como sempre, entao nada conta duas vezes.
--   * lista (get_admin_customers_paged): orders_count e total_spent ganham o balcao (a contagem e a soma por cliente, por UMA agregacao
--     MATERIALIZED de crm__vendas juntada por conta; nao ha subconsulta por linha). O formato do JSON, a busca, as estatisticas globais, o ORDER BY e
--     o desempate por id NAO mudam. last_order_date continua o do pedido da conta (nao muda).
--   * ficha (get_admin_user_detail): ganha o campo NOVO e SEPARADO 'balcao_mesmo_whatsapp' = {pedidos, total} (0 e 0 quando nao ha balcao; nunca nulo).
--     A lista 'orders' que a ficha ja devolvia, 'profile', 'cart_items' e 'addresses' NAO mudam um byte. O front soma e mostra a separacao.
--   * "Meus pedidos" da propria cliente (app dela) NAO muda (nao le estas funcoes).
--   * cada funcao mantem o filtro de pagamento DELA para os pedidos da conta (lista: contagem sem filtro de pagamento, soma so dinheiro reconhecido;
--     ficha: lista de pedidos inteira). O balcao entra pela regra do CRM: pedido pago (pago, pago_apos_expirar, recebido_na_entrega), nao cancelado
--     nem devolvido, com data de pagamento.
--
-- 3. O QUE ACONTECE EM CADA CASO
--
--   * conta com 1 pedido pago (R$ 100) + 1 de balcao pago sem conta, mesmo WhatsApp (com ou sem o 55 de um lado ou do outro): CRM = lista = ficha =
--     2 pedidos / R$ 200; a ficha traz balcao_mesmo_whatsapp = {1 pedido, R$ 100};
--   * balcao CANCELADO, devolvido ou sem pagar: nao conta (crm__vendas nao o devolve), em nenhuma das tres telas;
--   * pedido da PROPRIA conta sem pagar: segue como antes (a lista o conta em orders_count e nao o soma em total_spent);
--   * o WhatsApp em DUAS contas: o balcao vai para UMA so, a que comprou por ultimo (a regra do CRM, DISTINCT ON por pago_em DESC); nunca nas duas;
--   * numero DIFERENTE, balcao sem WhatsApp, conta sem pedido pago com aquele numero: continuam como antes (nao se junta nada que o CRM nao junta);
--   * conta sem balcao nenhum: lista e ficha iguais as de antes (campo novo 0/0).
--
-- 4. O QUE MUDA NO CORPO (so isto; o resto nao muda um byte)
--
-- get_admin_customers_paged: entra a CTE balcao_da_conta (antes de customer_stats), um LEFT JOIN dela, e as duas expressoes orders_count e total_spent
-- somam bal.pedidos e bal.total; o GROUP BY ganha bal.pedidos e bal.total. get_admin_user_detail: entram a variavel v_balcao, o passo 5 e a chave
-- 'balcao_mesmo_whatsapp' no retorno. As assinaturas, o retorno (jsonb), LANGUAGE, VOLATILE, SECURITY DEFINER, search_path, dono, OID e ACL das duas NAO
-- mudam. As travas de admin (is_admin e is_admin_atual) seguem no topo, intactas. Nenhum GRANT e nenhum REVOKE neste arquivo. crm__vendas (SECURITY
-- INVOKER, sem EXECUTE para anon/authenticated) e chamada de DENTRO das duas funcoes SECURITY DEFINER, como o resto do CRM faz.
--
-- 5. QUEM LE
--
-- get_admin_customers_paged: AdminCustomersView (tela Clientes), useCoupons (cupom exclusivo) e ClienteDaVenda (balcao): o formato do JSON e o mesmo.
-- get_admin_user_detail: AdminUserDetailView (a ficha); campo novo ausente em banco velho = o front mostra como antes.
-- Custo: cada chamada passa a avaliar crm__vendas(now()) UMA vez (o CRM, o Inicio e o Financeiro ja o fazem); a lista agrega por conta e junta por
-- p.id (hash join), sem N+1.
-- Residuo conhecido, herdado do CRM e NAO inventado aqui: com o mesmo WhatsApp em duas contas cujos ULTIMOS pedidos pagos tem o MESMO instante de
-- pagamento, o DISTINCT ON da crm__vendas desempata sem criterio; o balcao nunca conta nas duas, mas pode trocar de conta entre duas chamadas. A correcao
-- mora em crm__vendas e e outra decisao.
--
-- 6. DADOS EXISTENTES
--
-- Nenhuma linha de pedido, conta, perfil, endereco ou historico e escrita ao aplicar: so o corpo de DUAS funcoes muda. As pessoas que hoje aparecem
-- com total menor na lista e na ficha do que no CRM passam a mostrar o MESMO total; quem nunca teve balcao com o mesmo WhatsApp nao muda.
--
-- 7. PRE-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: alguma das duas funcoes nao existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) nao for UM dos dois conhecidos de
-- cada uma (get_admin_customers_paged: o da 20261399993000, 35212d373895b2a9ede613198fc4c794, ou o desta migration, 309bbd903420f146423c7cf0512b91b3;
-- get_admin_user_detail: o da 20261199000000, 4dec3f232e1905ad62688b8bcd098b2a, ou o desta, e7977d4d60b6114bb8247097b8ae3d4b); os atributos ou a ACL nao forem os de sempre
-- (authenticated e service_role com EXECUTE, PUBLIC e anon sem); ou crm__vendas(timestamptz) faltar, tiver sobrecarga ou outro retorno. Fotografa OID,
-- dono, ACL e TODOS os atributos (set_config local a transacao) para a conferencia final. Os hashes sao o md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_o_total_comprado_do_cliente_e_o_mesmo_no_crm_na_lista_e_na_ficha_test.ts.
--
-- 8. TRANSACAO, IDEMPOTENCIA E REAPLICACAO
--
-- Sem BEGIN/COMMIT de nivel superior (regra da casa e do aplicador: o aplicador RECUSA controle de transacao de topo, e com ele o ROLLBACK dos scripts de
-- prova viraria no-op): quem abre a transacao e o aplicador (psql -1 / db-apply, que mandam o arquivo como UM so lote); o pre-voo, as duas trocas de corpo e
-- a conferencia caem juntos ou nao caem. Dois estados de entrada por funcao: o corpo anterior (aplica) ou o desta migration (reaplicar reescreve o MESMO
-- texto, mesmo estado). Qualquer outro estado ABORTA sem escrever. CREATE OR REPLACE (sem DROP) preserva OID, dono e ACL; a conferencia exige que todos os
-- atributos fiquem iguais aos da fotografia. Rodar duas vezes deixa o mesmo estado. Chamada concorrente: o CREATE OR REPLACE espera o lock por no maximo 5 s
-- (lock_timeout) e aborta tudo se nao conseguir; quem ja esta lendo termina com o corpo antigo.
--
-- 9. ORDEM E ROLLBACK
--
-- Depois da 20261399993000 (e da 20261399990000, que da a crm__vendas o 55): o pre-voo recusa corpo diferente. O front novo funciona com a migration ausente
-- (campo novo ausente = como antes); a migration funciona com o front velho (so ganha um campo e totais maiores). ROLLBACK MANUAL:
-- rollback-manual-20261403000000_o_total_comprado_do_cliente_e_o_mesmo_no_crm_na_lista_e_na_ficha.sql devolve os DOIS corpos anteriores byte a byte; vem ANTES do rollback da 20261399993000. Valem IKCOUS e Savy; lojas
-- de teste ficam fora.
--
-- 10. FICHA DE VERIFICACAO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
--      -- esperado: 309bbd903420f146423c7cf0512b91b3.
--   2. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_user_detail(uuid)');
--      -- esperado: e7977d4d60b6114bb8247097b8ae3d4b.
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   4. Painel: a pessoa com compra no app e compra de balcao com o mesmo WhatsApp mostra o MESMO total no CRM, em Clientes e na ficha.
--   PROVA VIVA: tests/banco/o-total-do-cliente-e-o-mesmo-nas-tres-telas-viva.cjs.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261403000000$
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

  -- ---- corpo identificado pelo CONTEUDO: o anterior (aplica) ou o desta migration (reaplicar e no-op) ----
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
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
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
  -- ---- o que os corpos novos chamam: crm__vendas, com o contrato que eles leem (order_id, total, user_id) ----
  IF to_regprocedure('public.crm__vendas(timestamptz)') IS NULL
     OR (SELECT count(*) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm__vendas') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta crm__vendas(timestamptz) (ou ficou com sobrecarga); aplique antes a 20261399990000.';
  END IF;
  IF pg_get_function_result(to_regprocedure('public.crm__vendas(timestamptz)')) <> 'TABLE(order_id uuid, total numeric, canal text, forma text, pago_em timestamp with time zone, dia date, chave text, user_id uuid, nome text, whatsapp text, email text)' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o retorno de public.crm__vendas(timestamptz) não é o conhecido (os corpos novos leem order_id, total e user_id).';
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('marketplace_orders', 'id'),
      ('marketplace_orders', 'user_id')
    ) AS coluna(tabela, nome)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || r.tabela)
                      AND a.attname = r.nome AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a coluna public.%.% que os corpos novos leem.', r.tabela, r.nome;
    END IF;
  END LOOP;

  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid_lista;
  PERFORM set_config('ikcous.total3000_lista', v_atributos::text, true);
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid_ficha;
  PERFORM set_config('ikcous.total3000_ficha', v_atributos::text, true);
END $preflight_20261403000000$;

-- get_admin_customers_paged: o corpo vigente da 20261399993000, com o balcao que o CRM atribui a conta somado em orders_count e total_spent (item 4).
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

-- get_admin_user_detail: o corpo vigente da 20261199000000, com o campo novo 'balcao_mesmo_whatsapp' (item 4).
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
    v_balcao JSONB;
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

    -- 5. Compras de balcao que o CRM atribui a esta pessoa (20261403000000): pedidos pagos SEM conta feitos com o MESMO WhatsApp de um
    -- pedido pago desta conta (com ou sem o 55). A regra de identidade e a de crm__vendas, lida daqui e nunca copiada. Campo SEPARADO:
    -- a lista de pedidos acima nao muda (so os pedidos da conta aparecem nela). Sem balcao: pedidos 0 e total 0 (nunca nulo).
    SELECT jsonb_build_object('pedidos', COUNT(*), 'total', COALESCE(SUM(v.total), 0)) INTO v_balcao
    FROM public.crm__vendas(now()) v
    JOIN public.marketplace_orders bo ON bo.id = v.order_id AND bo.user_id IS NULL
    WHERE v.user_id = p_user_id;

    -- Return Consolidated Object
    RETURN JSONB_BUILD_OBJECT(
        'profile', v_profile,
        'orders', v_orders,
        'cart_items', v_cart_items,
        'addresses', v_addresses,
        'balcao_mesmo_whatsapp', v_balcao
    );
END;
$$;

-- Pos-voo: corpos, atributos, ACL e fotografia do pre-voo das duas funcoes; qualquer divergencia aborta a transacao do aplicador.
DO $conferencia_20261403000000$
DECLARE
  v_oid_lista oid := to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
  v_oid_ficha oid := to_regprocedure('public.get_admin_user_detail(uuid)');
  v_hash text;
BEGIN
  IF v_oid_lista IS NULL OR v_oid_ficha IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_customers_paged ou get_admin_user_detail sumiu depois do CREATE OR REPLACE.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid_lista;
  IF v_hash IS DISTINCT FROM '309bbd903420f146423c7cf0512b91b3' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de get_admin_customers_paged tem hash %; esperado 309bbd903420f146423c7cf0512b91b3.', COALESCE(v_hash, 'ausente');
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid_ficha;
  IF v_hash IS DISTINCT FROM 'e7977d4d60b6114bb8247097b8ae3d4b' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de get_admin_user_detail tem hash %; esperado e7977d4d60b6114bb8247097b8ae3d4b.', COALESCE(v_hash, 'ausente');
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
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.total3000_lista')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final de get_admin_customers_paged falhou (OID, dono, ACL ou atributo mudou).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = v_oid_ficha
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.total3000_ficha')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final de get_admin_user_detail falhou (OID, dono, ACL ou atributo mudou).';
  END IF;
END $conferencia_20261403000000$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Migration 20261234000000 — o lucro só conta produto com custo
-- (o gráfico "Lucro acumulado" e o "Top 5 produtos mais lucrativos" do CRM > Visão geral;
-- caçada de 14/10/2026; muda o que a lojista LÊ, não grava dado)
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION FECHA
--
-- Em `get_admin_analytics_v2` (CRM > Visão geral), o lucro por dia (o gráfico "Retorno sobre
-- estoque / Lucro acumulado") e o ranking "Top 5 produtos mais lucrativos" calculavam o lucro
-- de cada item como `quantity * (price - COALESCE(p.custo, 0))`. Produto SEM custo cadastrado
-- (`custo IS NULL`, possível desde a 20261024000000) virava custo 0, ou seja, lucro = preço
-- inteiro: margem de 100% inventada. Medido: o produto "Brinco", custo NULL, preço R$ 30, uma
-- venda — a função devolvia `{"revenue":30,"profit":30,"cost_sold":0}` no dia e o ranking listava
-- o Brinco com `total: 30`, empatado com a receita. A decisão do dono já está registrada na
-- 20261024000000 ("custo ausente NÃO pode virar margem 100%") e foi cumprida só na lista de
-- produtos e no "Lucro se vender tudo" (20261214000000); estas duas contas ficaram de fora.
--
-- 2. A REGRA
--
-- "Tem custo" é a MESMA definição que o resto do app e a 20261214000000 já usam:
-- `produtos.custo IS NOT NULL`. NULL = ausência (ninguém mediu); 0 = zero medido de propósito
-- (o brinde: margem de 100% é verdade e continua contando, como a tela de Produtos afirma).
--   * Lucro por dia (`revenueHistory[].profit`): soma só os itens cujo produto TEM custo.
--   * Top 5 (`topProducts`): só produto COM custo entra no ranking de lucro. Produto sem custo
--     não aparece lá (fica sem lucro conhecido), mas segue contando na RECEITA: o dinheiro do dia
--     (`revenueHistory[].revenue`, vindo de `o.total`), `today`, `month` e `executive` não mudam.
--   * `cost_sold` NÃO muda (sem custo já somava 0).
--   * Campo NOVO e ADITIVO, `productsWithoutCost` (inteiro, no nível de cima do JSON): quantos
--     produtos DIFERENTES (não apagados) têm venda reconhecida e ficaram fora do lucro e do
--     ranking por não terem custo — a mesma regra de venda do ranking (pedido não cancelado nem
--     devolvido, com cobrança paga ou recebida na entrega). Serve para a tela avisar depois ("N
--     produtos vendidos sem custo cadastrado ficam de fora do lucro"); nenhuma tela muda neste PR.
--   * Nenhuma outra chave do JSON muda; os números de hoje, do mês, o executivo, o estoque
--     (`inventory`, `inventoryAlerts`) e a guarda do admin atual ficam como na 20261214000000.
--
-- 3. O QUE MUDA NO CORPO (o resto não muda um byte; o teste estático
--    tests/migration_o_lucro_so_conta_produto_com_custo_test.ts prova)
--
--   a. DECLARE: uma variável nova (`products_without_cost`).
--   b. `daily_items.profit`: SUM(...) FILTER (WHERE p.custo IS NOT NULL), sem o COALESCE(custo, 0).
--   c. Top 5: `AND p.custo IS NOT NULL` no WHERE (sem isso o NULL do custo viraria NULL no
--      `total` e o ORDER BY ... DESC o poria em PRIMEIRO lugar).
--   d. Um SELECT novo (a contagem do campo novo) e a chave `productsWithoutCost` no JSON final.
-- Assinatura, RETURNS, SECURITY DEFINER, search_path (sem STABLE, como antes) e as duas travas de
-- admin (is_admin e is_admin_atual, 20261199000000) NÃO mudam. `CREATE OR REPLACE` preserva dono e
-- ACL: nenhum GRANT/REVOKE aqui, e o pré-voo e a conferência final RECUSAM ACL aberta.
--
-- 4. O QUE ACONTECE EM CADA CASO
--
--   * produto com custo (inclusive 0): lucro e ranking idênticos aos de antes;
--   * produto com custo NULL: sai do lucro do dia e do top 5; a receita dele segue no dia;
--   * dia sem venda reconhecida: `profit` 0 (como antes); pedido cancelado, devolvido ou ainda
--     não pago segue FORA de tudo;
--   * loja em que NENHUM produto tem custo: `topProducts` fica vazio (`[]`) e o lucro de todos
--     os dias é 0 — a verdade ("não sei o lucro"), não a margem inventada. ACEITO e declarado: a
--     lojista passa a ver o ranking vazio até cadastrar o custo (o campo novo é o que deixa a
--     tela dizer isso, em PR próprio);
--   * produto sem custo e já apagado (`deleted_at`): não entra na contagem (como no ranking);
--   * fuso: o dia continua o de America/Sao_Paulo (a regra do dia não foi tocada).
--
-- 5. QUEM LÊ
--
-- src/hooks/useAnalytics.ts (o gráfico e o ranking leem `revenueHistory[].profit`, `cost_sold` e
-- `topProducts`; as chaves e os tipos são os mesmos), src/hooks/useOrders.ts (lê o objeto
-- inteiro, não depende de chave nova). Ninguém lê `productsWithoutCost` ainda (campo aditivo): um
-- JSON com chave a mais não quebra nenhum consumidor. A tela PODE mostrar lucro menor que antes —
-- é o conserto. Nenhuma edge function lê esta RPC.
--
-- 6. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar: só o corpo de UMA função muda. O
-- gráfico e o ranking mudam na próxima leitura da tela.
--
-- 7. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de
-- replace(prosrc, E'\r', '')) não for UM dos dois conhecidos (o da 20261214000000 ou o que esta
-- migration deixa); os atributos não forem os de sempre; ou a ACL não for a de hoje (PUBLIC e anon
-- sem EXECUTE, authenticated com). O EXECUTE de service_role não é conferido (nenhuma migration o
-- fixa; o CREATE OR REPLACE o preserva). Os hashes são o md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_o_lucro_so_conta_produto_com_custo_test.ts.
--
-- 8. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Dois estados de entrada: corpo da 20261214000000 (aplica) ou corpo desta migration (reaplicar
-- reescreve o MESMO texto). Qualquer outro estado ABORTA — em particular, uma loja que ainda
-- está no corpo da 20261199000000 recusa aqui (aplique a 20261214000000 antes). Sem BEGIN/COMMIT
-- de nível superior (regra da casa): quem abre a transação é o aplicador; o pré-voo, a troca do
-- corpo e a conferência final caem juntos ou não caem. Local: `psql -1`.
--
-- 9. ORDEM E ROLLBACK
--
-- Depois da 20261214000000 (a cadeia é 99 -> 14 -> 34). ROLLBACK MANUAL:
-- rollback-manual-20261234000000_o_lucro_so_conta_produto_com_custo.sql devolve o corpo da
-- 20261214000000 byte a byte (md5 abaixo). Este rollback vem ANTES do rollback da 20261214000000
-- (o da 14 recusa enquanto houver redefinição posterior no ar) e este, antes do da 20261199000000.
-- A 8e (lote 92-202) e a 17a aceitam este corpo como sucessor do da 14; o portão da release é o
-- lote 35 (consultas 35a, 35b e a medição 35m).
--
-- 10. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.get_admin_analytics_v2(integer)');
--      -- esperado: 05eac70f6bd4360c1f71fd373747ad0e.
--   2. Como admin: `get_admin_analytics_v2(90)->'revenueHistory'` do dia de uma venda só de
--      produto sem custo tem `profit` 0 e `revenue` do pedido; `topProducts` não lista o produto;
--      `productsWithoutCost` conta o produto.
--   3. `proacl`, `prosecdef` e `proconfig` iguais antes e depois.
--   PROVA VIVA: tests/banco/lucro-so-com-custo-viva.cjs (rpc-ci); portão da release: consultas 35a e 35b.
-- ============================================================================

DO $preflight_20261234$
DECLARE
  v_fn CONSTANT text := 'public.get_admin_analytics_v2(integer)';
  v_oid oid := to_regprocedure('public.get_admin_analytics_v2(integer)');
  v_hash text;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_analytics_v2') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_analytics_v2 tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (o da 20261214000000, aplica) ou o desta migration (reaplicar é no-op).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.get_admin_analytics_v2(integer)', '0a5f8c75bbeeda3777a6a7326a0e281c', '05eac70f6bd4360c1f71fd373747ad0e')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261214000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
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
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90'
          AND pg_get_function_result(p.oid) = 'json'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- ACL como a de hoje (PUBLIC medido por aclexplode, grantee = 0): o CREATE OR REPLACE a preserva.
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  IF NOT (NOT v_public AND NOT v_anon AND v_auth) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC=%, anon=%, authenticated=%) — meça a loja e revise.', v_fn, v_public, v_anon, v_auth;
  END IF;
END $preflight_20261234$;

-- get_admin_analytics_v2: corpo vigente da 20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql,
-- com o lucro por dia e o top 5 só de produto COM custo e o campo novo `productsWithoutCost`.
CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    result json;
    active_users_count int;
    low_stock_count int;

    -- Today stats
    today_revenue numeric;
    today_count bigint;
    today_pending bigint;
    yesterday_revenue numeric;
    yesterday_count bigint;
    today_rev_trend numeric;
    today_count_trend numeric;

    -- month stats (rolling 30 days)
    month_revenue numeric;
    month_count bigint;
    prev_month_revenue numeric;
    prev_month_count bigint;
    month_rev_trend numeric;
    month_count_trend numeric;

    -- executive stats (all-time)
    total_rev numeric;
    total_ord bigint;

    -- avg ticket (all-time)
    avg_ticket numeric;

    -- active customers (all-time)
    active_customers bigint;

    -- inventory values
    inv_cost_total numeric;
    inv_value_total numeric;

    -- lists
    rev_history json;
    top_prods json;

    -- dinheiro reconhecido: pedido concluído e cobrança paga fora do prazo,
    -- mesmo com o pedido cancelado (achados 2 e 3, 22/08/2026)
    delivered_total bigint;
    paid_on_cancelled bigint;

    -- produtos vendidos SEM custo cadastrado: ficam fora do lucro e do top 5 (20261234000000)
    products_without_cost bigint;
BEGIN
    -- 0. Security Check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Today vs Yesterday (Same period)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO yesterday_revenue, yesterday_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', (now() - interval '1 day') AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    AND created_at < now() - interval '1 day'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    today_rev_trend := CASE WHEN yesterday_revenue > 0 THEN ((today_revenue - yesterday_revenue) / yesterday_revenue) * 100 ELSE (CASE WHEN today_revenue > 0 THEN 100 ELSE 0 END) END;
    today_count_trend := CASE WHEN yesterday_count > 0 THEN ((today_count::numeric - yesterday_count::numeric) / yesterday_count::numeric) * 100 ELSE (CASE WHEN today_count > 0 THEN 100 ELSE 0 END) END;

    SELECT COUNT(*) INTO today_pending
    FROM public.marketplace_orders
    WHERE status in ('pending', 'new', 'processing');

    -- 2. month vs Previous Month (Rolling 30 Days)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO month_revenue, month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO prev_month_revenue, prev_month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    month_rev_trend := CASE WHEN prev_month_revenue > 0 THEN ((month_revenue - prev_month_revenue) / prev_month_revenue) * 100 ELSE (CASE WHEN month_revenue > 0 THEN 100 ELSE 0 END) END;
    month_count_trend := CASE WHEN prev_month_count > 0 THEN ((month_count::numeric - prev_month_count::numeric) / prev_month_count::numeric) * 100 ELSE (CASE WHEN month_count > 0 THEN 100 ELSE 0 END) END;

    -- 3. Executive Metrics (All-time total metrics)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_rev, total_ord
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    avg_ticket := CASE WHEN total_ord > 0 THEN total_rev / total_ord ELSE 0 END;

    SELECT COUNT(DISTINCT COALESCE(user_id::text, customer_data->>'email', customer_data->>'whatsapp'))
    INTO active_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COUNT(*) INTO active_users_count FROM public.profiles;

    -- Estoque efetivo: soma dos `stock_increment` das variantes ATIVAS
    -- quando existe ao menos uma variante ativa; senão a coluna
    -- `produtos.estoque` crua. É a MESMA regra de src/lib/mappers.ts:98-107
    -- (mapProductFromDB), que o cartão do produto, o formulário e a loja já
    -- usam — antes esta função lia a coluna crua e divergia (achado 13,
    -- 20/08/2026). Calculada uma única vez e usada nos dois agregados
    -- abaixo (estoque baixo, custo/valor de estoque).
    WITH estoque_efetivo AS (
        SELECT
            p.custo,
            p.preco_venda,
            p.estoque_minimo,
            CASE
                WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)
                ELSE p.estoque
            END AS estoque
        FROM public.produtos p
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE pv.active) AS qtd_ativas,
                SUM(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas
            FROM public.product_variants pv
            WHERE pv.product_id = p.id
        ) v ON true
        WHERE p.deleted_at IS NULL AND p.ativo = true
    )
    SELECT
        COUNT(*) FILTER (WHERE estoque <= COALESCE(estoque_minimo, 5)),
        COALESCE(SUM(custo * estoque), 0),
        -- Só produto COM custo: sem custo, a venda inteira contava como lucro em "Lucro se vender tudo" (20261214000000).
        COALESCE(SUM(preco_venda * estoque) FILTER (WHERE custo IS NOT NULL), 0)
    INTO low_stock_count, inv_cost_total, inv_value_total
    FROM estoque_efetivo;

    -- 4. Revenue, Orders, Profit & Cost History (Filtered by p_limit_days for performance)
    -- This scans only within the required range using the created_at index or created_at::date expression index
    SELECT json_agg(h)
    INTO rev_history
    FROM (
        WITH days AS (
            SELECT generate_series(
                ((now() AT TIME ZONE 'America/Sao_Paulo')
                - (p_limit_days || ' days')::interval)::date,
                (now() AT TIME ZONE 'America/Sao_Paulo')::date,
                interval '1 day'
            )::date AS day
        ),
        daily_orders AS (
            SELECT
                (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                COALESCE(SUM(o.total), 0) AS revenue,
                COUNT(o.id)::int as orders
            FROM public.marketplace_orders o
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
              AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY ((o.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        ),
        daily_items AS (
            SELECT
                (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                -- Lucro só dos itens cujo produto TEM custo (custo IS NOT NULL; custo 0 é zero medido e conta): sem custo, a venda inteira virava lucro (20261234000000).
                COALESCE(SUM(oi.quantity * (oi.price - p.custo)) FILTER (WHERE p.custo IS NOT NULL), 0) AS profit,
                COALESCE(SUM(oi.quantity * COALESCE(p.custo, 0)), 0) AS cost_sold
            FROM public.marketplace_order_items oi
            JOIN public.marketplace_orders o ON oi.order_id = o.id
            JOIN public.produtos p ON oi.product_id = p.id
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
              AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY ((o.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        )
        SELECT
            TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
            TO_CHAR(d.day, 'DD/MM') AS full_date,
            COALESCE(dor.revenue, 0) AS revenue,
            COALESCE(dor.orders, 0) AS orders,
            COALESCE(dit.profit, 0) AS profit,
            COALESCE(dit.cost_sold, 0) AS cost_sold
        FROM days d
        LEFT JOIN daily_orders dor ON d.day = dor.day
        LEFT JOIN daily_items dit ON d.day = dit.day
        ORDER BY d.day ASC
    ) h;

    -- 5. Top Products (All time)
    SELECT json_agg(p)
    INTO top_prods
    FROM (
        SELECT
            p.id as id,
            p.nome AS name,
            SUM(oi.quantity)::int as quantity,
            SUM(oi.quantity * (oi.price - COALESCE(p.custo, 0))) as total,
            COALESCE(p.imagem_url, '') as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
        AND p.deleted_at IS NULL
        -- Só produto COM custo informado: sem custo o ranking de LUCRO empatava com a receita (20261234000000).
        AND p.custo IS NOT NULL
        GROUP BY p.id, p.nome, p.imagem_url
        ORDER BY total DESC
        LIMIT 5
    ) p;

    -- 5b. Produtos vendidos (mesma regra de venda do top 5) que ficaram FORA do lucro por não terem custo (20261234000000).
    SELECT COUNT(DISTINCT p.id)
    INTO products_without_cost
    FROM public.produtos p
    JOIN public.marketplace_order_items oi ON p.id = oi.product_id
    JOIN public.marketplace_orders o ON oi.order_id = o.id
    WHERE o.status NOT IN ('cancelled', 'returned')
    AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
    AND p.deleted_at IS NULL
    AND p.custo IS NULL;

    -- 6. Dinheiro reconhecido fora da regra de status (achados 2 e 3)
    SELECT COUNT(*) INTO delivered_total
    FROM public.marketplace_orders
    WHERE status = 'delivered';

    SELECT COUNT(*) INTO paid_on_cancelled
    FROM public.marketplace_orders
    WHERE payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND status = 'cancelled';

    -- BUILD FINAL OBJECT (Matching DashboardStats interface 100%)
    result := json_build_object(
        'today', json_build_object(
            'revenue', today_revenue,
            'count', today_count,
            'pending', today_pending,
            'revenueTrend', round(today_rev_trend, 1),
            'countTrend', round(today_count_trend, 1)
        ),
        'month', json_build_object(
            'revenue', month_revenue,
            'count', month_count,
            'revenueTrend', round(month_rev_trend, 1),
            'countTrend', round(month_count_trend, 1)
        ),
        'executive', json_build_object(
            'totalRevenue', total_rev,
            'totalOrders', total_ord,
            'revenueTrend', 0,
            'ordersTrend', 0,
            'avgTicket', round(avg_ticket, 2),
            'avgTicketTrend', 0,
            'activeCustomers', active_customers,
            'activeCustomersTrend', 0
        ),
        'revenueHistory', COALESCE(rev_history, '[]'::json),
        'topProducts', COALESCE(top_prods, '[]'::json),
        'inventoryAlerts', low_stock_count,
        'growth', round(month_rev_trend, 1),
        'inventory', json_build_object(
            'totalCost', inv_cost_total,
            'totalValue', inv_value_total
        ),
        'averageTicket', round(avg_ticket, 2),
        'deliveredTotal', delivered_total,
        'paidOnCancelled', paid_on_cancelled,
        'productsWithoutCost', products_without_cost
    );

    RETURN result;
END;
$$;

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o novo, se algum atributo
-- mudou, ou se a ACL ficou aberta (PUBLIC ou anon com EXECUTE; authenticated sem).
DO $conferencia_20261234$
DECLARE
  v_fn CONSTANT text := 'public.get_admin_analytics_v2(integer)';
  v_oid oid := to_regprocedure('public.get_admin_analytics_v2(integer)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261234: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_analytics_v2') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261234: get_admin_analytics_v2 ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '05eac70f6bd4360c1f71fd373747ad0e' THEN
    RAISE EXCEPTION 'conferencia 20261234: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90'
          AND pg_get_function_result(p.oid) = 'json'
     ) THEN
    RAISE EXCEPTION 'conferencia 20261234: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261234: % alcançável por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261234: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261234: authenticated perdeu EXECUTE em %', v_fn;
  END IF;
END $conferencia_20261234$;

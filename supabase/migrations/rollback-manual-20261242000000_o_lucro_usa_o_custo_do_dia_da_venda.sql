-- ============================================================================
-- Rollback manual — o lucro usa o custo do dia da venda (20261242000000)
-- ============================================================================
-- Recria os DOIS corpos de antes, byte a byte (o md5 de replace(prosrc, E'\r', '') volta a ser o de antes e a
-- prova viva confere):
--   get_admin_analytics_v2(integer)  dceb62881ebf8fa404ba3ac295041691 -> 05eac70f6bd4360c1f71fd373747ad0e  (o corpo da 20261234000000)
--   fin_dre(date,date)               afc3e13805ce37819cfdcd094043087c -> e58ac49d3881a459b929064a3acb470a  (o corpo da 20261199000000)
-- tira o gatilho tr_marketplace_order_items_guarda_o_custo_do_dia e a função marketplace_order_item__guarda_o_custo_do_dia.
-- A TABELA marketplace_order_item_custo FICA, com todos os registros (ver DADOS). Assinatura, SECURITY DEFINER,
-- search_path e retorno são os mesmos.
--
-- A ACL das duas funções NÃO é tocada: CREATE OR REPLACE preserva dono e privilégios, e este arquivo não tem
-- nenhum GRANT — nunca devolve EXECUTE a anon ou a PUBLIC.
--
-- COM ELE VOLTA O DEFEITO: o lucro do CRM e o CMV da DRE voltam a usar o custo de HOJE de cada produto em
-- TODA venda (mudar o custo reescreve o relatório do passado), e os números de vendas feitas depois da migration
-- podem mudar.
--
-- DADOS: NENHUM dado é apagado. O custo do dia de cada venda é a entrega da migration e NÃO se reconstrói (o
-- custo do produto muda e o de ontem se perde), por isso este rollback deixa a tabela e os registros no lugar.
-- Sem o gatilho, itens novos deixam de ganhar registro (usam o custo de hoje) e os relatórios voltam a ler só o
-- custo de hoje; REAPLICAR a 20261242000000 depois aceita a tabela já presente e os registros voltam a valer.
-- Apagar a tabela é o SEGUNDO degrau, em arquivo à parte e só com o dono:
-- rollback-manual-destrutivo-20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql. Nenhuma linha de pedido, item ou
-- produto é tocada.
--
-- TRAVA: `DROP TRIGGER` pede a tabela de itens em ACCESS EXCLUSIVE. O pré-voo tenta `LOCK ... NOWAIT` em laço
-- (4 s no máximo, 100 ms entre tentativas) em vez de entrar na fila e parar as vendas; passado o prazo recusa
-- (55P03) sem gravar nada e basta repetir fora do horário de pico.
--
-- ORDEM DENTRO DO ARQUIVO: o gatilho cai primeiro, depois os dois corpos e a função do gatilho.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se uma das funções não existir ou tiver sobrecarga; se o corpo vivo
-- não for o desta migration (desfaz) nem o vigente de antes (já desfeito: reescreve o mesmo texto); se os
-- atributos não forem os de sempre; ou se PUBLIC/anon tiverem EXECUTE ou authenticated não tiver. Desfazer por
-- cima de uma redefinição POSTERIOR apagaria a dela em silêncio: por isso qualquer outro corpo aborta.
--
-- DEPOIS DESTE ROLLBACK a tabela só sai pelo rollback-destrutivo (só com o dono).
--
-- ORDEM ENTRE ROLLBACKS: este vem ANTES do rollback da 20261234000000 e do rollback da 20261199000000 (o
-- pré-voo deles recusa o corpo novo enquanto ele estiver no ar).
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de
-- nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261242$
DECLARE
  r record;
  v_oid oid;
  v_hash text;
  v_tentativa integer := 0;
BEGIN
  IF to_regclass('public.marketplace_order_items') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marketplace_order_items não existe — nada a devolver.';
  END IF;
  -- A trava vem ANTES de qualquer leitura que decida e SEM esperar na fila (ver o cabeçalho).
  LOOP
    BEGIN
      LOCK TABLE public.marketplace_order_items IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      v_tentativa := v_tentativa + 1;
      IF v_tentativa >= 40 THEN
        RAISE EXCEPTION 'PREFLIGHT_ROLLBACK_20261242: public.marketplace_order_items ficou ocupada por mais de 4 s — nada foi gravado; repita fora do horário de pico.'
          USING ERRCODE = 'lock_not_available';
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;

  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.get_admin_analytics_v2(integer)', '05eac70f6bd4360c1f71fd373747ad0e', 'dceb62881ebf8fa404ba3ac295041691'),
        ('public.fin_dre(date,date)', 'e58ac49d3881a459b929064a3acb470a', 'afc3e13805ce37819cfdcd094043087c')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', r.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname = substring(r.assinatura FROM 'public\.([a-z_0-9]+)\(')) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public — revise antes de devolver o corpo vigente.', r.assinatura;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o vigente de antes — uma redefinição posterior está no ar; revise antes de sobrescrever.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % está aberta para PUBLIC — o estado de antes nunca teve PUBLIC; revise a ACL antes.', r.assinatura;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (anon sem, authenticated com) — revise a ACL antes.', r.assinatura;
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.get_admin_analytics_v2(integer)')
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90'
          AND pg_get_function_result(p.oid) = 'json'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de get_admin_analytics_v2 não são os conhecidos — revise antes de sobrescrever.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.fin_dre(date,date)')
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de fin_dre não são os conhecidos — revise antes de sobrescrever.';
  END IF;
END $preflight_rollback_20261242$;

-- O gatilho cai PRIMEIRO (a trava de tabela pega no pré-voo segura qualquer item novo até o fim da transação).
DROP TRIGGER IF EXISTS tr_marketplace_order_items_guarda_o_custo_do_dia ON public.marketplace_order_items;

-- get_admin_analytics_v2: o corpo vigente da 20261234000000.
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

-- fin_dre: o corpo vigente da 20261199000000.
CREATE OR REPLACE FUNCTION public.fin_dre(p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_online numeric;
  v_balcao numeric;
  v_outras_receitas numeric;
  v_ded_derivadas numeric;
  v_ded_manuais numeric;
  v_deducoes numeric;
  v_cmv numeric;
  v_cmv_volta numeric;
  v_variaveis numeric;
  v_fixas numeric;
  v_financeiro numeric;
  v_bruta numeric;
  v_liquida numeric;
  v_lucro_bruto numeric;
  v_margem numeric;
  v_operacional numeric;
  v_linhas_manuais jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;

  -- Competência: derivados pela data do dinheiro; manuais pela competência,
  -- previstos inclusive (a despesa do mês pesa no mês, paga ou não). Estorno
  -- pendente ainda não é dedução. Uma consulta só (sem tabela temporária: a
  -- função roda também em transação só-leitura).
  WITH mov AS (
    SELECT * FROM public.fin__movimentos(NULL, NULL) m
     WHERE m.data_competencia BETWEEN p_inicio AND p_fim
       AND (m.status = 'realizado' OR (m.status = 'previsto' AND m.origem <> 'estorno'))
  ), manuais AS (
    SELECT m.tipo, m.valor, c.grupo_dre, c.nome
      FROM mov m JOIN public.fin_categorias c ON c.id = m.categoria_id
     WHERE m.origem IN ('manual', 'ajuste_caixa') AND m.tipo <> 'transferencia'
  )
  SELECT
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem IN ('venda_online', 'venda_entrega')),
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem = 'venda_balcao'),
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem IN ('estorno', 'estorno_externo', 'devolucao')),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'entrada' AND grupo_dre = 'receita'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'deducao'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'custo_variavel'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'despesa_fixa'),
    (SELECT COALESCE(sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0)
       FROM manuais WHERE grupo_dre = 'financeiro'),
    -- CMV estimado pelo custo ATUAL do produto (o app não guarda custo
    -- histórico), menos o que voltou para a prateleira por devolução no
    -- período. Achado K, refinado pelo achado 4 (rodada 2): a exclusão não é
    -- "stock_returned_at preenchido" sozinho — a política P1 (pago após
    -- expirar, HONRAR) deixa esse carimbo em pedido que foi reativado e
    -- ENTREGUE de verdade (não é mais cancelamento nenhum, e o produto SAIU
    -- da loja outra vez, com custo real). Só CANCELADO com estoque já de
    -- volta é que não custou nada; por isso a condição junta as duas coisas.
    (SELECT COALESCE(sum(oi.quantity * COALESCE(p.custo, 0)), 0)
       FROM mov m
       JOIN public.marketplace_orders o2 ON o2.id = m.pedido_id
       JOIN public.marketplace_order_items oi ON oi.order_id = m.pedido_id
       LEFT JOIN public.produtos p ON p.id = oi.product_id
      WHERE m.origem IN ('venda_online', 'venda_balcao', 'venda_entrega')
        AND NOT (o2.status = 'cancelled' AND o2.stock_returned_at IS NOT NULL)),
    -- Achado 5 (rodada 2): o desconto de devolução PARCIAL não pode contar de
    -- novo o item de um pedido que a linha acima JÁ excluiu inteiro (cancelado
    -- + estoque de volta) — sem este filtro, o mesmo item saía do CMV duas
    -- vezes (uma pela exclusão do pedido inteiro, outra por este desconto) e
    -- comia o custo de OUTRAS vendas do período.
    (SELECT COALESCE(sum(di.quantidade * COALESCE(p.custo, 0)), 0)
       FROM public.devolucao_itens di
       JOIN public.devolucoes d3 ON d3.id = di.devolucao_id
       JOIN public.marketplace_orders o3 ON o3.id = d3.order_id
       LEFT JOIN public.produtos p ON p.id = di.product_id
      WHERE di.reestocado_em IS NOT NULL
        AND public.fin__dia(di.reestocado_em) BETWEEN p_inicio AND p_fim
        AND NOT (o3.status = 'cancelled' AND o3.stock_returned_at IS NOT NULL)),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('grupo', g.grupo_dre, 'categoria', g.nome, 'valor', g.total)
                               ORDER BY g.ordem, g.total DESC), '[]'::jsonb)
       FROM (SELECT grupo_dre, nome, sum(valor) AS total,
                    CASE grupo_dre WHEN 'receita' THEN 1 WHEN 'deducao' THEN 2 WHEN 'custo_variavel' THEN 4
                                   WHEN 'despesa_fixa' THEN 5 ELSE 6 END AS ordem
               FROM manuais WHERE grupo_dre <> 'fora_dre'
              GROUP BY grupo_dre, nome) g)
    INTO v_online, v_balcao, v_ded_derivadas, v_outras_receitas, v_ded_manuais,
         v_variaveis, v_fixas, v_financeiro, v_cmv, v_cmv_volta, v_linhas_manuais;

  v_cmv := GREATEST(v_cmv - v_cmv_volta, 0);
  v_deducoes := v_ded_derivadas + v_ded_manuais;
  v_bruta := v_online + v_balcao + v_outras_receitas;
  v_liquida := v_bruta - v_deducoes;
  v_lucro_bruto := v_liquida - v_cmv;
  v_margem := v_lucro_bruto - v_variaveis;
  v_operacional := v_margem - v_fixas;

  RETURN jsonb_build_object(
    'receita_bruta', v_bruta,
    'receita_online', v_online,
    'receita_balcao', v_balcao,
    'deducoes', v_deducoes,
    'receita_liquida', v_liquida,
    'cmv', v_cmv,
    'cmv_estimado', true,
    'lucro_bruto', v_lucro_bruto,
    'custos_variaveis', v_variaveis,
    'margem_contribuicao', v_margem,
    'despesas_fixas', v_fixas,
    'resultado_operacional', v_operacional,
    'resultado_financeiro', v_financeiro,
    'lucro_liquido', v_operacional + v_financeiro,
    'linhas',
      (SELECT COALESCE(jsonb_agg(l - 'ordem' ORDER BY (l ->> 'ordem')::int), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('grupo', 'receita', 'categoria', 'Vendas pelo app', 'valor', v_online, 'ordem', 1) AS l
          WHERE v_online > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'receita', 'categoria', 'Vendas na loja física', 'valor', v_balcao, 'ordem', 1)
          WHERE v_balcao > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'deducao', 'categoria', 'Estornos e devoluções', 'valor', v_ded_derivadas, 'ordem', 2)
          WHERE v_ded_derivadas > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'cmv', 'categoria', 'Custo das mercadorias vendidas', 'valor', v_cmv, 'ordem', 3)
          WHERE v_cmv > 0
       ) x) || v_linhas_manuais
  );
END;
$$;

DROP FUNCTION IF EXISTS public.marketplace_order_item__guarda_o_custo_do_dia();
-- A tabela marketplace_order_item_custo NÃO é apagada aqui: ver DADOS no cabeçalho.

DO $conferencia_rollback_20261242$
DECLARE
  r record;
  v_oid oid;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.get_admin_analytics_v2(integer)', '05eac70f6bd4360c1f71fd373747ad0e'),
        ('public.fin_dre(date,date)', 'e58ac49d3881a459b929064a3acb470a')
      ) AS esperado(assinatura, hash_vigente)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM r.hash_vigente THEN
      RAISE EXCEPTION 'conferencia rollback 20261242: corpo vivo de % (hash %) não voltou ao vigente', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
      RAISE EXCEPTION 'conferencia rollback 20261242: % aberta para PUBLIC — o estado de antes não tinha PUBLIC', r.assinatura;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia rollback 20261242: ACL de % mudou', r.assinatura;
    END IF;
  END LOOP;
  IF to_regprocedure('public.marketplace_order_item__guarda_o_custo_do_dia()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'tr_marketplace_order_items_guarda_o_custo_do_dia' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'conferencia rollback 20261242: a função ou o gatilho do custo do dia ainda existem';
  END IF;
END $conferencia_rollback_20261242$;

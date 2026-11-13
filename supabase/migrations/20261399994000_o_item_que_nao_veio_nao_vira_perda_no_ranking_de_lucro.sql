-- Migration 20261399994000 — o item que a lojista marcou "Nao veio" nao vira PERDA no ranking de lucro (DINHEIRO ao lado: so a LEITURA do lucro muda).
-- DEFEITO: get_admin_analytics_v2 (o ranking "Produtos que mais dao lucro" e o lucro do grafico diario, regra da 20261399970000) conta como PERDIDA, e
-- desconta o custo, toda peca devolvida que nao voltou a prateleira (reestocado_em vazio). Mas o item de devolucao com condicao = 'ausente' (a lojista marcou
-- "Nao veio" ao concluir: a caixa chegou sem aquele item, a peca NUNCA chegou a cliente) nunca e reestocado (admin_devolucao_concluir so reestoca com condicao
-- diferente de 'ausente') e entrava no mesmo balaio do item que voltou quebrado: o custo de uma peca que nunca saiu da loja virava perda. Uma blusa de R$ 50 (custo 20)
-- com a devolucao concluida e a blusa marcada "Nao veio" mostrava lucro MENOR em R$ 20 do que o real: a lojista ainda tem a blusa, nao perdeu nada.
--
-- REGRA NOVA (so o que muda; o resto do corpo e' o da 20261399970000, byte a byte):
--   perdidas = pecas devolvidas (devolucao concluida, reembolso ou vale) com reestocado_em vazio E condicao diferente de 'ausente'.
--   * 'ausente' continua contando em "devolvidas": o dinheiro foi devolvido, a venda daquela peca sai do lucro e da quantidade do ranking, e o rateio da cortesia
--     segue como estava. O que deixa de existir e' so o custo cobrado como perda.
--   * condicao NULL (devolucao ainda aberta; nem entra na conta, pois a devolucao tem de estar 'concluida') e as demais condicoes (nova, usada, danificada) contam como antes.
--   * Vale nos DOIS lugares: o ranking (topProducts) e o lucro diario (revenueHistory[].profit): dois cartoes da mesma tela nao podem discordar.
--
-- O QUE NAO MUDA: assinatura, retorno, atributos, OID, dono e ACL; nenhum grant novo; nenhum objeto novo; reembolso, estoque e o Financeiro (fin_dre credita o custo so do que
-- foi reestocado: outro olhar, fora desta migration). Pedido sem item 'ausente' devolve os MESMOS numeros de antes, byte a byte no JSON.
-- DADO EXISTENTE: nenhuma linha e lida para escrita nem escrita ao aplicar. O lucro MOSTRADO de pedido cuja devolucao concluida ja tem item 'ausente' passa a sair
-- maior em custo x pecas ausentes (o certo); nada se grava, e desfazer (rollback) devolve o numero de antes.
-- ORDEM: depois da 20261399970000 (o pre-voo recusa corpo desconhecido, inclusive redefinicao posterior) e da coluna devolucao_itens.condicao (ja existe). Banco antes do front
-- (nenhum front muda). Sem ordem em relacao a 20261399992000 (a do "Nao veio" pode ser devolvido de novo): independentes.
-- IDEMPOTENTE: o pre-voo aceita tambem o corpo desta migration; reaplicar troca o corpo pelo mesmo corpo.
-- ATOMICA: sem BEGIN/COMMIT (a transacao pertence ao aplicador, AGENTS.md); a conferencia final derruba o arquivo inteiro se corpo, atributos ou ACL divergirem.
-- Rollback manual (rollback-manual-20261399994000_o_item_que_nao_veio_nao_vira_perda_no_ranking_de_lucro.sql) devolve o corpo da 20261399970000 byte a byte.
-- Comportamento: tests/banco/o-item-que-nao-veio-nao-vira-perda-no-ranking-de-lucro-viva.cjs (so Postgres efemero do CI).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399994000$
DECLARE
  v_fn CONSTANT text := 'public.get_admin_analytics_v2(integer)';
  v_oid oid := to_regprocedure('public.get_admin_analytics_v2(integer)');
  v_hash text;
  v_atributos jsonb;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_analytics_v2') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_analytics_v2 tem sobrecarga em public.';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
        ('public.get_admin_analytics_v2(integer)', '0ea0841208f326971e4f92241929e088', 'cd42b14ee70ab5acdc76427d6e105e11')
    ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261399970000) nem o desta migration; recusa também redefinição posterior.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'json'
          AND p.pronargs = 1
          AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos.', v_fn;
  END IF;

  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (authenticated e service_role com EXECUTE, PUBLIC e anon sem).', v_fn;
  END IF;
  -- As colunas que o corpo vigente ja usa, e as que a conta da devolucao e do estorno passa a usar, continuam obrigatorias.
  FOR r IN
    SELECT * FROM (VALUES
      ('marketplace_orders', 'id'),
      ('marketplace_orders', 'discount'),
      ('marketplace_orders', 'valor_estornado'),
      ('marketplace_order_items', 'order_id'),
      ('marketplace_order_items', 'quantity'),
      ('marketplace_order_items', 'price'),
      ('product_variants', 'price_override'),
      ('order_refunds', 'order_id'),
      ('order_refunds', 'amount'),
      ('order_refunds', 'status'),
      ('order_refunds', 'solicitado_por'),
      ('order_refunds', 'mp_chargeback_id'),
      ('order_refunds', 'created_at'),
      ('devolucoes', 'id'),
      ('devolucoes', 'order_id'),
      ('devolucoes', 'status'),
      ('devolucoes', 'resolucao_final'),
      ('devolucoes', 'refund_id'),
      ('devolucoes', 'reembolso_manual'),
      ('devolucoes', 'valor_reembolso'),
      ('devolucoes', 'concluida_em'),
      ('devolucoes', 'updated_at'),
      ('devolucao_itens', 'devolucao_id'),
      ('devolucao_itens', 'order_item_id'),
      ('devolucao_itens', 'quantidade'),
      ('devolucao_itens', 'reestocado_em'),
      ('devolucao_itens', 'condicao')
    ) AS coluna(tabela, nome)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || r.tabela)
                      AND a.attname = r.nome AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a coluna public.%.% da conta do lucro.', r.tabela, r.nome;
    END IF;
  END LOOP;
  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('ikcous.rank3994_atributos', v_atributos::text, true);
END $preflight_20261399994000$;

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
    inv_revenue_total numeric;
    inv_revenue_without_cost numeric;
    inv_products_without_cost bigint;
    inv_products_with_cost bigint;

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
            END AS estoque,
            CASE
                WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_venda, 0)
                ELSE p.preco_venda * p.estoque
            END AS faturamento
        FROM public.produtos p
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE pv.active) AS qtd_ativas,
                SUM(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas,
                SUM(COALESCE(pv.price_override, p.preco_venda) * COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_venda
            FROM public.product_variants pv
            WHERE pv.product_id = p.id
        ) v ON true
        WHERE p.deleted_at IS NULL AND p.ativo = true
    )
    SELECT
        COUNT(*) FILTER (WHERE estoque <= COALESCE(estoque_minimo, 5)),
        COALESCE(SUM(custo * estoque), 0),
        -- Só produto COM custo: sem custo, a venda inteira contava como lucro em "Lucro se vender tudo" (20261214000000).
        COALESCE(SUM(faturamento) FILTER (WHERE custo IS NOT NULL), 0),
        COALESCE(SUM(faturamento), 0),
        COALESCE(SUM(faturamento) FILTER (WHERE custo IS NULL), 0),
        COUNT(*) FILTER (WHERE custo IS NULL AND estoque > 0),
        COUNT(*) FILTER (WHERE custo IS NOT NULL AND estoque > 0)
    INTO low_stock_count, inv_cost_total, inv_value_total, inv_revenue_total, inv_revenue_without_cost, inv_products_without_cost, inv_products_with_cost
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
        sobra AS (
            -- Estorno SEM devolucao ("cortesia"), por pedido: o que o Mercado Pago confirmou devolvido (valor_estornado)
            -- menos o que foi devolvido POR uma devolucao concluida (a linha de order_refunds ligada em devolucoes.refund_id:
            -- esse dinheiro ja sai do lucro pelas pecas devolvidas, e descontar de novo seria contar duas vezes). Nunca abaixo de zero.
            -- restante = o valor, a preco de tabela, do que NAO foi devolvido: e entre estes itens que a cortesia se reparte.
            SELECT so.id AS order_id,
                   GREATEST(0, COALESCE(so.valor_estornado, 0) - COALESCE((
                       SELECT SUM(rf.amount)
                         FROM public.order_refunds rf
                        WHERE rf.order_id = so.id
                          AND rf.status = 'concluido'
                          AND EXISTS (SELECT 1 FROM public.devolucoes dv_lig
                                       WHERE dv_lig.refund_id = rf.id
                                         AND dv_lig.order_id = so.id)), 0)
                       -- Devolvido pelo painel do Mercado Pago: a linha ligada a devolucao falhou/foi recusada (ou a lojista marcou
                       -- "ja devolvi por fora", que solta o refund_id) e o webhook gravou OUTRA linha 'sistema' concluida depois da
                       -- conclusao (o mesmo criterio de reemitir_reembolso_da_devolucao). valor_estornado ja soma essa linha, mas o dinheiro
                       -- saiu POR uma devolucao: sai do lucro pelas pecas devolvidas, nao de novo como cortesia. Limitado ao que o painel
                       -- de fato devolveu (soma das linhas 'sistema'); sem essa linha, nada se desconta (ligada 'solicitado' continua cortesia).
                       - COALESCE((
                       SELECT LEAST(g.valor, COALESCE((
                                  SELECT SUM(sp.amount)
                                    FROM public.order_refunds sp
                                   WHERE sp.order_id = so.id
                                     AND sp.solicitado_por = 'sistema'
                                     AND sp.status = 'concluido'
                                     AND sp.mp_chargeback_id IS NULL
                                     AND sp.created_at >= g.desde), 0))
                         FROM (SELECT SUM(dvp.valor_reembolso) AS valor,
                                      MIN(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde
                                 FROM public.devolucoes dvp
                                 LEFT JOIN public.order_refunds rlp ON rlp.id = dvp.refund_id
                                WHERE dvp.order_id = so.id
                                  AND dvp.status = 'concluida'
                                  AND dvp.resolucao_final = 'reembolso'
                                  AND dvp.valor_reembolso > 0
                                  AND ((dvp.refund_id IS NULL AND dvp.reembolso_manual)
                                       OR rlp.status IN ('falhou', 'recusado'))) g
                        WHERE g.valor IS NOT NULL), 0)) AS residual,
                   (SELECT COALESCE(SUM((ri.quantity - COALESCE(rd.devolvidas, 0)) * ri.price), 0)
                      FROM public.marketplace_order_items ri
                      LEFT JOIN LATERAL (
                          SELECT LEAST(ri.quantity, COALESCE(SUM(rdi.quantidade), 0))::int AS devolvidas
                            FROM public.devolucao_itens rdi
                            JOIN public.devolucoes rdv ON rdv.id = rdi.devolucao_id
                           WHERE rdi.order_item_id = ri.id
                             AND rdv.status = 'concluida'
                             AND rdv.resolucao_final IN ('reembolso', 'vale')) rd ON true
                     WHERE ri.order_id = so.id) AS restante
              FROM public.marketplace_orders so
             WHERE so.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
               AND COALESCE(so.valor_estornado, 0) > 0
               AND so.status NOT IN ('cancelled', 'returned')
               AND (so.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
        ),
        daily_items AS (
            SELECT
                (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                -- Lucro só dos itens com custo conhecido (custo IS NOT NULL; custo 0 é zero medido e conta): sem custo, a venda inteira virava lucro (20261234000000).
                -- O custo de cada item é o do DIA da venda (marketplace_order_item_custo, 20261242000000); venda sem registro usa o custo de hoje do produto.
                -- Lucro DEPOIS das devoluções e dos estornos (20261399970000), a mesma conta do ranking "Produtos que mais dão lucro", no dia da VENDA:
                -- (vendidas - devolvidas) x (preço - custo - cupom - cortesia) - perdidas x custo.
                COALESCE(SUM((oi.quantity - dev.devolvidas) * (oi.price - COALESCE(oic.custo, p.custo)
                    - CASE
                    WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                    ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                        (SELECT SUM(desconto_item.quantity * desconto_item.price)
                           FROM public.marketplace_order_items desconto_item
                          WHERE desconto_item.order_id = o.id), 0))
                END
                    - CASE
                    WHEN COALESCE(s.residual, 0) <= 0 THEN 0
                    ELSE oi.price * LEAST(1, COALESCE(s.residual / NULLIF(s.restante, 0), 0))
                END)
                    - dev.perdidas * COALESCE(oic.custo, p.custo)) FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit,
                COALESCE(SUM(oi.quantity * COALESCE(oic.custo, p.custo, 0)), 0) AS cost_sold
            FROM public.marketplace_order_items oi
            JOIN public.marketplace_orders o ON oi.order_id = o.id
            JOIN public.produtos p ON oi.product_id = p.id
            LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
        LEFT JOIN LATERAL (
            -- Pecas devolvidas deste item: devolucao concluida com reembolso ou vale (troca NAO conta: a peca sai de novo).
            -- perdidas = as que nao voltaram a prateleira (reestocado_em vazio): o custo delas vira perda.
            -- Exceto o item que a lojista marcou "Nao veio" (condicao 'ausente'): a peca nunca chegou a cliente, nunca saiu da loja, entao nao ha o que perder (20261399994000).
            SELECT LEAST(oi.quantity, COALESCE(SUM(di.quantidade), 0))::int AS devolvidas,
                   LEAST(oi.quantity, COALESCE(SUM(di.quantidade) FILTER (WHERE di.reestocado_em IS NULL AND di.condicao IS DISTINCT FROM 'ausente'), 0))::int AS perdidas
              FROM public.devolucao_itens di
              JOIN public.devolucoes dv ON dv.id = di.devolucao_id
             WHERE di.order_item_id = oi.id
               AND dv.status = 'concluida'
               AND dv.resolucao_final IN ('reembolso', 'vale')) dev ON true
        LEFT JOIN sobra s ON s.order_id = o.id
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
    -- Lucro DEPOIS das devoluções e dos estornos (20261399970000): (vendidas - devolvidas) x (preço - custo - cupom - cortesia) - perdidas x custo.
    -- Devolvida = peça de devolução CONCLUÍDA com reembolso ou vale (troca não conta); perdida = a que não voltou à prateleira.
    -- Cortesia = estorno do pedido sem devolução por trás (CTE sobra). A quantidade do ranking é vendidas - devolvidas.
    SELECT json_agg(p)
    INTO top_prods
    FROM (
        WITH
        sobra AS (
            -- Estorno SEM devolucao ("cortesia"), por pedido: o que o Mercado Pago confirmou devolvido (valor_estornado)
            -- menos o que foi devolvido POR uma devolucao concluida (a linha de order_refunds ligada em devolucoes.refund_id:
            -- esse dinheiro ja sai do lucro pelas pecas devolvidas, e descontar de novo seria contar duas vezes). Nunca abaixo de zero.
            -- restante = o valor, a preco de tabela, do que NAO foi devolvido: e entre estes itens que a cortesia se reparte.
            SELECT so.id AS order_id,
                   GREATEST(0, COALESCE(so.valor_estornado, 0) - COALESCE((
                       SELECT SUM(rf.amount)
                         FROM public.order_refunds rf
                        WHERE rf.order_id = so.id
                          AND rf.status = 'concluido'
                          AND EXISTS (SELECT 1 FROM public.devolucoes dv_lig
                                       WHERE dv_lig.refund_id = rf.id
                                         AND dv_lig.order_id = so.id)), 0)
                       -- Devolvido pelo painel do Mercado Pago: a linha ligada a devolucao falhou/foi recusada (ou a lojista marcou
                       -- "ja devolvi por fora", que solta o refund_id) e o webhook gravou OUTRA linha 'sistema' concluida depois da
                       -- conclusao (o mesmo criterio de reemitir_reembolso_da_devolucao). valor_estornado ja soma essa linha, mas o dinheiro
                       -- saiu POR uma devolucao: sai do lucro pelas pecas devolvidas, nao de novo como cortesia. Limitado ao que o painel
                       -- de fato devolveu (soma das linhas 'sistema'); sem essa linha, nada se desconta (ligada 'solicitado' continua cortesia).
                       - COALESCE((
                       SELECT LEAST(g.valor, COALESCE((
                                  SELECT SUM(sp.amount)
                                    FROM public.order_refunds sp
                                   WHERE sp.order_id = so.id
                                     AND sp.solicitado_por = 'sistema'
                                     AND sp.status = 'concluido'
                                     AND sp.mp_chargeback_id IS NULL
                                     AND sp.created_at >= g.desde), 0))
                         FROM (SELECT SUM(dvp.valor_reembolso) AS valor,
                                      MIN(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde
                                 FROM public.devolucoes dvp
                                 LEFT JOIN public.order_refunds rlp ON rlp.id = dvp.refund_id
                                WHERE dvp.order_id = so.id
                                  AND dvp.status = 'concluida'
                                  AND dvp.resolucao_final = 'reembolso'
                                  AND dvp.valor_reembolso > 0
                                  AND ((dvp.refund_id IS NULL AND dvp.reembolso_manual)
                                       OR rlp.status IN ('falhou', 'recusado'))) g
                        WHERE g.valor IS NOT NULL), 0)) AS residual,
                   (SELECT COALESCE(SUM((ri.quantity - COALESCE(rd.devolvidas, 0)) * ri.price), 0)
                      FROM public.marketplace_order_items ri
                      LEFT JOIN LATERAL (
                          SELECT LEAST(ri.quantity, COALESCE(SUM(rdi.quantidade), 0))::int AS devolvidas
                            FROM public.devolucao_itens rdi
                            JOIN public.devolucoes rdv ON rdv.id = rdi.devolucao_id
                           WHERE rdi.order_item_id = ri.id
                             AND rdv.status = 'concluida'
                             AND rdv.resolucao_final IN ('reembolso', 'vale')) rd ON true
                     WHERE ri.order_id = so.id) AS restante
              FROM public.marketplace_orders so
             WHERE COALESCE(so.valor_estornado, 0) > 0
               AND so.status NOT IN ('cancelled', 'returned')
               AND (so.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
        )
        SELECT
            p.id as id,
            p.nome AS name,
            SUM(oi.quantity - dev.devolvidas)::int as quantity,
            SUM((oi.quantity - dev.devolvidas) * (oi.price - COALESCE(oic.custo, p.custo) - CASE
                    WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                    ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                        (SELECT SUM(desconto_item.quantity * desconto_item.price)
                           FROM public.marketplace_order_items desconto_item
                          WHERE desconto_item.order_id = o.id), 0))
                END
                    - CASE
                    WHEN COALESCE(s.residual, 0) <= 0 THEN 0
                    ELSE oi.price * LEAST(1, COALESCE(s.residual / NULLIF(s.restante, 0), 0))
                END)
                - dev.perdidas * COALESCE(oic.custo, p.custo)) as total,
            COALESCE(p.imagem_url, '') as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
        LEFT JOIN LATERAL (
            -- Pecas devolvidas deste item: devolucao concluida com reembolso ou vale (troca NAO conta: a peca sai de novo).
            -- perdidas = as que nao voltaram a prateleira (reestocado_em vazio): o custo delas vira perda.
            -- Exceto o item que a lojista marcou "Nao veio" (condicao 'ausente'): a peca nunca chegou a cliente, nunca saiu da loja, entao nao ha o que perder (20261399994000).
            SELECT LEAST(oi.quantity, COALESCE(SUM(di.quantidade), 0))::int AS devolvidas,
                   LEAST(oi.quantity, COALESCE(SUM(di.quantidade) FILTER (WHERE di.reestocado_em IS NULL AND di.condicao IS DISTINCT FROM 'ausente'), 0))::int AS perdidas
              FROM public.devolucao_itens di
              JOIN public.devolucoes dv ON dv.id = di.devolucao_id
             WHERE di.order_item_id = oi.id
               AND dv.status = 'concluida'
               AND dv.resolucao_final IN ('reembolso', 'vale')) dev ON true
        LEFT JOIN sobra s ON s.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
        AND p.deleted_at IS NULL
        -- Só item com custo conhecido (o do dia da venda, ou o de hoje do produto): sem custo o ranking de LUCRO empatava com a receita (20261234000000, 20261242000000).
        AND COALESCE(oic.custo, p.custo) IS NOT NULL
        GROUP BY p.id, p.nome, p.imagem_url
        ORDER BY total DESC
        LIMIT 5
    ) p;

    -- 5b. Produtos vendidos (mesma regra de venda do top 5) que ficaram FORA do lucro por não terem custo (20261234000000): venda sem custo do dia e produto sem custo hoje (20261242000000).
    SELECT COUNT(DISTINCT p.id)
    INTO products_without_cost
    FROM public.produtos p
    JOIN public.marketplace_order_items oi ON p.id = oi.product_id
    JOIN public.marketplace_orders o ON oi.order_id = o.id
    LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
    WHERE o.status NOT IN ('cancelled', 'returned')
    AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
    AND p.deleted_at IS NULL
    AND COALESCE(oic.custo, p.custo) IS NULL;

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
            'totalValue', inv_value_total,
            'totalRevenue', inv_revenue_total,
            'revenueWithoutCost', inv_revenue_without_cost,
            'productsWithoutCost', inv_products_without_cost,
            'productsWithCost', inv_products_with_cost
        ),
        'averageTicket', round(avg_ticket, 2),
        'deliveredTotal', delivered_total,
        'paidOnCancelled', paid_on_cancelled,
        'productsWithoutCost', products_without_cost
    );

    RETURN result;
END;
$$;

-- Pós-voo: corpo, atributos, ACL e fotografia do pre-voo; qualquer divergência aborta a transação do aplicador.
DO $conferencia_20261399994000$
DECLARE
  v_fn CONSTANT text := 'public.get_admin_analytics_v2(integer)';
  v_oid oid := to_regprocedure('public.get_admin_analytics_v2(integer)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'cd42b14ee70ab5acdc76427d6e105e11' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de % tem hash %; esperado cd42b14ee70ab5acdc76427d6e105e11.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_analytics_v2') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_analytics_v2 ficou com sobrecarga.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'json'
          AND p.pronargs = 1
          AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos.', v_fn;
  END IF;

  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (authenticated e service_role com EXECUTE, PUBLIC e anon sem).', v_fn;
  END IF;
  -- OID, dono, ACL e todos os atributos iguais aos da fotografia do pre-voo: so o texto do corpo mudou.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = v_oid
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.rank3994_atributos')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final de % falhou (OID, dono, ACL ou atributo mudou).', v_fn;
  END IF;
END $conferencia_20261399994000$;

NOTIFY pgrst, 'reload schema';

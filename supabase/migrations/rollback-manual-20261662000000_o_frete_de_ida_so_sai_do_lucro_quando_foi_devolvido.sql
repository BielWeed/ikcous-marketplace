-- ============================================================================
-- Rollback manual — o lucro do ranking só desconta o reembolso que saiu, e o frete de ida só quando foi devolvido (20261662000000)
-- ============================================================================
-- Devolve, byte a byte (LF), mantendo OID, dono, atributos, comentário e ACL (CREATE OR REPLACE; nenhum GRANT nem REVOKE):
--   public.get_admin_analytics_v2(integer) ao corpo da 20261659000000 (md5 1624212a7096b6f49a80370b30191a15).
--
-- NÃO APAGA NENHUMA LINHA: a função só lê (nada foi gravado por ela enquanto esteve no ar).
--
-- COM ELE VOLTAM OS DEFEITOS descritos no cabeçalho da migration 20261662000000 (o frete de ida gravado sai do dinheiro devolvido mesmo
-- quando o reembolso não o pagou; o reembolso pendente, falho ou recusado sai do lucro; o ranking e o gráfico divergem do Financeiro).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se o corpo vivo não for o desta migration nem o da 20261659000000 (repetir o rollback é
-- no-op), ou se os atributos ou a ACL não forem os de sempre. O pós-voo recusa se o corpo não voltou ou se OID, dono, ACL ou
-- atributos mudaram.
--
-- ORDEM: este vem ANTES do rollback da 20261659000000 (o pré-voo dele recusa o corpo desta). Executar pelo aplicar-migrations.yml
-- (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261662000000$
DECLARE
  v_ana oid := to_regprocedure('public.get_admin_analytics_v2(integer)');
  v_hash text;
  r record;
BEGIN
  -- Uma so com este nome em public (sem sobrecarga), e presente.
  IF v_ana IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_analytics_v2') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_analytics_v2 ausente ou com sobrecarga em public; revise antes de desfazer.';
  END IF;

  -- Corpo vivo: o anterior (a, rollback reaplicado) ou o desta migration (b).
  FOR r IN
    SELECT * FROM (VALUES
      ('public.get_admin_analytics_v2(integer)', '1624212a7096b6f49a80370b30191a15', 'b6cb9b487fdc4b603ce9313b46184897')
    ) AS esperado(assinatura, hash_a, hash_b)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_a, r.hash_b) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) nao e o da 20261662000000 nem o anterior; revise antes de desfazer.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- Atributos de sempre: plpgsql, SECURITY DEFINER, VOLATILE, nao STRICT, search_path=public, a assinatura e o retorno.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_ana AND p.prokind = 'f' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND NOT p.proisstrict AND NOT p.proretset AND p.proconfig = ARRAY['search_path=public']::text[]
                    AND pg_get_function_result(p.oid) = 'json' AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: assinatura ou atributos de get_admin_analytics_v2 nao sao os conhecidos; revise antes de desfazer.';
  END IF;

  -- ACL de sempre: EXECUTE nunca de PUBLIC nem de anon; do authenticated (o painel) e do service_role.
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_ana AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_ana, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_ana, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_ana, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o EXECUTE de get_admin_analytics_v2 nao e o conhecido; revise antes de desfazer.';
  END IF;

  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE so pode trocar o texto).
  PERFORM set_config('ikcous.frete1662_rb_ana', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_ana)::text, true);
END $preflight_rollback_20261662000000$;

-- get_admin_analytics_v2: o corpo da 20261659000000, byte a byte.
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
        devs AS MATERIALIZED (
            -- DINHEIRO de cada devolucao CONCLUIDA com reembolso ou vale (troca NAO conta: a peca sai de novo), em reais de PRODUTO (sem o frete de ida) (20261399995000).
            -- vv = valor das pecas que voltaram (toda condicao menos 'ausente'); va = valor das pecas 'Nao veio' (ficaram com a cliente).
            -- pm = o dinheiro devolvido: reembolso = valor_reembolso menos o frete de ida (devolucao de reembolso SEM valor gravado = o das pecas que voltaram, como era antes);
            -- vale = 0 (20261659000000): o vale-troca e' credito na loja, nao dinheiro que saiu; como no Financeiro, a venda da peca fica no lucro
            -- e as pecas do vale seguem na quantidade devolvida e no custo que volta (reestocadas). Antes era o valor das pecas que voltaram.
            -- fv / fa = a fracao do valor de cada peca que esse dinheiro cobriu: primeiro as pecas que voltaram, so depois as 'Nao veio'.
            -- excesso = o que passou do valor de todas as pecas da devolucao: vai para o rateio do pedido (como o estorno sem devolucao).
            SELECT dv.id AS devolucao_id,
                   dv.order_id,
                   CASE WHEN x.vv > 0 THEN LEAST(m.pm, x.vv) / x.vv ELSE 0 END AS fv,
                   CASE WHEN x.va > 0 THEN LEAST(GREATEST(m.pm - x.vv, 0), x.va) / x.va ELSE 0 END AS fa,
                   GREATEST(0, m.pm - x.vv - x.va) AS excesso
              FROM public.devolucoes dv
              CROSS JOIN LATERAL (SELECT COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao IS DISTINCT FROM 'ausente'), 0) AS vv,
                                         COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao = 'ausente'), 0) AS va
                                    FROM public.devolucao_itens dx
                                   WHERE dx.devolucao_id = dv.id) x
              CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'vale' THEN 0
                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL
                                              THEN GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))
                                              ELSE x.vv END AS pm) m
             WHERE dv.status = 'concluida'
               AND dv.resolucao_final IN ('reembolso', 'vale')
               AND EXISTS (SELECT 1 FROM public.marketplace_orders dj
                            WHERE dj.id = dv.order_id
                              AND dj.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day')
        ),
        dev_item AS (
            -- O que as devolucoes concluidas fizeram com CADA item vendido, numa passada so (agrupado por item):
            -- pecas devolvidas que voltaram (sem as 'Nao veio'), as que voltaram a PRATELEIRA (reestocado_em preenchido: so o custo delas e' devolvido ao lucro)
            -- e o dinheiro que as devolucoes devolveram POR este item (fv/fa de cada devolucao).
            SELECT di.order_item_id,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0) AS devolvidas,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.reestocado_em IS NOT NULL AND di.condicao IS DISTINCT FROM 'ausente'), 0) AS reestocadas,
                   COALESCE(SUM(di.quantidade * di.valor_unitario * CASE WHEN di.condicao = 'ausente' THEN d.fa ELSE d.fv END), 0) AS dinheiro
              FROM public.devolucao_itens di
              JOIN devs d ON d.devolucao_id = di.devolucao_id
             GROUP BY di.order_item_id
        ),
        pecas AS MATERIALIZED (
            -- Uma linha por item vendido: pago = o que a cliente pagou por UMA peca (preco menos o rateio do cupom);
            -- dinheiro_dev = o dinheiro devolvido por este item pelas devolucoes, nunca acima do que o item pagou.
            -- A consulta de baixo sai DAQUI (produto, dia e status do pedido vem junto): juntar de novo pelo item_id deixava o planejador sem estatistica da CTE e ele refazia a conta por linha.
            SELECT oi.id AS item_id,
                   oi.order_id,
                   oi.product_id,
                   o.created_at AS criado_em,
                   o.payment_status AS pst,
                   oi.quantity AS q,
                   pg.pago,
                   LEAST(oi.quantity, COALESCE(dv.devolvidas, 0))::int AS devolvidas,
                   LEAST(oi.quantity, COALESCE(dv.reestocadas, 0))::int AS reestocadas,
                   LEAST(oi.quantity * pg.pago, COALESCE(dv.dinheiro, 0)) AS dinheiro_dev
              FROM public.marketplace_order_items oi
              JOIN public.marketplace_orders o ON o.id = oi.order_id
              CROSS JOIN LATERAL (SELECT oi.price - CASE
                        WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                        ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                            (SELECT SUM(desconto_item.quantity * desconto_item.price)
                               FROM public.marketplace_order_items desconto_item
                              WHERE desconto_item.order_id = o.id), 0))
                    END AS pago) pg
              LEFT JOIN dev_item dv ON dv.order_item_id = oi.id
             WHERE o.status NOT IN ('cancelled', 'returned')
               AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))
               AND o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
        ),
        sobra AS MATERIALIZED (
            -- Dinheiro devolvido que NAO tem peca por tras, por pedido, e quanto dele cai em cada item (taxa de 0 a 1 do que o item ainda pagou).
            -- residual = ESTORNO SEM devolucao ("cortesia"): o que o Mercado Pago confirmou devolvido (valor_estornado) menos o que foi devolvido POR uma devolucao
            -- concluida (a linha de order_refunds ligada em devolucoes.refund_id: esse dinheiro ja entra pelo dinheiro_dev). Nunca abaixo de zero.
            -- excesso = o que uma devolucao devolveu alem do valor das pecas dela. folga = o que os itens do pedido ainda pagaram depois do dinheiro das devolucoes:
            -- e' entre eles que o residual e o excesso se repartem (proporcional), sem passar do que cada um pagou. Dinheiro que sobrar sem item para receber nao e' lucro de produto
            -- (o frete devolvido, por exemplo). Pedido 'estornado' (devolvido por inteiro) fica com a folga toda: o Financeiro o conta como pago e devolvido.
            SELECT t.order_id,
                   CASE WHEN t.estornado THEN 1
                        ELSE LEAST(1, COALESCE((t.residual + t.excesso) / NULLIF(t.folga, 0), 0)) END AS taxa
              FROM (
            SELECT so.id AS order_id,
                   so.payment_status = 'estornado' AS estornado,
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
                   COALESCE(ex.excesso, 0) AS excesso,
                   COALESCE(pf.folga, 0) AS folga
              FROM public.marketplace_orders so
              LEFT JOIN (SELECT dd.order_id, SUM(dd.excesso) AS excesso FROM devs dd GROUP BY dd.order_id) ex ON ex.order_id = so.id
              LEFT JOIN (SELECT px.order_id, SUM(px.q * px.pago - px.dinheiro_dev) AS folga FROM pecas px GROUP BY px.order_id) pf ON pf.order_id = so.id
             WHERE (COALESCE(so.valor_estornado, 0) > 0
                    OR so.payment_status = 'estornado'
                    OR ex.order_id IS NOT NULL)
               AND so.status NOT IN ('cancelled', 'returned')
               AND (so.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))
                   AND so.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day') t
        ),
        daily_items AS (
            SELECT
                (pc.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                -- Lucro só dos itens com custo conhecido (custo IS NOT NULL; custo 0 é zero medido e conta): sem custo, a venda inteira virava lucro (20261234000000).
                -- O custo de cada item é o do DIA da venda (marketplace_order_item_custo, 20261242000000); venda sem registro usa o custo de hoje do produto.
                -- Lucro do produto no dia da VENDA, a mesma conta do ranking "Produtos que mais dão lucro" e do Financeiro, pedido a pedido (20261399995000):
                -- o que a cliente pagou pela peça (já com o cupom) - TODO o dinheiro devolvido (devolução, estorno ou Mercado Pago) - o custo das peças que saíram e NÃO voltaram à prateleira. Sem frete.
                -- Pedido 'estornado' (devolvido por inteiro) entra com -custo das peças que não voltaram; só o cancelado continua fora. A linha de faturamento, os pedidos e o custo vendido seguem como eram.
                COALESCE(SUM(pc.q * (pc.pago - COALESCE(oic.custo, p.custo)) + COALESCE(oic.custo, p.custo) * pc.reestocadas - pc.dinheiro_dev
                    - (pc.q * pc.pago - pc.dinheiro_dev) * COALESCE(s.taxa, 0)) FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit,
                COALESCE(SUM(pc.q * COALESCE(oic.custo, p.custo, 0)) FILTER (WHERE pc.pst <> 'estornado'), 0) AS cost_sold
            FROM pecas pc
            JOIN public.produtos p ON pc.product_id = p.id
            LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = pc.item_id
            LEFT JOIN sobra s ON s.order_id = pc.order_id
            GROUP BY ((pc.criado_em AT TIME ZONE 'America/Sao_Paulo')::date)
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
    -- Lucro do produto, pedido a pedido como o Financeiro (20261399995000): o que a cliente pagou pela peça (já com o cupom) - TODO o dinheiro devolvido
    -- (devolução, estorno ou Mercado Pago, só de produto, sem frete) - o custo das peças que saíram e NÃO voltaram à prateleira. A quantidade do ranking é vendidas - devolvidas.
    -- Pedido 'estornado' (devolvido por inteiro) entra; só o cancelado (sem a venda) continua fora.
    SELECT json_agg(p)
    INTO top_prods
    FROM (
        WITH
        devs AS MATERIALIZED (
            -- DINHEIRO de cada devolucao CONCLUIDA com reembolso ou vale (troca NAO conta: a peca sai de novo), em reais de PRODUTO (sem o frete de ida) (20261399995000).
            -- vv = valor das pecas que voltaram (toda condicao menos 'ausente'); va = valor das pecas 'Nao veio' (ficaram com a cliente).
            -- pm = o dinheiro devolvido: reembolso = valor_reembolso menos o frete de ida (devolucao de reembolso SEM valor gravado = o das pecas que voltaram, como era antes);
            -- vale = 0 (20261659000000): o vale-troca e' credito na loja, nao dinheiro que saiu; como no Financeiro, a venda da peca fica no lucro
            -- e as pecas do vale seguem na quantidade devolvida e no custo que volta (reestocadas). Antes era o valor das pecas que voltaram.
            -- fv / fa = a fracao do valor de cada peca que esse dinheiro cobriu: primeiro as pecas que voltaram, so depois as 'Nao veio'.
            -- excesso = o que passou do valor de todas as pecas da devolucao: vai para o rateio do pedido (como o estorno sem devolucao).
            SELECT dv.id AS devolucao_id,
                   dv.order_id,
                   CASE WHEN x.vv > 0 THEN LEAST(m.pm, x.vv) / x.vv ELSE 0 END AS fv,
                   CASE WHEN x.va > 0 THEN LEAST(GREATEST(m.pm - x.vv, 0), x.va) / x.va ELSE 0 END AS fa,
                   GREATEST(0, m.pm - x.vv - x.va) AS excesso
              FROM public.devolucoes dv
              CROSS JOIN LATERAL (SELECT COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao IS DISTINCT FROM 'ausente'), 0) AS vv,
                                         COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao = 'ausente'), 0) AS va
                                    FROM public.devolucao_itens dx
                                   WHERE dx.devolucao_id = dv.id) x
              CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'vale' THEN 0
                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL
                                              THEN GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))
                                              ELSE x.vv END AS pm) m
             WHERE dv.status = 'concluida'
               AND dv.resolucao_final IN ('reembolso', 'vale')
        ),
        dev_item AS (
            -- O que as devolucoes concluidas fizeram com CADA item vendido, numa passada so (agrupado por item):
            -- pecas devolvidas que voltaram (sem as 'Nao veio'), as que voltaram a PRATELEIRA (reestocado_em preenchido: so o custo delas e' devolvido ao lucro)
            -- e o dinheiro que as devolucoes devolveram POR este item (fv/fa de cada devolucao).
            SELECT di.order_item_id,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0) AS devolvidas,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.reestocado_em IS NOT NULL AND di.condicao IS DISTINCT FROM 'ausente'), 0) AS reestocadas,
                   COALESCE(SUM(di.quantidade * di.valor_unitario * CASE WHEN di.condicao = 'ausente' THEN d.fa ELSE d.fv END), 0) AS dinheiro
              FROM public.devolucao_itens di
              JOIN devs d ON d.devolucao_id = di.devolucao_id
             GROUP BY di.order_item_id
        ),
        pecas AS MATERIALIZED (
            -- Uma linha por item vendido: pago = o que a cliente pagou por UMA peca (preco menos o rateio do cupom);
            -- dinheiro_dev = o dinheiro devolvido por este item pelas devolucoes, nunca acima do que o item pagou.
            -- A consulta de baixo sai DAQUI (produto, dia e status do pedido vem junto): juntar de novo pelo item_id deixava o planejador sem estatistica da CTE e ele refazia a conta por linha.
            SELECT oi.id AS item_id,
                   oi.order_id,
                   oi.product_id,
                   o.created_at AS criado_em,
                   o.payment_status AS pst,
                   oi.quantity AS q,
                   pg.pago,
                   LEAST(oi.quantity, COALESCE(dv.devolvidas, 0))::int AS devolvidas,
                   LEAST(oi.quantity, COALESCE(dv.reestocadas, 0))::int AS reestocadas,
                   LEAST(oi.quantity * pg.pago, COALESCE(dv.dinheiro, 0)) AS dinheiro_dev
              FROM public.marketplace_order_items oi
              JOIN public.marketplace_orders o ON o.id = oi.order_id
              CROSS JOIN LATERAL (SELECT oi.price - CASE
                        WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                        ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                            (SELECT SUM(desconto_item.quantity * desconto_item.price)
                               FROM public.marketplace_order_items desconto_item
                              WHERE desconto_item.order_id = o.id), 0))
                    END AS pago) pg
              LEFT JOIN dev_item dv ON dv.order_item_id = oi.id
             WHERE o.status NOT IN ('cancelled', 'returned')
               AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))
        ),
        sobra AS MATERIALIZED (
            -- Dinheiro devolvido que NAO tem peca por tras, por pedido, e quanto dele cai em cada item (taxa de 0 a 1 do que o item ainda pagou).
            -- residual = ESTORNO SEM devolucao ("cortesia"): o que o Mercado Pago confirmou devolvido (valor_estornado) menos o que foi devolvido POR uma devolucao
            -- concluida (a linha de order_refunds ligada em devolucoes.refund_id: esse dinheiro ja entra pelo dinheiro_dev). Nunca abaixo de zero.
            -- excesso = o que uma devolucao devolveu alem do valor das pecas dela. folga = o que os itens do pedido ainda pagaram depois do dinheiro das devolucoes:
            -- e' entre eles que o residual e o excesso se repartem (proporcional), sem passar do que cada um pagou. Dinheiro que sobrar sem item para receber nao e' lucro de produto
            -- (o frete devolvido, por exemplo). Pedido 'estornado' (devolvido por inteiro) fica com a folga toda: o Financeiro o conta como pago e devolvido.
            SELECT t.order_id,
                   CASE WHEN t.estornado THEN 1
                        ELSE LEAST(1, COALESCE((t.residual + t.excesso) / NULLIF(t.folga, 0), 0)) END AS taxa
              FROM (
            SELECT so.id AS order_id,
                   so.payment_status = 'estornado' AS estornado,
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
                   COALESCE(ex.excesso, 0) AS excesso,
                   COALESCE(pf.folga, 0) AS folga
              FROM public.marketplace_orders so
              LEFT JOIN (SELECT dd.order_id, SUM(dd.excesso) AS excesso FROM devs dd GROUP BY dd.order_id) ex ON ex.order_id = so.id
              LEFT JOIN (SELECT px.order_id, SUM(px.q * px.pago - px.dinheiro_dev) AS folga FROM pecas px GROUP BY px.order_id) pf ON pf.order_id = so.id
             WHERE (COALESCE(so.valor_estornado, 0) > 0
                    OR so.payment_status = 'estornado'
                    OR ex.order_id IS NOT NULL)
               AND so.status NOT IN ('cancelled', 'returned')
               AND (so.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))) t
        )
        SELECT
            p.id as id,
            p.nome AS name,
            SUM(pc.q - pc.devolvidas)::int as quantity,
            SUM(pc.q * (pc.pago - COALESCE(oic.custo, p.custo)) + COALESCE(oic.custo, p.custo) * pc.reestocadas - pc.dinheiro_dev
                    - (pc.q * pc.pago - pc.dinheiro_dev) * COALESCE(s.taxa, 0)) as total,
            COALESCE(p.imagem_url, '') as image
        FROM pecas pc
        JOIN public.produtos p ON p.id = pc.product_id
        LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = pc.item_id
        LEFT JOIN sobra s ON s.order_id = pc.order_id
        WHERE p.deleted_at IS NULL
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

DO $posvoo_rollback_20261662000000$
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_analytics_v2(integer)'))
       IS DISTINCT FROM '1624212a7096b6f49a80370b30191a15'
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_admin_analytics_v2(integer)'))
       IS DISTINCT FROM current_setting('ikcous.frete1662_rb_ana')::jsonb THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: get_admin_analytics_v2 nao ficou com o corpo anterior ou mudou OID, dono, ACL ou atributos.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_analytics_v2') <> 1 THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: get_admin_analytics_v2 ficou com sobrecarga.';
  END IF;
END $posvoo_rollback_20261662000000$;

NOTIFY pgrst, 'reload schema';

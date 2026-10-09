-- ============================================================================
-- Migration 20261214000000 — o lucro do estoque só conta produto com custo
-- (painel simples, onda I, item I6; 09/10/2026)
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION FECHA
--
-- Na tela de Produtos, "Lucro se vender tudo" é `inventory.totalValue -
-- inventory.totalCost` de `get_admin_analytics_v2`
-- (src/views/admin/AdminProductsView.tsx:323-328). `totalCost` soma
-- `custo * estoque` — produto sem custo cadastrado (`custo IS NULL`, possível
-- desde a 20261024000000) some da soma —, mas `totalValue` somava
-- `preco_venda * estoque` de TODO produto (20261199000000:1757). Resultado: a
-- venda inteira de quem não tem custo virava "lucro". Medido na semente da
-- prova viva: produto de R$ 100 x 3 sem custo inflava o lucro em R$ 300.
--
-- 2. A REGRA
--
-- `totalValue` passa a somar o valor de venda SÓ de produto COM custo:
-- `COALESCE(SUM(preco_venda * estoque) FILTER (WHERE custo IS NOT NULL), 0)`.
-- Assim custo e valor cobrem os MESMOS produtos e o lucro é de verdade. Muda
-- só essa linha (mais um comentário de uma linha); o resto do corpo é o
-- vigente da 20261199000000 byte a byte (guarda do admin atual inclusa).
-- Nenhuma chave do JSON muda; `low_stock_count` (`inventoryAlerts`) e o
-- `COALESCE(estoque_minimo, 5)` ficam. Assinatura, RETURNS, SECURITY DEFINER e
-- search_path iguais (sem STABLE, como antes); `CREATE OR REPLACE` preserva
-- dono e ACL — nenhum GRANT/REVOKE aqui, e `database.types.ts` não muda. O
-- único consumidor de `totalValue` é AdminProductsView.tsx:324.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar — só o corpo de
-- uma função muda. O cartão muda na próxima leitura da tela de Produtos.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se o corpo vivo de `public.get_admin_analytics_v2(integer)`, por
-- `md5(replace(prosrc, E'\r', ''))`, não for o vigente (o da 20261199000000)
-- nem o que esta migration deixa. Os hashes são o md5 REAL dos corpos,
-- amarrados ao texto por
-- tests/migration_o_lucro_do_estoque_so_conta_produto_com_custo_test.ts.
--
-- 5. IDEMPOTÊNCIA
--
-- O pré-voo aceita o corpo desta migration; reaplicar deixa o mesmo estado.
--
-- 6. TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa, AGENTS.md). O arquivo
-- vai numa consulta só pelo `aplicar-migrations.yml`; local, `psql -1`.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261199000000 (o pré-voo recusa sem ela). Independe da
-- 20261212000000 e da 20261213000000 (funções diferentes). ROLLBACK MANUAL:
-- rollback-manual-20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql
-- devolve o corpo da 20261199000000 byte a byte.
-- Este rollback vem ANTES do rollback da 20261199000000: o da 99 recusa
-- enquanto houver redefinição posterior no ar
-- (rollback-manual-20261199000000…:93) — é o comportamento certo.
--
-- 8. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.get_admin_analytics_v2(integer)');
--      -- esperado: 0a5f8c75bbeeda3777a6a7326a0e281c.
--   2. Como admin: `get_admin_analytics_v2(90)->'inventory'->>'totalValue'`
--      igual a `SELECT sum(preco_venda * estoque efetivo)` só dos produtos
--      ativos, não apagados e com `custo IS NOT NULL`.
--   3. `proacl`, `prosecdef` e `proconfig` iguais antes e depois.
--   PROVA VIVA: tests/banco/inventario-so-com-custo-viva.cjs (rpc-ci).
-- ============================================================================

DO $preflight_20261214$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.get_admin_analytics_v2(integer)', '6abc7e44b0aae3b2e542e87daf055451', '0a5f8c75bbeeda3777a6a7326a0e281c')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente antes desta migration nem o que ela deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END $preflight_20261214$;

-- get_admin_analytics_v2: corpo vigente da 20261199000000_portas_do_painel_exigem_admin_atual.sql,
-- com o valor de venda do estoque só de produto COM custo.
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
                COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.custo, 0))), 0) AS profit,
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
        GROUP BY p.id, p.nome, p.imagem_url
        ORDER BY total DESC
        LIMIT 5
    ) p;

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
        'paidOnCancelled', paid_on_cancelled
    );

    RETURN result;
END;
$$;

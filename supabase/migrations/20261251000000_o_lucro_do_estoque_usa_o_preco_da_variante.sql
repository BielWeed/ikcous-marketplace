-- Migration 20261251000000 — lucro bruto do estoque pelo preco efetivo da variante.
-- totalValue soma o MESMO faturamento de totalRevenue, so onde custo IS NOT NULL.
-- totalCost permanece custo * estoque efetivo. Custo zero e conhecido; NULL ausente.
-- inventory.revenueWithoutCost separa a receita excluida do lucro; productsWithoutCost
-- e productsWithCost contam produtos ativos/nao apagados com estoque efetivo > 0.
-- Sao contagens de ESTOQUE, nao productsWithoutCost da raiz (vendas historicas).
-- Preco override zero e valido, NULL herda. Variantes inativas nao entram; sem
-- variantes ativas valem preco/estoque do pai. Nenhum outro calculo ou campo muda.
-- Sem dado, ACL ou assinatura alterados. Aplicar depois da 250, banco antes do front.
-- Rollback manual restaura o corpo da 250 byte a byte. Pre/pos-voos falham fechado.
-- Sem BEGIN/COMMIT: a transacao pertence ao aplicador.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_fn CONSTANT text := 'public.get_admin_analytics_v2(integer)';
  v_oid oid := to_regprocedure('public.get_admin_analytics_v2(integer)');
  v_hash text;
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
        ('public.get_admin_analytics_v2(integer)', '5746d8a1df216ca4a5569901c45a2a07', '060c9ab5b1505dc375b41e4436e9d3a8')
    ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261250000000) nem o desta migration; recusa também redefinição posterior.', r.assinatura, COALESCE(v_hash, 'ausente');
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
  -- As colunas que o corpo vigente ja usa continuam obrigatorias.
  FOR r IN
    SELECT * FROM (VALUES
      ('marketplace_orders', 'id'),
      ('marketplace_orders', 'discount'),
      ('marketplace_order_items', 'order_id'),
      ('marketplace_order_items', 'quantity'),
      ('marketplace_order_items', 'price'),
      ('product_variants', 'price_override')
    ) AS coluna(tabela, nome)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || r.tabela)
                      AND a.attname = r.nome AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a coluna public.%.% do rateio.', r.tabela, r.nome;
    END IF;
  END LOOP;
END $preflight$;

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
        daily_items AS (
            SELECT
                (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                -- Lucro só dos itens com custo conhecido (custo IS NOT NULL; custo 0 é zero medido e conta): sem custo, a venda inteira virava lucro (20261234000000).
                -- O custo de cada item é o do DIA da venda (marketplace_order_item_custo, 20261242000000); venda sem registro usa o custo de hoje do produto.
                COALESCE(SUM(oi.quantity * (oi.price - COALESCE(oic.custo, p.custo) - CASE
                    WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                    ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                        (SELECT SUM(desconto_item.quantity * desconto_item.price)
                           FROM public.marketplace_order_items desconto_item
                          WHERE desconto_item.order_id = o.id), 0))
                END)) FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit,
                COALESCE(SUM(oi.quantity * COALESCE(oic.custo, p.custo, 0)), 0) AS cost_sold
            FROM public.marketplace_order_items oi
            JOIN public.marketplace_orders o ON oi.order_id = o.id
            JOIN public.produtos p ON oi.product_id = p.id
            LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
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
            SUM(oi.quantity * (oi.price - COALESCE(oic.custo, p.custo) - CASE
                    WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                    ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                        (SELECT SUM(desconto_item.quantity * desconto_item.price)
                           FROM public.marketplace_order_items desconto_item
                          WHERE desconto_item.order_id = o.id), 0))
                END)) as total,
            COALESCE(p.imagem_url, '') as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
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

-- Pós-voo: corpo, atributos e ACL; qualquer divergência aborta a transação do aplicador.
DO $posvoo$
DECLARE
  v_fn CONSTANT text := 'public.get_admin_analytics_v2(integer)';
  v_oid oid := to_regprocedure('public.get_admin_analytics_v2(integer)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '060c9ab5b1505dc375b41e4436e9d3a8' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de % tem hash %; esperado 060c9ab5b1505dc375b41e4436e9d3a8.', v_fn, COALESCE(v_hash, 'ausente');
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
END $posvoo$;

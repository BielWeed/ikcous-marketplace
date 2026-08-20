-- O painel de analytics passa a contar só dinheiro reconhecido (achados do
-- painel administrativo, 22/08/2026).
--
-- OS TRÊS DEFEITOS, MEDIDOS NO BANCO REAL
--   1. A receita contava cobrança que nunca foi paga. Todo pedido do
--      checkout nasce status='pending' + payment_status='aguardando' e tem
--      30 minutos para ser pago; a função somava `total` de todo pedido com
--      status NOT IN ('cancelled','returned') SEM olhar payment_status. Em
--      11/08/2026 o cartão "Receita Hoje" teria mostrado R$ 214,40 num dia
--      cuja receita real foi R$ 0,00 (os 6 pedidos expiraram sem pagamento);
--      em 14/08/2026, R$ 137,40 contra R$ 0,00.
--   2. O cartão "Total Concluído" não contava pedido concluído: a tela usa
--      month.count, a contagem de pedidos dos últimos 30 dias não
--      cancelados — inclusive os que nunca saíram de "Novo Pedido". Hoje
--      mostrava 6, enquanto o filtro "Finalizado" da mesma tela devolve 3.
--   3. Dinheiro recebido em pedido cancelado não era contado por nada. Isso
--      acontece por DUAS portas: (a) o cliente paga o PIX depois do prazo, e
--      o pedido fica payment_status='pago_apos_expirar' + status='cancelled';
--      (b) o admin cancela, na ficha do pedido, um pedido que já estava
--      payment_status='pago' — o botão de cancelar aparece para qualquer
--      pedido que não seja 'cancelled' nem 'delivered'
--      (OrderDetail.tsx:159-161), inclusive um já pago, e isso é um clique.
--      Nos dois casos o dinheiro caiu na conta e o pedido está cancelado.
--      Nenhum contador do painel enxergava isso. Hoje há 1 pedido nesse
--      estado (porta 'a'; a porta 'b' não tem ocorrência neste banco hoje).
--
-- A REGRA ÚNICA DE "ISTO É DINHEIRO DE VERDADE"
--   Onde a função já filtrava status NOT IN ('cancelled', 'returned'),
--   passa a exigir também que a cobrança não esteja pendente ou fracassada:
--
--     status NOT IN ('cancelled', 'returned')
--     AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'))
--
--   payment_status IS NULL CONTA, de propósito: NULL ali significa "sem
--   cobrança online" — pedido pago na entrega e pedidos históricos. Ficam
--   de fora 'aguardando', 'recusado', 'expirado' e 'estornado'.
--
--   Aplicada nos NOVE lugares que já usavam o filtro de status: today,
--   yesterday, month, prev_month, total (e portanto avg_ticket),
--   active_customers, as duas CTEs de rev_history (daily_orders e
--   daily_items) e top_prods. NÃO aplicada em today_pending (conta trabalho
--   a fazer, não dinheiro) nem nos agregados de estoque (não olham pedido).
--
-- OS DOIS CAMPOS NOVOS, NO NÍVEL RAIZ DO JSON — CONTRATO COM O FRONT
--   'deliveredTotal': COUNT(*) de status='delivered', desde sempre, sem
--   recorte de data (fecha o defeito 2). Hoje dá 3.
--   'paidOnCancelled': COUNT(*) de payment_status IN ('pago', 'pago_apos_expirar')
--   AND status='cancelled' — cobre as DUAS portas do defeito 3: o PIX pago
--   fora do prazo ('pago_apos_expirar') e o cancelamento manual de um
--   pedido já pago pelo admin ('pago'). Hoje dá 1 (só a primeira porta tem
--   ocorrência neste banco; a ampliação não muda o número).
--   Estes dois nomes são contrato com outra tarefa que já escreve o front
--   que os consome — grafia não muda.
--
-- O QUE NÃO MUDA
--   Assinatura, SECURITY DEFINER, SET search_path, a guarda is_admin() no
--   topo, p_limit_days, e todas as chaves que já existiam no JSON (today,
--   month, executive, revenueHistory, topProducts, inventoryAlerts, growth,
--   inventory, averageTicket) continuam com o mesmo nome e formato — outras
--   telas dependem disso (KpiSummaryCards.tsx, OperationalPerformanceChart.tsx,
--   AdminProductsView.tsx).
--
-- Sem BEGIN/COMMIT, de propósito: com eles o ROLLBACK do script de prova
-- vira no-op e a mudança fica gravada mesmo assim.
-- Prova: node scripts/db-prove-analitico-dinheiro-real.cjs

CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- 1. Today vs Yesterday (Same period)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now())
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO yesterday_revenue, yesterday_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now() - interval '1 day')
    AND created_at < now() - interval '1 day'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'));

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
    AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO prev_month_revenue, prev_month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'));

    month_rev_trend := CASE WHEN prev_month_revenue > 0 THEN ((month_revenue - prev_month_revenue) / prev_month_revenue) * 100 ELSE (CASE WHEN month_revenue > 0 THEN 100 ELSE 0 END) END;
    month_count_trend := CASE WHEN prev_month_count > 0 THEN ((month_count::numeric - prev_month_count::numeric) / prev_month_count::numeric) * 100 ELSE (CASE WHEN month_count > 0 THEN 100 ELSE 0 END) END;

    -- 3. Executive Metrics (All-time total metrics)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_rev, total_ord
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'));

    avg_ticket := CASE WHEN total_ord > 0 THEN total_rev / total_ord ELSE 0 END;

    SELECT COUNT(DISTINCT COALESCE(user_id::text, customer_data->>'email', customer_data->>'whatsapp'))
    INTO active_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'));

    SELECT COUNT(*) INTO active_users_count FROM public.profiles;

    SELECT COUNT(*) INTO low_stock_count
    FROM public.produtos
    WHERE estoque <= COALESCE(estoque_minimo, 5) AND ativo = true AND deleted_at IS NULL;

    -- Compute current total inventory cost and value
    SELECT
        COALESCE(SUM(custo * estoque), 0),
        COALESCE(SUM(preco_venda * estoque), 0)
    INTO inv_cost_total, inv_value_total
    FROM public.produtos
    WHERE deleted_at IS NULL AND ativo = true;

    -- 4. Revenue, Orders, Profit & Cost History (Filtered by p_limit_days for performance)
    -- This scans only within the required range using the created_at index or created_at::date expression index
    SELECT json_agg(h)
    INTO rev_history
    FROM (
        WITH days AS (
            SELECT generate_series(
                (now() - (p_limit_days || ' days')::interval)::date,
                now()::date,
                interval '1 day'
            )::date AS day
        ),
        daily_orders AS (
            SELECT
                (o.created_at AT TIME ZONE 'UTC')::date AS day,
                COALESCE(SUM(o.total), 0) AS revenue,
                COUNT(o.id)::int as orders
            FROM public.marketplace_orders o
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
              AND (o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar'))
            GROUP BY ((o.created_at AT TIME ZONE 'UTC')::date)
        ),
        daily_items AS (
            SELECT
                (o.created_at AT TIME ZONE 'UTC')::date AS day,
                COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.custo, 0))), 0) AS profit,
                COALESCE(SUM(oi.quantity * COALESCE(p.custo, 0)), 0) AS cost_sold
            FROM public.marketplace_order_items oi
            JOIN public.marketplace_orders o ON oi.order_id = o.id
            LEFT JOIN public.produtos p ON oi.product_id = p.id
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
              AND (o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar'))
            GROUP BY ((o.created_at AT TIME ZONE 'UTC')::date)
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
            SUM(oi.quantity * oi.price) as total,
            COALESCE(p.imagem_url, '') as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        AND (o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar'))
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
    WHERE payment_status IN ('pago', 'pago_apos_expirar') AND status = 'cancelled';

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
$function$;

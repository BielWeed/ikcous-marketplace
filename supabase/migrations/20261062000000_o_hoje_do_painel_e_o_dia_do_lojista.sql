-- O "Hoje" do painel passa a ser o dia DO LOJISTA, não o dia UTC.
--
-- O defeito (laudo novos ângulos 01/09, A7): get_admin_analytics_v2 media
-- o Hoje com date_trunc('day', now()) e o gráfico com
-- (created_at AT TIME ZONE 'UTC')::date — o banco roda em TimeZone = UTC
-- (medido). O "Receita Hoje" ia de 21h de ONTEM a 20h59 de hoje no fuso de
-- Brasília: a venda do pico noturno (21h–23h59) entrava no dia errado para
-- quem fecha o caixa à noite, e o gráfico acompanhava o mesmo deslocamento.
-- KPI e gráfico batiam ENTRE SI (os dois em UTC); os dois divergiam do
-- caixa do lojista.
--
-- A cura: as fronteiras do Hoje/Ontem e os baldes do gráfico fixam
-- 'America/Sao_Paulo'. É o fuso da casa (vitrine, comprovante e o dia
-- civil dos testes já vivem nele); a loja multifuso é outro app.
--
-- O QUE NÃO MUDA:
--   * Semântica de "Ontem" do comparativo: continua PERÍODO de mesmo
--     comprimento (meia-noite local de ontem até now() - 24h), só com a
--     fronteira no dia civil certo.
--   * Mês móvel (30/60 dias), executivo all-time, estoque, top produtos:
--     intocados — intervalos instantâneos ou all-time não têm "dia".
--   * Dinheiro reconhecido: os três portões de payment_status, caractere
--     a caractere.
--
-- Forma: CREATE OR REPLACE com assinatura IDÊNTICA (p_limit_days integer
-- DEFAULT 90 → json), corpo = o vivo na 20261021000000 com SEIS trocas de
-- fuso, gerado por script com contagem assertada (não editado à mão).
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op
-- e a mudança fica gravada mesmo assim).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (db-prove-fuso-do-hoje.cjs prova em
-- transação ANTES; estas consultas conferem DEPOIS, contra o banco):
--
--   -- 1. A fronteira do Hoje é a meia-noite de Brasília:
--   SELECT get_admin_analytics_v2(1)->'today'->>'revenue';
--     -> a venda SONDA criada às 00:30 de Brasília de hoje entra;
--        a criada às 22:00 de Brasília de ONTEM não entra (na UTC entram
--        as duas ou as duas não).
--
--   -- 2. O balde do gráfico é o dia civil local:
--   SELECT (elem->>'date') FROM json_array_elements(
--     get_admin_analytics_v2(7)->'revenueHistory') elem
--    ORDER BY 1 DESC LIMIT 1;
--     -> o dia de hoje em America/Sao_Paulo (na UTC, hoje começou 3h antes).
--
--   -- 3. Guarda de admin de pé (segurança):
--   SET ROLE anon;
--   SELECT * FROM get_admin_analytics_v2(1);
--     -> espera EXCEPTION 'Acesso negado...'

-- ─────────────────────────────────────────────────────────────────────────────

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
        COALESCE(SUM(preco_venda * estoque), 0)
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
$function$;

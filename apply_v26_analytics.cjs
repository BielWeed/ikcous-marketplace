const { Client } = require('pg');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const sql = `
BEGIN;

DROP FUNCTION IF EXISTS public.get_admin_analytics_v2();

CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result json;
    today_revenue numeric;
    today_orders int;
    month_revenue numeric;
    month_orders int;
    total_revenue numeric;
    avg_ticket numeric;
    pending_count int;
    low_stock_count int;
    top_products json;
    revenue_history json;
    executive_stats json;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    SELECT COALESCE(SUM(total_amount), 0), COUNT(*) INTO today_revenue, today_orders
    FROM public.marketplace_orders WHERE created_at >= CURRENT_DATE AND status IN ('completed', 'paid', 'delivered');

    SELECT COALESCE(SUM(total_amount), 0), COUNT(*) INTO month_revenue, month_orders
    FROM public.marketplace_orders WHERE created_at >= date_trunc('month', CURRENT_DATE) AND status IN ('completed', 'paid', 'delivered');

    SELECT COALESCE(SUM(total_amount), 0) INTO total_revenue
    FROM public.marketplace_orders WHERE status IN ('completed', 'paid', 'delivered');

    SELECT CASE WHEN COUNT(*) > 0 THEN sum(total_amount) / count(*) ELSE 0 END INTO avg_ticket
    FROM public.marketplace_orders WHERE status IN ('completed', 'paid', 'delivered');

    SELECT COUNT(*) INTO pending_count FROM public.marketplace_orders WHERE status = 'pending';
    
    SELECT COUNT(*) INTO low_stock_count FROM public.produtos WHERE estoque <= 5;

    SELECT json_agg(t) INTO top_products FROM (
        SELECT p.id, p.nome as name, p.image_url as "imageUrl", COUNT(oi.id) as "salesCount", SUM(oi.quantity * oi.price) as "revenue"
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON o.id = oi.order_id
        WHERE o.status IN ('completed', 'paid', 'delivered')
        GROUP BY p.id, p.nome, p.image_url ORDER BY "revenue" DESC LIMIT 5
    ) t;

    SELECT json_agg(t) INTO revenue_history FROM (
        SELECT TO_CHAR(d.date, 'YYYY-MM-DD') as date, COALESCE(SUM(o.total_amount), 0) as amount
        FROM (SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval)::date as date) d
        LEFT JOIN public.marketplace_orders o ON date_trunc('day', o.created_at)::date = d.date AND o.status IN ('completed', 'paid', 'delivered')
        GROUP BY d.date ORDER BY d.date ASC
    ) t;

    SELECT json_build_object('monthlyGrowth', 15.5, 'conversionRate', 3.2, 'activeUsers', (SELECT COUNT(*) FROM public.profiles), 'lifetimeValue', total_revenue) INTO executive_stats;

    result := json_build_object(
        'today', json_build_object('revenue', today_revenue, 'orders', today_orders),
        'month', json_build_object('revenue', month_revenue, 'orders', month_orders),
        'totalRevenue', total_revenue,
        'averageTicket', avg_ticket,
        'pendingOrders', pending_count,
        'inventoryAlerts', low_stock_count,
        'topProducts', COALESCE(top_products, '[]'::json),
        'revenueHistory', COALESCE(revenue_history, '[]'::json),
        'executive', executive_stats
    );
    RETURN result;
END;
$$;
COMMIT;
        `;

        console.log('Applying fixed migration for analytics...');
        await client.query(sql);
        console.log('Migration applied successfully!');

        console.log('Reloading PostgREST schema cache...');
        await client.query("NOTIFY pgrst, 'reload schema'");
        console.log('Cache reloaded successfully!');

    } catch (err) {
        console.error('Erro ao aplicar migração:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applyMigration();

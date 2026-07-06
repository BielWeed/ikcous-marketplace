-- Migration: Reconcile category analytics by including shipping (Frete)
-- Goal: Update get_category_analytics to include a row for Frete and set search_path for safety.

BEGIN;

DROP FUNCTION IF EXISTS public.get_category_analytics(timestamp with time zone, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.get_category_analytics(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(name text, value numeric, orders bigint, avg_ticket numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
 AS $$
BEGIN
    RETURN QUERY
    WITH category_sums AS (
        SELECT 
            COALESCE(p.categoria, 'Geral')::text as name,
            SUM(oi.price * oi.quantity)::numeric as value,
            COUNT(DISTINCT o.id)::bigint as orders,
            CASE 
                WHEN COUNT(DISTINCT o.id) > 0 THEN 
                    ROUND((SUM(oi.price * oi.quantity) / COUNT(DISTINCT o.id))::numeric, 2)
                ELSE 0 
            END as avg_ticket
        FROM public.marketplace_order_items oi
        JOIN public.produtos p ON oi.product_id = p.id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.created_at >= start_date AND o.created_at <= end_date
          AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY COALESCE(p.categoria, 'Geral')
        
        UNION ALL
        
        SELECT 
            'Frete'::text as name,
            SUM(o.shipping)::numeric as value,
            COUNT(DISTINCT o.id)::bigint as orders,
            CASE 
                WHEN COUNT(DISTINCT o.id) > 0 THEN 
                    ROUND((SUM(o.shipping) / COUNT(DISTINCT o.id))::numeric, 2)
                ELSE 0 
            END as avg_ticket
        FROM public.marketplace_orders o
        WHERE o.created_at >= start_date AND o.created_at <= end_date
          AND o.status NOT IN ('cancelled', 'returned')
          AND COALESCE(o.shipping, 0) > 0
    )
    SELECT cs.name, cs.value, cs.orders, cs.avg_ticket
    FROM category_sums cs
    ORDER BY cs.value DESC;
END;
$$;

COMMIT;

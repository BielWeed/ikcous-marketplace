-- Rollback manual de 20261063000000_o_donut_soma_o_dinheiro_do_kpi.sql
--
-- Restaura get_category_analytics com o corpo VIVO antes da onda 4 do
-- laudo 0109 — a cópia literal do bloco da 20261022000000 (a função que
-- trouxe o critério de dinheiro reconhecido ao donut). Para desfazer,
-- rode este arquivo inteiro no SQL Editor do banco afetado.

CREATE OR REPLACE FUNCTION public.get_category_analytics("start_date" timestamp with time zone, "end_date" timestamp with time zone) RETURNS TABLE("name" "text", "value" numeric, "orders" bigint, "avg_ticket" numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- Guarda de autorização: SECURITY DEFINER ignora o RLS das três tabelas
    -- abaixo, então quem autoriza é esta linha.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

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
          -- Linha NOVA desta migration: mesmo critério de dinheiro
          -- reconhecido de get_admin_analytics_v2 (as três portas).
          AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
        GROUP BY COALESCE(p.categoria, 'Geral')

    )
    SELECT cs.name, cs.value, cs.orders, cs.avg_ticket
    FROM category_sums cs
    ORDER BY cs.value DESC;
END;
$$;

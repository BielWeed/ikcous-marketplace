-- ROLLBACK MANUAL de 20261003000000_frete_deixa_de_ser_categoria.sql
--
-- Restaura a definicao anterior VERBATIM (baseline): a linha sintetica
-- 'Frete' volta a entrar na rosca de categorias. Custo declarado: o
-- rotulo volta a mentir que frete e categoria de produto (o defeito do
-- achado 9 retorna). Sem dado envolvido - so o retorno da linha calculada.

CREATE FUNCTION public.get_category_analytics("start_date" timestamp with time zone, "end_date" timestamp with time zone) RETURNS TABLE("name" "text", "value" numeric, "orders" bigint, "avg_ticket" numeric)
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

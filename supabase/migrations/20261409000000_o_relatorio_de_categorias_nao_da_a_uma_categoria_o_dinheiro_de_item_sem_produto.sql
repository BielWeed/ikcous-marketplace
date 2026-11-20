-- Vendas por categoria: o dinheiro do item sem produto não vai para a categoria
-- dos demais itens do pedido. Todos os itens entram no rateio do total já
-- líquido de cupom e com frete; produto encontrado sem categoria segue em Geral.
-- Substitui somente o corpo de leitura da 20261199000000. CREATE OR REPLACE
-- preserva a assinatura, as permissões e o dono; nenhuma linha é escrita.
-- A transação é do aplicador. Para desfazer, use o rollback-manual desta versão.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261409$
DECLARE
    v_corpo_conhecido boolean;
BEGIN
    SELECT COALESCE(md5(replace(p.prosrc, chr(13), '')) IN (e.hash_vigente, e.hash_desta), false)
      INTO v_corpo_conhecido
    FROM (VALUES
        ('public.get_category_analytics(timestamp with time zone,timestamp with time zone)', '9202ebd1aae8cc95e431fd3eb9bc7eb3', 'd7e1e413ac805f598d8657992f43c706')
    ) AS e(assinatura, hash_vigente, hash_desta)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(e.assinatura);

    IF NOT v_corpo_conhecido THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo de get_category_analytics ausente ou diferente das versões esperadas.';
    END IF;
END;
$preflight_20261409$;

CREATE OR REPLACE FUNCTION public.get_category_analytics(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(name text, value numeric, orders bigint, avg_ticket numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
    -- Guarda de autorização: SECURITY DEFINER ignora o RLS das três tabelas
    -- abaixo, então quem autoriza é esta linha.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    RETURN QUERY
    WITH itens AS (
        SELECT
            oi.order_id,
            CASE WHEN p.id IS NULL THEN 'Sem produto vinculado'
                 ELSE COALESCE(p.categoria, 'Geral')
            END::text AS nome_categoria,
            oi.price * oi.quantity AS valor_item
        FROM public.marketplace_order_items oi
        LEFT JOIN public.produtos p ON oi.product_id = p.id
    ),
    fatia AS (
        -- Subtotal da categoria no pedido e subtotal de TODOS os itens do
        -- pedido — a fração entre os dois é a fatia do `total` que cabe à
        -- categoria (o rateio reparte cupom e frete na proporção do que
        -- foi vendido).
        SELECT
            i.order_id,
            i.nome_categoria,
            SUM(i.valor_item) AS subtotal_categoria,
            SUM(SUM(i.valor_item)) OVER (PARTITION BY i.order_id)
                AS subtotal_pedido
        FROM itens i
        GROUP BY i.order_id, i.nome_categoria
    ),
    pedidos AS (
        SELECT o.id, o.total
        FROM public.marketplace_orders o
        WHERE o.created_at >= start_date AND o.created_at <= end_date
          AND o.status NOT IN ('cancelled', 'returned')
          -- Mesmo critério de dinheiro reconhecido de
          -- get_admin_analytics_v2 (as três portas, sem IS NULL —
          -- caractere a caractere com a 20261022).
          AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
    )
    SELECT
        f.nome_categoria,
        SUM(p.total * f.subtotal_categoria
            / NULLIF(f.subtotal_pedido, 0))::numeric AS valor_total,
        COUNT(DISTINCT f.order_id)::bigint AS num_pedidos,
        ROUND(
            SUM(p.total * f.subtotal_categoria
                / NULLIF(f.subtotal_pedido, 0))
            / COUNT(DISTINCT f.order_id),
            2
        ) AS ticket_medio
    FROM fatia f
    JOIN pedidos p ON p.id = f.order_id
    GROUP BY f.nome_categoria
    ORDER BY 2 DESC;
END;
$$;

-- Vendas por categoria: a lista soma exatamente o Faturamento Total, centavo a centavo.
-- Antes, cada categoria saía sem arredondar (R$ 3,3333...) e a tela mostrava R$ 3,33
-- em cada linha; três linhas assim somam R$ 9,99 contra um total de R$ 10,00.
-- Agora o valor de cada categoria sai em centavos pelo MAIOR RESTO: cada uma fica
-- com o piso em centavos e os centavos que faltam para fechar o total (o mesmo
-- total de antes, arredondado ao centavo) vão, um a um, para as categorias com o
-- maior resto. A média por pedido passa a sair do valor já arredondado, para a
-- linha de um pedido só mostrar o mesmo número no valor e na média.
-- Substitui somente o corpo de leitura da 20261409000000 (rateio, filtros de
-- período e de pagamento, categoria "Sem produto vinculado" e as duas guardas de
-- admin ficam iguais). CREATE OR REPLACE preserva a assinatura, as colunas, o
-- SECURITY DEFINER, o search_path, as permissões e o dono; nenhuma linha é escrita.
-- A transação é do aplicador. Para desfazer, use o rollback-manual desta versão.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261620$
DECLARE
    v_corpo_conhecido boolean;
BEGIN
    SELECT COALESCE(md5(replace(p.prosrc, chr(13), '')) IN (e.hash_vigente, e.hash_desta), false)
      INTO v_corpo_conhecido
    FROM (VALUES
        ('public.get_category_analytics(timestamp with time zone,timestamp with time zone)', 'd7e1e413ac805f598d8657992f43c706', 'a332d6b7c4ab58425c60343883d873d6')
    ) AS e(assinatura, hash_vigente, hash_desta)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(e.assinatura);

    IF NOT v_corpo_conhecido THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo de get_category_analytics ausente ou diferente das versões esperadas.';
    END IF;
END;
$preflight_20261620$;

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
    ),
    exato AS (
        -- O valor de cada categoria sem arredondar (a soma das fatias dela).
        -- Pedido de subtotal zero dá fatia NULL: conta no número de pedidos e
        -- não inventa dinheiro.
        SELECT
            f.nome_categoria,
            SUM(p.total * f.subtotal_categoria
                / NULLIF(f.subtotal_pedido, 0)) AS valor_exato,
            COUNT(DISTINCT f.order_id)::bigint AS num_pedidos
        FROM fatia f
        JOIN pedidos p ON p.id = f.order_id
        GROUP BY f.nome_categoria
    ),
    centavos AS (
        -- Maior resto (20261620000000): o piso de cada categoria em centavos,
        -- quantos centavos faltam para fechar o total arredondado e a fila de
        -- quem recebe cada um (maior resto primeiro; empate: maior valor,
        -- depois o nome, para o resultado não mudar entre duas leituras).
        SELECT
            e.nome_categoria,
            e.num_pedidos,
            e.valor_exato,
            FLOOR(e.valor_exato * 100) AS piso,
            ROUND(SUM(e.valor_exato) OVER () * 100)
                - SUM(FLOOR(e.valor_exato * 100)) OVER () AS faltam,
            ROW_NUMBER() OVER (
                ORDER BY e.valor_exato * 100 - FLOOR(e.valor_exato * 100) DESC NULLS LAST,
                         e.valor_exato DESC NULLS LAST,
                         e.nome_categoria
            ) AS fila_do_resto
        FROM exato e
    ),
    rateado AS (
        SELECT
            c.nome_categoria,
            ROUND((c.piso + CASE WHEN c.fila_do_resto <= c.faltam THEN 1 ELSE 0 END) / 100, 2)
                AS valor_total,
            c.num_pedidos
        FROM centavos c
    )
    SELECT
        r.nome_categoria,
        r.valor_total,
        r.num_pedidos,
        ROUND(r.valor_total / r.num_pedidos, 2) AS ticket_medio
    FROM rateado r
    ORDER BY 2 DESC;
END;
$$;

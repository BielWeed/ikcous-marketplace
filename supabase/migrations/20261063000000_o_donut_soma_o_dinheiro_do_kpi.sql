-- O donut de categorias passa a somar O MESMO DINHEIRO do KPI "Volume Total".
--
-- O defeito (laudo novos ângulos 01/09, A6 — o item 76 do diagnóstico
-- interno de 20/08, rebaixado por raro, que deixou de ser raro): o donut
-- (`get_category_analytics`) somava `oi.price * oi.quantity` BRUTO — sem
-- subtrair o desconto do cupom e sem somar o frete — enquanto o KPI soma
-- `orders.total` (LÍQUIDO de cupom, COM frete). Na mesma tela, os dois
-- números se separam todo dia em que a loja usa cupom ou cobra frete, sem
-- nada denunciar. Cupom é recurso central do app: "os números batem?" tem
-- que ter resposta SIM.
--
-- A cura: cada categoria leva a sua FRAÇÃO do total do pedido. A fração é
-- o subtotal da categoria nos itens dividido pelo subtotal de TODOS os
-- itens do pedido — o rateio reparte cupom e frete na mesma proporção do
-- que foi vendido, e a soma das categorias IGUALA a soma dos `total`
-- reconhecidos do período. O donut deixa de ser uma terceira definição de
-- dinheiro e vira o KPI, fatiado por categoria.
--
-- O QUE NÃO MUDA:
--   * Assinatura IDÊNTICA ("start_date" timestamptz, "end_date"
--     timestamptz → TABLE(name text, value numeric, orders bigint,
--     avg_ticket numeric)) — nenhuma sobrecarga silenciosa, forma da
--     irmã 20261003/20261022.
--   * Critério de dinheiro reconhecido: os três portões de payment_status,
--     caractere a caractere (a cura da 20261022 permanece).
--   * status NOT IN ('cancelled', 'returned').
--   * Guarda is_admin() no topo (SECURITY DEFINER ignora RLS; quem
--     autoriza é esta linha).
--   * Pedido cujos itens somam ZERO não é rateado (NULLIF protege a
--     divisão; a categoria dele simplesmente não ganha fatia).
--
-- POR QUE ALIAS NOVOS (valor_total/num_pedidos/ticket_medio): em plpgsql
-- com RETURNS TABLE, `name`, `value`, `orders` e `avg_ticket` são VARIÁVEIS
-- de saída — referenciá-los sem qualificador no corpo vira armadilha de
-- substituição do plpgsql (o corpo antigo escapava qualificando tudo em
-- subquery; aqui os aliases posicionais fazem o mesmo papel).
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op
-- e a mudança fica gravada mesmo assim).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (db-prove-donut-bate-com-kpi.cjs
-- prova em transação ANTES; estas conferem DEPOIS, contra o banco):
--
--   -- 1. A soma do donut É a soma do KPI no mesmo período (hoje pode não
--   --    ser; depois desta migration, é — com catálogo íntegro):
--   WITH cat AS (
--     SELECT SUM(value)::numeric AS total_cat
--     FROM get_category_analytics(NOW() - INTERVAL '90 days', NOW())
--   ), receita AS (
--     SELECT (executive->>'totalRevenue')::numeric AS total_rec
--     FROM get_admin_analytics_v2(90)
--   )
--   SELECT c.total_cat, r.total_rec,
--          c.total_cat = r.total_rec AS bate,
--          c.total_cat <= r.total_rec AS nao_passa
--   FROM cat c, receita r;
--     -> espera bate = true quando todo pedido reconhecido do período tem
--        itens com produto vivo; nao_passa = true SEMPRE. Matiz: pedido
--        com órfão PARCIAL entra reescalado pelas categorias sobreviventes
--        (o total dele não se perde); só o pedido sem NENHUM item com
--        produto vivo sai inteiro e deixa o KPI maior.
--
--   -- 2. A guarda de admin continua de pé (controle de segurança):
--   SET ROLE anon;
--   SELECT * FROM get_category_analytics(NOW(), NOW());
--     -> espera EXCEPTION 'Acesso negado...'

-- ─────────────────────────────────────────────────────────────────────────────

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
    WITH itens AS (
        SELECT
            oi.order_id,
            COALESCE(p.categoria, 'Geral')::text AS nome_categoria,
            oi.price * oi.quantity AS valor_item
        FROM public.marketplace_order_items oi
        JOIN public.produtos p ON oi.product_id = p.id
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

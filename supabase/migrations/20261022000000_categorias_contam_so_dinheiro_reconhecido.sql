-- As contagens por categoria passam a usar o MESMO critério de dinheiro
-- reconhecido que as somas de receita do painel.
--
-- O defeito (laudo "o que falta" 29/08, achado banners 14, degrau 1 —
-- mente em silêncio): a divisão de faturamento por categoria somava TODO
-- pedido não cancelado/devolvido, sem olhar o pagamento. As somas de
-- receita de `get_admin_analytics_v2` somam só dinheiro reconhecido. Hoje
-- os totais coincidem por sorte (sem PIX pendente no banco); no dia em que
-- um PIX ficar sem confirmar, os dois números da mesma tela se separam sem
-- nada denunciar.
--
-- CRITÉRIO DE DINHEIRO RECONHECIDO (observado na função VIVA, 29/08/2026,
-- pg_get_functiondef de get_admin_analytics_v2 — 10 ocorrências):
--   AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
-- As três portas, sem `IS NULL`: o mesmo literal, caractere a caractere.
--
-- COMO (a forma da irmã 20261003000000_frete_deixa_de_ser_categoria.sql):
-- CREATE OR REPLACE com a assinatura IDÊNTICA
-- ("start_date" timestamptz, "end_date" timestamptz → TABLE(name text,
-- value numeric, orders bigint, avg_ticket numeric)) para não criar
-- sobrecarga silenciosa. O corpo é o da 20261003 com UMA linha nova
-- (o AND do pagamento), marcada abaixo.
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op
-- e a mudança fica gravada mesmo assim).
--
-- NÃO aplicar sem prova e sem o Gabriel autorizar NESTA sessão.
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (rodar contra o banco; nao rodada por
-- este agente):
--
--   -- 1. A soma por categoria NUNCA passa o dinheiro reconhecido do mesmo
--   --    período (hoje pode passar; depois da migration, nunca).
--   WITH cat AS (
--     SELECT SUM(value)::numeric AS total_cat
--     FROM get_category_analytics(NOW() - INTERVAL '90 days', NOW())
--   ), receita AS (
--     SELECT (executive->>'totalRevenue')::numeric AS total_rec
--     FROM get_admin_analytics_v2(90)
--   )
--   SELECT c.total_cat, r.total_rec, c.total_cat <= r.total_rec AS ok
--   FROM cat c, receita r;
--     -> espera ok = true (e, com dados vivos, total_cat igual ou menor)
--
--   -- 2. Controle negativo: a função continua retornando as categorias.
--   SELECT count(*) FROM get_category_analytics(NOW() - INTERVAL '90 days', NOW());
--     -> espera > 0 quando houver pedido pago no período
--
--   -- 3. A guarda de admin continua de pé (controle de segurança):
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

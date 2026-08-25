-- "Frete" deixa de fingir ser categoria de produto.
--
-- Achado 9 da auditoria de dashboard (degrau 1; veredicto ABERTO no
-- levantamento de 25/08, autorizado na divisao da mesa 1930): a
-- get_category_analytics fazia UNION ALL de uma linha sintetica 'Frete'
-- com SUM(o.shipping) - e ela entrava na rosca, na legenda e no
-- percentual do bloco "Inteligencia Estrategica" como se fosse
-- categoria. Medido na auditoria: 15,1% da rosca era uma fatia que nao
-- e produto nenhum, sob um bloco cuja ajuda promete "por categoria de
-- produto".
--
-- O frete nao desaparece do conhecimento: o "Volume Total" do topo da
-- tela continua sendo a soma do dinheiro inteiro. O que some e a
-- PRETENSAO de que frete e categoria - se um dia o lojista quiser ver
-- frete como bloco proprio, e outro desenho com rotulo proprio, nao uma
-- linha fantasma na rosca de produtos.
--
-- Definicao VERBATIM da vigente (baseline) MENOS o bloco UNION ALL -
-- remocao conferida por script (bloco unico, zero sobras de 'Frete').
-- Zero casos especiais de 'Frete' no front (grep: nenhum) - conserto
-- RPC-only, nenhuma linha de src/ muda.
--
-- SEM BEGIN/COMMIT. Faixa 20261000* (cacador-b-dorso, _REGRAS.md).
-- NAO aplicar sem prova de ROLLBACK e sem o Gabriel autorizar NESTA sessao.
--
-- FICHA DE VERIFICACAO pos-aplicacao (por consulta, nunca por tela):
--   SELECT count(*) FROM get_category_analytics(...) WHERE name = 'Frete'
--     -> espera 0
--   CONTROLE NEGATIVO (antes de aplicar): a mesma consulta hoje devolve 1
--   E as categorias REAIS mantem exatamente os mesmos values/orders
--   (a remocao nao toca nelas - diff de conjunto so remove a linha Frete).

-- CORRECAO (fila 1935, item 1/2): CREATE OR REPLACE, nunca CREATE cru
-- nem DROP+CREATE - a funcao JA EXISTE no banco (CREATE falharia no
-- apply) e o OR REPLACE preserva os grants de EXECUTE (anon/authenticated)
-- que um DROP+CREATE perderia em silencio.

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
        GROUP BY COALESCE(p.categoria, 'Geral')

    )
    SELECT cs.name, cs.value, cs.orders, cs.avg_ticket
    FROM category_sums cs
    ORDER BY cs.value DESC;
END;
$$;

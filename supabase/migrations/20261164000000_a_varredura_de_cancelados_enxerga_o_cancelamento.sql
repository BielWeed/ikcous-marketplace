-- ============================================================================
-- Migration 20261164000000 — a varredura de cancelados enxerga o cancelamento
-- (frente pedidos-4, tarefa useOrders-cancelados-janela-e-colunas; achado
-- central de useOrders-1417, aberto desde a rodada b8800f8)
-- ============================================================================
--
-- O DEFEITO QUE ESTA MIGRATION FECHA: a varredura do painel de cancelados —
-- fetchPedidosCancelados, em src/hooks/useOrders.ts — chama
-- get_admin_orders_paged com p_status='cancelled' e p_page_size 200 e
-- recebe, para CADA pedido, o jsonb_agg de itens (com subconsulta de produto
-- para imagem) e o endereço. O painel de cancelados NÃO lê nada disso: os
-- dois baldes derivados ("Produtos que ainda não voltaram", "Estorno devido")
-- e o dropdown AlertasCancelados usam só id, customer_name, total, canal,
-- status, payment_status, cancelled_after_shipping e returned_to_seller_at
-- (medido nos consumos da lista: AdminOrdersView.tsx:454-459 e
-- AlertasCancelados.tsx). E não há janela nenhuma: a varredura pagina até
-- MAX_PAGES para cobrir TODO cancelado da história da loja, a cada gatilho.
--
-- POR QUE UMA RPC NOVA, E NÃO PARÂMETRO NA EXISTENTE: a primeira tentativa
-- desta tarefa (WIP de 17/09) recortou a janela por p_start_date — e
-- get_admin_orders_paged só filtra por o.created_at (20261163000000:183 e
-- :297). A revisão reprovou com BLOQUEIA: pedido criado há 100 dias e
-- cancelado ONTEM sumiria da lista, e a lista de cancelados é uma lista de
-- PENDÊNCIAS (mercadoria a devolver, estorno devido) — a idade que importa é
-- a do CANCELAMENTO, não a da criação. Ensinar a data de cancelamento à RPC
-- velha mudaria sua assinatura pela terceira vez e arriscaria os N
-- consumidores da lista principal; a varredura de cancelados tem consumo e
-- contrato próprios, então ganha função irmã. get_admin_orders_paged NÃO é
-- tocada por esta migration.
--
-- A DATA DO CANCELAMENTO: não existe coluna; nasce em
-- marketplace_order_history (linha com new_status = 'cancelled',
-- baseline:3924). A RPC toma a ÚLTIMA delas (MAX(created_at) — reaberto e
-- cancelado de novo vale a última) por JOIN LATERAL, servido pelo índice
-- idx_marketplace_order_history_order_id (baseline:4773). Para pedido
-- legado, cancelado antes de o histórico existir, o fallback é o updated_at
-- da própria ordem (COALESCE(h.cancelado_em, o.updated_at)): o updated_at
-- do cancelado que ninguém mais tocou É o instante do cancelamento, e um
-- fallback imperfeito nunca apaga pendência — só a joga para um limite
-- errado de janela, nunca para fora da lista sem janela (p_dias NULL).
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. Cria public.get_admin_orders_cancelados_recentes(
--      p_dias integer DEFAULT 90, p_page integer DEFAULT 0,
--      p_page_size integer DEFAULT 200) RETURNS jsonb.
--      p_dias NULL desliga a janela (varredura completa — é o que o front
--      usa no "buscar também os antigos" do dropdown de alertas).
--      Retorno: {'data' => [linhas enxutas], 'total_count' => inteiro,
--      'fora_da_janela' => inteiro}. total_count conta DENTRO da janela
--      (é o total que o laço de paginação do front persegue);
--      fora_da_janela conta os cancelados com cancelamento anterior à
--      janela — é o número que impede o recorte de mentir: sem ele, um
--      estorno pendente de 6 meses atrás sumiria em silêncio. Com
--      p_dias NULL, fora_da_janela vale 0 por construção (COUNT FILTER com
--      p_dias IS NOT NULL), porque "ficou fora" não existe sem janela.
--   2. A PROJEÇÃO É ENXUTA DE PROPÓSITO: jsonb_build_object com as 23
--      colunas que o mapper (mapOrderFromDB, src/lib/mappers.ts:197-288) e
--      o painel leem — NENHUMA subconsulta de itens, NENHUM JOIN de
--      user_addresses. O endereço que o painel mostra vem do snapshot
--      gravado no customer_data, que o mapper já prefere (laudo 02/09,
--      achado 4) — a linha enxuta não perde informação de tela.
--   3. ORDENAÇÃO: cancelado_em DESC, created_at DESC — o cancelamento mais
--      recente primeiro, que é a ordem de atenção do painel; a data de
--      criação desempata cancelamentos do mesmo instante (o caso comum da
--      varredura de um cancelamento em lote).
--   4. CRACHÁ: SECURITY DEFINER com search_path = 'public', 'extensions' (o
--      mesmo da get_admin_orders_paged) e o gate `IF NOT public.is_admin()`
--      como primeira instrução do corpo — sem ele, o EXECUTE de
--      authenticated (passo 5) seria porta aberta para qualquer usuário
--      logado ler a lista inteira de cancelados.
--   5. REVOKE ALL ... FROM PUBLIC, anon e GRANT EXECUTE para authenticated
--      e service_role. Não é zelo: função nova nasce com EXECUTE para
--      PUBLIC (default do Postgres) e anon não tem por que executar RPC de
--      painel. authenticated com EXECUTE é OBRIGATÓRIO: o job "Código ×
--      banco" do CI (scripts/db-check-objetos-do-codigo.mjs) extrai o nome
--      da chamada de src/hooks/useOrders.ts e reprova o PR se a RPC ficar
--      AUSENTE ou INALCANÇÁVEL.
--
-- DADOS EXISTENTES: nenhuma linha é lida fora do SELECT de serviço, nenhuma
-- é escrita. Só o catálogo de funções muda.
--
-- IDEMPOTÊNCIA: CREATE OR REPLACE FUNCTION + REVOKE/GRANT declarativos —
-- reaplicar o arquivo deixa o mesmo estado.
--
-- FORA DO ESCOPO: aplicar no banco (node scripts/db-apply.cjs, só o dono,
-- com `BEGIN; ... ROLLBACK;` de prova antes, como manda o CONTRIBUTING.md);
-- o front (src/hooks/useOrders.ts troca a chamada, AdminOrdersView.tsx e
-- AlertasCancelados.tsx mostram o fora_da_janela); a entrada em VERIFICACOES
-- do db-apply.cjs (entra no mesmo PR, arquivo de script); a
-- get_admin_orders_paged, que NÃO é editada.
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- `node scripts/db-apply.cjs supabase/migrations/20261164000000_a_varredura_de_cancelados_enxerga_o_cancelamento.sql`
-- ou `psql -1`. Sem `BEGIN`/`COMMIT` de nível superior neste arquivo (regra
-- da casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar contra o banco, como admin):
--
--   1. SELECT get_admin_orders_cancelados_recentes(NULL, 0, 10) -> 'total_count';
--      -- esperado: o total de cancelados da loja, igual a
--      --   SELECT count(*) FROM marketplace_orders WHERE status='cancelled';
--
--   2. SELECT get_admin_orders_cancelados_recentes(90, 0, 200) -> 'total_count';
--      -- esperado: só os cancelados nos últimos 90 dias, contando pela
--      -- data do cancelamento (última linha 'cancelled' no histórico).
--
--   3. SELECT get_admin_orders_cancelados_recentes(90, 0, 200) -> 'fora_da_janela';
--      -- esperado: os cancelados há mais de 90 dias; (2) + (3) = (1).
--
--   4. SELECT get_admin_orders_cancelados_recentes(90, 0, 200)
--        -> 'data' -> 0;
--      -- esperado: objeto com as 23 chaves da projeção e SEM as chaves
--      -- 'items' e 'address'.
--
--   5. SELECT has_function_privilege('anon',
--        'public.get_admin_orders_cancelados_recentes(integer, integer, integer)',
--        'EXECUTE');
--      -- esperado: false. Com 'authenticated' e 'service_role': true.
--
--   6. Como NÃO-admin autenticado:
--      SELECT get_admin_orders_cancelados_recentes(90, 0, 200);
--      -- esperado: EXCEPTION 'Acesso negado: privilégios de administrador
--      -- necessários.'
--
-- ROLLBACK: rollback-manual-20261164000000_a_varredura_de_cancelados_enxerga_o_cancelamento.sql
-- — derruba a função pela assinatura completa. Não há definição a
-- restaurar: a função não existia antes. O front volta na mesma reverteda
-- do commit (a chamada antiga à get_admin_orders_paged continua viva no
-- banco, intocada por esta migration).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_orders_cancelados_recentes(p_dias integer DEFAULT 90::integer, p_page integer DEFAULT 0::integer, p_page_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_total_count BIGINT;
    v_fora_da_janela BIGINT;
    v_data JSONB;
    v_offset INTEGER;
BEGIN
    -- Authorization check (mesmo gate da get_admin_orders_paged).
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;

    -- Contagem, numa passada só: dentro da janela (é o total que o laço do
    -- front persegue) e fora dela (o número que impede o recorte de
    -- mentir). p_dias NULL = sem janela: dentro = todos, fora = 0.
    SELECT
        COUNT(*) FILTER (
          WHERE p_dias IS NULL
             OR cancelado_em >= now() - make_interval(days => p_dias)
        ),
        COUNT(*) FILTER (
          WHERE p_dias IS NOT NULL
            AND cancelado_em < now() - make_interval(days => p_dias)
        )
      INTO v_total_count, v_fora_da_janela
      FROM (
        SELECT o.id,
               COALESCE(h.cancelado_em, o.updated_at) AS cancelado_em
          FROM public.marketplace_orders o
          LEFT JOIN LATERAL (
            SELECT MAX(hi.created_at) AS cancelado_em
              FROM public.marketplace_order_history hi
             WHERE hi.order_id = o.id
               AND hi.new_status = 'cancelled'
          ) h ON TRUE
         WHERE o.status = 'cancelled'
      ) c;

    -- Linhas enxutas: as 23 colunas que o mapper e o painel leem, na ordem
    -- de atenção do cancelamento (mais recente primeiro). Nenhum item,
    -- nenhum endereço: é o arrasto que esta tarefa corta (ver cabeçalho, item 2).
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT jsonb_build_object(
            'id', c.id,
            'user_id', c.user_id,
            'customer_name', c.customer_name,
            'customer_data', c.customer_data,
            'total', c.total,
            'subtotal', c.subtotal,
            'shipping', c.shipping,
            'discount', c.discount,
            'payment_method', c.payment_method,
            'payment_status', c.payment_status,
            'status', c.status,
            'notes', c.notes,
            'coupon_code', c.coupon_code,
            'tracking_code', c.tracking_code,
            'cancelled_after_shipping', c.cancelled_after_shipping,
            'returned_to_seller_at', c.returned_to_seller_at,
            'pagamento_recebido_em', c.pagamento_recebido_em,
            'pagamento_recebido_por', c.pagamento_recebido_por,
            'canal', c.canal,
            'vendedor_id', c.vendedor_id,
            'created_at', c.created_at,
            'updated_at', c.updated_at,
            'cancelado_em', c.cancelado_em
        ) AS t
        FROM (
            SELECT o.id,
                   o.user_id,
                   o.customer_name,
                   o.customer_data,
                   o.total,
                   o.subtotal,
                   o.shipping,
                   o.discount,
                   o.payment_method,
                   o.payment_status,
                   o.status,
                   o.notes,
                   o.coupon_code,
                   o.tracking_code,
                   o.cancelled_after_shipping,
                   o.returned_to_seller_at,
                   o.pagamento_recebido_em,
                   o.pagamento_recebido_por,
                   o.canal,
                   o.vendedor_id,
                   o.created_at,
                   o.updated_at,
                   COALESCE(h.cancelado_em, o.updated_at) AS cancelado_em
              FROM public.marketplace_orders o
              LEFT JOIN LATERAL (
                SELECT MAX(hi.created_at) AS cancelado_em
                  FROM public.marketplace_order_history hi
                 WHERE hi.order_id = o.id
                   AND hi.new_status = 'cancelled'
              ) h ON TRUE
             WHERE o.status = 'cancelled'
               AND (p_dias IS NULL OR COALESCE(h.cancelado_em, o.updated_at) >= now() - make_interval(days => p_dias))
             ORDER BY COALESCE(h.cancelado_em, o.updated_at) DESC, o.created_at DESC
             LIMIT p_page_size
            OFFSET v_offset
        ) c
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'fora_da_janela', v_fora_da_janela
    );
END;
$function$;

-- Função nova nasce com EXECUTE para PUBLIC (default do Postgres). Aperto
-- deliberado do molde 20261163000000: anon perde um EXECUTE que nunca
-- passaria do gate; authenticated NÃO pode perder o dele — o job "Código ×
-- banco" do CI reprova o PR se a RPC que o painel passa a chamar ficar
-- inalcançável.
REVOKE ALL ON FUNCTION public.get_admin_orders_cancelados_recentes(integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_orders_cancelados_recentes(integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_orders_cancelados_recentes(integer, integer, integer) TO service_role;

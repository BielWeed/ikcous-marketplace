-- ============================================================================
-- Rollback manual — a devolução nasce no pedido (20261175000000)
-- ============================================================================
-- Reverter PRIMEIRO o front (botão "Solicitar devolução" do pedido, tela
-- admin-devolucoes, card no pedido do painel, seção de política nos Ajustes)
-- e a ação `gerar_devolucao_reversa` da edge melhor-envio-etiqueta; só depois
-- executar este arquivo. Executar sob transação externa (psql -1 -f) — nunca
-- pelo db-apply (registraria o rollback no ledger de migrations).
--
-- Remove, na ordem inversa, só o que a migration criou: o gatilho de aviso, as
-- RPCs, os ajudantes internos, as policies do bucket e as quatro tabelas.
-- `IF EXISTS` em tudo: repetir este rollback não dá erro.
--
-- DADOS: APAGA as devoluções registradas, os itens, a trilha e a política
-- configurada pelo lojista. As linhas de estorno que uma devolução concluída
-- abriu em `order_refunds` FICAM (são dinheiro — o ledger não se apaga). O
-- bucket `devolucoes` e os arquivos dele FICAM (apagar foto de cliente é
-- decisão do dono, fora de rollback de schema).
--
-- GUARDA DE ORDEM (achado R): reverta 78 -> 77 -> 76 antes desta (75). O
-- Financeiro (fin__movimentos/fin_dre) e o CRM/Início (crm_visao,
-- painel_inicio) leem a tabela `devolucoes` direto — revertendo esta
-- migration primeiro, as duas quebram com 42P01 (relation does not exist).
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.painel_inicio()') IS NOT NULL
     OR to_regprocedure('public.crm_visao(date, date)') IS NOT NULL THEN
    RAISE EXCEPTION 'reverta 78 (o_crm_e_o_inicio_leem_a_loja) antes de reverter esta migration (75).';
  END IF;
  IF to_regprocedure('public.fin_dre(date, date)') IS NOT NULL THEN
    RAISE EXCEPTION 'reverta 77 (o_financeiro_da_loja_nasce) antes de reverter esta migration (75).';
  END IF;
  IF to_regclass('public.config_pagamento_cartao') IS NOT NULL THEN
    RAISE EXCEPTION 'reverta 76 (o_cartao_online_nasce) antes de reverter esta migration (75).';
  END IF;
END
$$;

-- devolver_estoque: corpo ORIGINAL de 20261060000000, VERBATIM — 75
-- redefiniu a função (achado C) para descontar o que devolucao_itens já
-- reestocou; restaurado ANTES de apagar as tabelas de devolução, para a
-- função nunca ficar, nem por um instante, apontando para uma tabela que
-- este mesmo arquivo vai derrubar.
CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver$
DECLARE
    v_item     RECORD;
    v_unidades integer := 0;
    v_ganhou   boolean;
BEGIN
    -- Reclama o carimbo ANTES de creditar. Quem perder a corrida (ou quem
    -- chegar de novo — a oscilação de status, o reenvio do webhook, o duplo
    -- clique do lojista) recebe 0 sem tocar na prateleira. Dentro da mesma
    -- transação do chamador: se o chamador abortar depois, o carimbo volta
    -- junto (ROLLBACK), e a próxima tentativa honesta ainda credita.
    UPDATE public.marketplace_orders
       SET stock_returned_at = now()
     WHERE id = p_order_id
       AND stock_returned_at IS NULL
    RETURNING true INTO v_ganhou;

    IF v_ganhou IS NOT TRUE THEN
        RETURN 0;
    END IF;

    FOR v_item IN
        SELECT product_id, variant_id, quantity
        FROM public.marketplace_order_items
        WHERE order_id = p_order_id
    LOOP
        -- IF/ELSE, não dois IF: a v23 debita XOR (variante OU produto, nunca os
        -- dois), e o front manda product_id preenchido junto com variant_id. Com
        -- dois IF, todo pedido de variante que expirasse creditaria o produto pai
        -- também, inflando o catalogo para sempre. Mesma forma do restore que ja
        -- existe em update_order_status_atomic.
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
               SET stock_increment = stock_increment + v_item.quantity
             WHERE id = v_item.variant_id;
        ELSE
            UPDATE public.produtos
               SET estoque = estoque + v_item.quantity
             WHERE id = v_item.product_id;
        END IF;

        v_unidades := v_unidades + v_item.quantity;
    END LOOP;

    RETURN v_unidades;
END;
$devolver$;

COMMENT ON FUNCTION public.devolver_estoque(uuid) IS
  'Idempotente desde 20261060000000 (laudo 0109, A8): credita o estoque do '
  'pedido NO MAXIMO uma vez na vida dele, guardado pela coluna-fato '
  'stock_returned_at (o estoque foi debitado uma vez so, na criacao — '
  'segundo credito e peça fantasma). Devolve 0 sem tocar na prateleira '
  'quando o carimbo ja existe. Antes desta migration o contrato era "nao e '
  'idempotente, o chamador garante chamada unica" (20260807000000) — a '
  'unica porta que nao garantia era a oscilacao cancelled -> processing -> '
  'cancelled, alcancavel inclusive por PostgREST direto de admin '
  '(baseline:5585). REVOKE de EXECUTE mantido (sao os donos das RPCs quem '
  'chamam).';

-- get_admin_orders_cancelados_recentes: corpo ORIGINAL de 20261164000000,
-- VERBATIM — 75 redefiniu a função (achado 1, rodada 2) para expor
-- valor_devolvido_por_devolucao; restaurado antes de apagar public.devolucoes,
-- mesmo cuidado do devolver_estoque acima.
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

-- solicitar_estorno: corpo ORIGINAL de 2026110000000, VERBATIM — 75
-- redefiniu a função (achado 3, rodada 2) para descontar reembolso manual de
-- devolução já concluída; restaurado antes de apagar public.devolucoes.
CREATE OR REPLACE FUNCTION public.solicitar_estorno(
    p_order_id uuid,
    p_amount numeric,
    p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_payment_status TEXT;
    v_paid_at TIMESTAMPTZ;
    v_total NUMERIC;
    v_cancelled_after_shipping BOOLEAN;
    v_returned_at TIMESTAMPTZ;
    v_valor_estornado NUMERIC;
    v_em_curso NUMERIC;
    v_saldo NUMERIC;
    v_refund_id UUID;
BEGIN
    -- So' a loja pede devolucao pelo painel. ERRCODE 42501 para o front
    -- distinguir "nao e' a loja" de qualquer outro erro.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Somente a loja pede a devolução pelo painel.'
            USING ERRCODE = '42501';
    END IF;

    SELECT status, payment_status, paid_at, total,
           cancelled_after_shipping, returned_to_seller_at, valor_estornado
      INTO v_status, v_payment_status, v_paid_at, v_total,
           v_cancelled_after_shipping, v_returned_at, v_valor_estornado
      FROM public.marketplace_orders
     WHERE id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Dinheiro que nao entrou nao se devolve. IS NULL explicito porque
    -- `NULL NOT IN (...)` avaliaria para NULL e o IF nao dispararia.
    IF v_payment_status IS NULL
       OR v_payment_status NOT IN ('pago', 'pago_apos_expirar') THEN
        RAISE EXCEPTION 'Este pedido não está pago: não há dinheiro do Mercado Pago para devolver.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Regra 24/08: o estorno manual so' existe para pedido CANCELADO. Pedir
    -- devolucao de pedido vivo e' trocar o dinheiro sem desfazer a venda.
    IF v_status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Cancele o pedido antes de devolver o dinheiro.';
    END IF;

    -- Regra 24/08, lado do enviado: produto que SAIU so' gera devolucao
    -- depois de VOLTAR a mao do lojista. O FATO vem de returned_to_seller_at
    -- (gravado por confirmar_retorno_do_produto), nunca deduzido de status.
    IF v_cancelled_after_shipping AND v_returned_at IS NULL THEN
        RAISE EXCEPTION 'A devolução espera o produto: ele ainda não voltou para a loja.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Saldo disponivel = total pago - ja confirmado (valor_estornado) -
    -- pendencias em andamento (solicitado/em_processamento). Linhas falhou/
    -- recusado NAO reservam saldo: sao pedidos mortos.
    SELECT COALESCE(SUM(amount), 0) INTO v_em_curso
      FROM public.order_refunds
     WHERE order_id = p_order_id
       AND status IN ('solicitado', 'em_processamento');

    v_saldo := v_total - v_valor_estornado - v_em_curso;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor a devolver tem de ser maior que zero.';
    END IF;

    IF p_amount > v_saldo THEN
        RAISE EXCEPTION 'O valor pedido (R$ %) é maior que o valor disponível para devolver (R$ %).',
            to_char(p_amount, 'FM999G999D00'), to_char(v_saldo, 'FM999G999D00')
            USING ERRCODE = 'P0001';
    END IF;

    -- A linha nasce AQUI, pedida pela loja. status default 'solicitado':
    -- quem executa e' a edge do clique (Task 3) ou o cron (Task 4).
    INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
    VALUES (p_order_id, p_amount, NULLIF(trim(COALESCE(p_motivo, '')), ''), 'lojista')
    RETURNING id INTO v_refund_id;

    RETURN jsonb_build_object('refund_id', v_refund_id, 'amount', p_amount);
END;
$$;

-- update_order_status_atomic: corpo ORIGINAL de 2026110000000 (a última
-- migration que o definia antes desta), VERBATIM — 75 redefiniu a função
-- (achado A2, rodada 3) para descontar reembolso manual de devolução já
-- concluída do valor do estorno automático de cancelamento; restaurado
-- antes de apagar public.devolucoes (embora este corpo original não a
-- referencie — mesma disciplina das restaurações acima).
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(
    p_order_id uuid,
    p_new_status text,
    p_notes text DEFAULT NULL,
    p_silent boolean DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_is_admin BOOLEAN := public.is_admin();
    v_cancelled_after_shipping BOOLEAN;
    v_payment_status TEXT;
    v_paid_at TIMESTAMPTZ;
    v_total NUMERIC;
    v_item RECORD;
    v_result jsonb;
BEGIN
    -- Antes de qualquer leitura: sem sessão, nem existência de pedido se revela.
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado: é preciso estar autenticado para alterar um pedido.';
    END IF;

    -- Get current status and lock row
    SELECT status, user_id, cancelled_after_shipping, payment_status, paid_at, total
      INTO v_old_status, v_user_id, v_cancelled_after_shipping, v_payment_status, v_paid_at, v_total
    FROM public.marketplace_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_old_status IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Security checks
    -- IS DISTINCT FROM, não `!=`: pedido de convidado tem user_id NULL, e
    -- `NULL != <uuid>` avalia para NULL — o IF não dispararia.
    IF v_user_id IS DISTINCT FROM v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Não autorizado: Você não tem permissão para alterar este pedido.';
    END IF;

    IF NOT v_is_admin THEN
        IF p_new_status IS DISTINCT FROM 'cancelled' THEN
            RAISE EXCEPTION 'Operação não permitida: Usuários só podem cancelar seus próprios pedidos.';
        END IF;
        -- Regra do Gabriel (24/08/2026): o divisor e' se o produto SAIU, nao
        -- foi pago. Nao enviado e enviado podem ser cancelados; entregue nao —
        -- produto entregue e' devolucao, que e' outro assunto e outra decisao.
        IF v_old_status NOT IN ('pending', 'processing', 'shipping') THEN
            RAISE EXCEPTION 'Este pedido não pode mais ser cancelado por você.';
        END IF;
    END IF;

    -- Grava o que o app hoje ESQUECE ao cancelar: se o produto ja tinha saido.
    -- Sem isto, depois do cancelamento nao ha como saber se o estorno espera a
    -- mercadoria voltar. Nao existe tabela de historico de status neste banco.
    -- (v_old_status = 'shipping' e p_new_status = 'cancelled' ja garantem que
    -- os dois sao distintos -- sem clausula extra sobre isso.)
    IF p_new_status = 'cancelled'
       AND v_old_status = 'shipping' THEN
        UPDATE public.marketplace_orders
           SET cancelled_after_shipping = true
         WHERE id = p_order_id;
    END IF;

    -- LEDGER DO ESTORNO (2026110000000, regra do Gabriel 24/08/2026):
    -- pedido PAGO cancelado SEM ter saido -> o pedido de devolucao NASCE
    -- AQUI, na MESMA transacao do cancelamento. E' isto que torna impossivel
    -- "cancelou e ninguem pediu o dinheiro de volta": ou as duas coisas
    -- acontecem juntas, ou nenhuma (ROLLBACK).
    --   v_old_status IN ('pending','processing'): pedido que NAO saiu.
    --     Shipping fica FORA — estorno manual do lojista, depois do retorno
    --     (solicitar_estorno e' a porta; a regra de 24/08 do lado do enviado).
    --   NOT v_cancelled_after_shipping (laudo C2 do PR #436): "nao enviado"
    --     NAO e' so' o status antigo. Pedido enviado, cancelado e REATIVADO
    --     pela loja para processing tem v_old_status='processing' com o
    --     produto NA MAO DO CLIENTE — a coluna nunca volta a false. E' a
    --     MESMA guarda que o bloco de estoque la' embaixo ja' usa; sem ela,
    --     este ciclo nasceria linha automatica com returned_to_seller_at
    --     NULL (estorno com o produto fora da loja — exatamente o que
    --     solicitar_estorno recusa no lado manual da regra).
    --   payment_status IN ('pago','pago_apos_expirar') AND paid_at IS NOT
    --     NULL: as DUAS condicoes (o plano exigiu as duas — dado legado pode
    --     ter payment_status='pago' sem paid_at, e esse nao gera linha).
    --   NOT EXISTS (... solicitado/em_processamento/concluido): o pedido
    --     pago-sem-envio ganha UMA linha de cancelamento na vida — cobre o
    --     ciclo reativar->cancelar de novo. Linhas falhou/recusado NAO
    --     bloqueiam: sao pedidos mortos, o retry e' legitimo.
    --   amount = v_total: o cancelamento devolve TUDO que foi pago (coluna
    --     total — o valor pelo qual o pedido fechou).
    --   solicitado_por: quem cancelou — lojista pelo painel, cliente no app.
    IF p_new_status = 'cancelled'
       AND v_old_status IN ('pending', 'processing')
       AND v_payment_status IN ('pago', 'pago_apos_expirar')
       AND v_paid_at IS NOT NULL
       AND NOT v_cancelled_after_shipping
       AND NOT EXISTS (
            SELECT 1 FROM public.order_refunds
             WHERE order_id = p_order_id
               AND status IN ('solicitado', 'em_processamento', 'concluido'))
    THEN
        INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
        VALUES (p_order_id, v_total, 'cancelamento antes do envio',
                CASE WHEN v_is_admin THEN 'lojista' ELSE 'cliente' END);
    END IF;

    -- STOCK RESTORATION LOGIC
    -- `v_old_status <> 'shipping'`: produto que ja saiu esta FISICAMENTE com o
    -- cliente. Devolver a prateleira aqui faria a loja vender uma peca que nao
    -- tem. O estoque desse caso volta em confirmar_retorno_do_produto.
    --
    -- `NOT v_cancelled_after_shipping` (laudo 0109, A8): pedido cancelado
    -- apos o envio que a loja REATIVA e re-cancela a partir de 'processing'
    -- e' o mesmo envio — a peca continua com o cliente, e creditar aqui era
    -- phantom. O credito desse pedido so existe em
    -- confirmar_retorno_do_produto (que agora carimba stock_returned_at, e
    -- por isso tambem so acontece uma vez).
    -- If transitioning to 'cancelled' from a non-cancelled status
    IF p_new_status = 'cancelled'
       AND v_old_status IS DISTINCT FROM 'cancelled'
       AND v_old_status IS DISTINCT FROM 'shipping'
       AND NOT v_cancelled_after_shipping THEN
        -- Mesmo laco de public.devolver_estoque(uuid) — reusa a funcao em vez
        -- de manter uma terceira copia do mesmo invariante (IF/ELSE variante
        -- XOR produto). Desde 20261060000000 a funcao e idempotente pelo fato
        -- (stock_returned_at): a oscilacao cancelled -> processing ->
        -- cancelled credita UMA vez, na primeira.
        PERFORM public.devolver_estoque(p_order_id);

        -- A vaga do cupom NAO volta aqui (Rodada 4): ela so' volta na
        -- varredura devolver_cupons_de_pedidos_mortos(), depois que o PIX
        -- ja nao pode mais ser pago (expires_at + 24h). Devolver no momento
        -- do cancelamento e' exatamente o que abriu a janela das Rodadas 2 e
        -- 3 -- ver o cabecalho da migration 20260901000000.
    END IF;

    -- Update status
    UPDATE public.marketplace_orders
    SET status = p_new_status, updated_at = NOW()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.marketplace_orders.*) INTO v_result;

    -- Log history
    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, v_old_status, p_new_status, p_notes, v_caller_id);

    RETURN v_result;
END;
$$;

DROP TRIGGER IF EXISTS tr_devolucao_avisa_o_cliente ON public.devolucoes;
DROP FUNCTION IF EXISTS public.devolucao_avisa_o_cliente();

DROP FUNCTION IF EXISTS public.salvar_politica_de_devolucao(jsonb);
DROP FUNCTION IF EXISTS public.admin_devolucao_reprovar(uuid, text);
DROP FUNCTION IF EXISTS public.admin_devolucao_reemitir_reembolso(uuid, boolean);
DROP FUNCTION IF EXISTS public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text);
DROP FUNCTION IF EXISTS public.admin_devolucao_registrar(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.admin_devolucao_decidir(uuid, boolean, text, timestamptz);
DROP FUNCTION IF EXISTS public.admin_devolucoes_listar(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.devolucao_detalhe(uuid);
DROP FUNCTION IF EXISTS public.devolucoes_do_pedido(uuid);
DROP FUNCTION IF EXISTS public.informar_envio_devolucao(uuid, text);
DROP FUNCTION IF EXISTS public.cancelar_devolucao(uuid);
DROP FUNCTION IF EXISTS public.solicitar_devolucao(uuid, jsonb, text, text, text, text, text[]);
DROP FUNCTION IF EXISTS public.devolucao_elegibilidade(uuid);

DROP FUNCTION IF EXISTS public.devolucao__registrar_evento(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.devolucao__metodos(text, text, boolean, text[], text[]);
DROP FUNCTION IF EXISTS public.devolucao__modalidade(text, text);
DROP FUNCTION IF EXISTS public.devolucao__entregue_em(uuid);
DROP FUNCTION IF EXISTS public.devolucao__hoje();

DROP POLICY IF EXISTS devolucoes_cliente_insert_policy ON storage.objects;
DROP POLICY IF EXISTS devolucoes_dono_ou_admin_select_policy ON storage.objects;

DROP TABLE IF EXISTS public.devolucao_eventos;
DROP TABLE IF EXISTS public.devolucao_itens;
DROP TABLE IF EXISTS public.devolucoes;
DROP TABLE IF EXISTS public.politica_devolucao;

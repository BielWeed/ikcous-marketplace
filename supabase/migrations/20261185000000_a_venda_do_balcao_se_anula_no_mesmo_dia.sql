-- ============================================================================
-- Migration 20261185000000 — a venda do balcão se anula no mesmo dia
-- (frente A de docs/superpowers/plans/2026-09-28-sessoes-paralelas.md; plano
-- docs/superpowers/plans/2026-09-28-balcao-pix-no-balcao.md, fase 5;
-- investigação docs/superpowers/specs/2026-09-28-balcao-pix-investigacao.md,
-- defeito D2)
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION FECHA
--
-- A venda do balcão nasce 'delivered' + 'recebido_na_entrega'
-- (20261162000000:386) e a ficha do pedido não oferece Cancelar para
-- entregue. Um engano no caixa (forma errada, item a mais, cliente desistiu na
-- hora) não tinha correção: o estoque ficava baixado, o Financeiro contava a
-- entrada e o caixa esperava um dinheiro que voltou para a mão do cliente.
-- Resposta do dono (28/09/2026): "anular venda do balcão: sim, só no mesmo
-- dia e com motivo obrigatório".
--
-- 2. O QUE ESTA MIGRATION FAZ
--
-- Cria `public.anular_venda_presencial(uuid, text) RETURNS jsonb`, SECURITY
-- DEFINER, `search_path = pg_catalog, pg_temp`. Na ordem:
--   (1) só admin (42501), com sessão;
--   (2) motivo obrigatório (22023);
--   (3) trava a linha do pedido (FOR UPDATE);
--   (4) já anulada (presencial + cancelled + estornado) → devolve a MESMA
--       resposta com ja_anulada=true (duplo toque não devolve estoque duas
--       vezes — e `devolver_estoque` já é idempotente pelo carimbo);
--   (5) só venda do BALCÃO recebida na hora: canal='presencial',
--       status='delivered', payment_status='recebido_na_entrega',
--       payment_method em cash/pix/card. PIX com QR pago ('online') é
--       dinheiro no Mercado Pago: volta pelo estorno do app (ficha do
--       pedido), nunca por aqui;
--   (6) só no MESMO DIA da loja (fuso America/Sao_Paulo, a mesma régua de
--       `fin__dia`/`fin__hoje` — escrita por extenso para não depender da
--       migration do Financeiro);
--   (7) sem devolução aberta ou concluída no pedido (quem cuida do dinheiro
--       dela é a devolução);
--   (8) devolve o estoque (`devolver_estoque`, idempotente), marca
--       status='cancelled' + payment_status='estornado' e grava os DOIS
--       históricos (pedido e pagamento), com o motivo.
--
-- 3. POR QUE 'estornado' (e o que isso faz no Financeiro e no caixa)
--
-- 'estornado' é o valor que já quer dizer "o dinheiro recebido voltou para o
-- cliente fora do gateway" (`registrar_estorno_manual`, 20261176000000). O
-- Financeiro, SEM mudança nenhuma, já trata a venda assim: a entrada do dia
-- continua (o dinheiro entrou) e nasce a saída 'estorno_externo' do mesmo
-- valor, datada do estorno (`fin__movimentos`, 20261177000000:357-376) — saldo
-- zero. O caixa da loja idem: `fin__caixa_calculo` soma a venda em dinheiro
-- recebida na sessão e desconta o estorno em dinheiro da sessão
-- (20261177000000:469-515). O CRM ignora pedido cancelado. O gatilho
-- `tr_marca_estorno_direto_do_pedido` (20261176000000) carimba
-- `estorno_manual_registrado_em` nesta MESMA transição.
--
-- 4. DADOS EXISTENTES: nenhum. Só cria uma função.
--
-- 5. DEPENDÊNCIAS: `devolver_estoque` na forma de 20261175000000 (lê
-- `devolucao_itens`) e a tabela `devolucoes` — aplicar DEPOIS das 75–78.
--
-- 6. COMO APLICAR, VERIFICAR E DESFAZER
--
-- Pelo `aplicar-migrations.yml`, só pelo dono, depois da 20261184000000. Sem
-- BEGIN/COMMIT neste arquivo.
-- FICHA: SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'anular_venda_presencial';
--   -- esperado: true, {"search_path=pg_catalog, pg_temp"}
-- SELECT has_function_privilege('anon', 'public.anular_venda_presencial(uuid, text)', 'EXECUTE'),
--        has_function_privilege('authenticated', 'public.anular_venda_presencial(uuid, text)', 'EXECUTE');
--   -- esperado: false, true
-- Prova de comportamento: tests/banco/pix-do-balcao-viva.cjs, prova (h).
-- ROLLBACK MANUAL: rollback-manual-20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.anular_venda_presencial(p_order_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
    v_usuario uuid;
    v_motivo text;
    v_pedido record;
BEGIN
    -- (1) GATE antes de qualquer leitura.
    IF public.is_admin() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja anula venda do balcão.';
    END IF;
    v_usuario := auth.uid();
    IF v_usuario IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Não autorizado: é preciso estar autenticado para anular a venda.';
    END IF;

    -- (2) Sem motivo escrito, dinheiro que volta some sem rastro.
    v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
    IF v_motivo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Informe o motivo para anular a venda.';
    END IF;
    IF char_length(v_motivo) > 500 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Motivo longo demais (até 500 caracteres).';
    END IF;

    -- (3) Trava a linha: duas anulações ao mesmo tempo esperam uma pela outra.
    SELECT o.id, o.canal, o.status, o.payment_status, o.payment_method,
           o.pagamento_recebido_em, o.total
      INTO v_pedido
      FROM public.marketplace_orders o
     WHERE o.id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Venda não encontrada.';
    END IF;

    IF v_pedido.canal IS DISTINCT FROM 'presencial' THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Só venda do balcão se anula aqui.';
    END IF;

    -- (4) Duplo toque: a mesma resposta, nada de novo.
    IF v_pedido.status = 'cancelled' AND v_pedido.payment_status = 'estornado' THEN
        RETURN jsonb_build_object('order_id', v_pedido.id, 'ja_anulada', true,
                                  'status', v_pedido.status, 'payment_status', v_pedido.payment_status);
    END IF;

    -- (5) Só venda recebida NA HORA, no balcão.
    IF v_pedido.payment_method = 'online' THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Venda paga pelo PIX com QR: devolva pelo estorno do Mercado Pago, na ficha do pedido.';
    END IF;
    IF v_pedido.status IS DISTINCT FROM 'delivered'
       OR v_pedido.payment_status IS DISTINCT FROM 'recebido_na_entrega'
       OR v_pedido.payment_method NOT IN ('cash', 'pix', 'card')
       OR v_pedido.pagamento_recebido_em IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Esta venda não pode ser anulada aqui.';
    END IF;

    -- (6) Mesmo dia da loja.
    IF (v_pedido.pagamento_recebido_em AT TIME ZONE 'America/Sao_Paulo')::date
       IS DISTINCT FROM (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Só dá para anular no mesmo dia da venda. Para outro dia, registre uma devolução.';
    END IF;

    -- (7) Devolução no pedido: o dinheiro dela é da devolução.
    IF EXISTS (
        SELECT 1 FROM public.devolucoes d
         WHERE d.order_id = p_order_id
           AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')
    ) THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Esta venda tem devolução registrada; resolva pela devolução.';
    END IF;

    -- (8) Estoque de volta (idempotente pelo carimbo stock_returned_at),
    -- status e dinheiro, e os dois históricos.
    PERFORM public.devolver_estoque(p_order_id);

    UPDATE public.marketplace_orders
       SET status = 'cancelled',
           payment_status = 'estornado',
           updated_at = now()
     WHERE id = p_order_id;

    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, 'delivered', 'cancelled', 'Venda do balcão anulada: ' || v_motivo, v_usuario);

    INSERT INTO public.marketplace_order_payment_history (order_id, acao, payment_status_antes, payment_status_depois, created_by)
    VALUES (p_order_id, 'desfeito', 'recebido_na_entrega', 'estornado', v_usuario);

    RETURN jsonb_build_object('order_id', p_order_id, 'ja_anulada', false,
                              'status', 'cancelled', 'payment_status', 'estornado');
END;
$function$;

REVOKE ALL ON FUNCTION public.anular_venda_presencial(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anular_venda_presencial(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.anular_venda_presencial(uuid, text) IS 'PDV/balcão: anula NO MESMO DIA (fuso da loja) uma venda do balcão recebida na hora (dinheiro, PIX na chave, maquininha), com motivo obrigatório. Só admin. Devolve o estoque (devolver_estoque, idempotente), vira cancelled + estornado (o Financeiro e o caixa já descontam como estorno registrado fora do app) e grava os dois históricos. Duplo toque devolve ja_anulada=true. PIX com QR pago volta pelo estorno do Mercado Pago, nunca por aqui.';

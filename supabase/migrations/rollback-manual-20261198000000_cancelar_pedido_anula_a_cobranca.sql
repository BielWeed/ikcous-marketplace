-- ============================================================================
-- Rollback manual — cancelar pedido anula a cobrança primeiro (20261198000000)
-- ============================================================================
-- Restaura, BYTE A BYTE, o `public.update_order_status_atomic` que a
-- 20261180000000 deixou (o texto abaixo é o daquele arquivo, sem mudança —
-- tests/migration_cancelar_pedido_anula_a_cobranca_test.ts prova a igualdade)
-- e apaga as três funções que a 20261198000000 criou:
-- `cancelar_pedido_com_cobranca`, `pedido__mudar_status` e
-- `pedido__saldo_a_estornar`. ACL de update_order_status_atomic intocada
-- (CREATE OR REPLACE preserva; a migration também não a tocou).
--
-- O QUE VOLTA A VALER: o cancelamento direto pelo front de pedido com
-- cobrança aberta (o defeito S1), o estorno do cancelamento sem o saldo
-- remanescente (R11) e o 'delivered' -> 'cancelled' devolvendo estoque.
--
-- ANTES DE RODAR: a edge `criar-pagamento` publicada com a ação `cancelar`
-- chama `cancelar_pedido_com_cobranca`. Sem a função, essa ação responde
-- "tente de novo" (nenhum efeito no banco nem no MP além do cancelamento da
-- order que ela já tiver feito) — reverta a edge e o front primeiro, ou
-- aceite que o botão Cancelar de pedido online fique recusando até lá.
--
-- GUARDA DE ORDEM (obrigação deixada pela 20261180000000 para quem a
-- redefinisse): só restaura se o corpo vivo de update_order_status_atomic for
-- o desta migration (e2a821a1fb498740bc4356e3f22bf022) ou já o da 80
-- (ed2f7fd3e0177c027720049b2fe55d3b — rollback repetido, idempotente).
-- Qualquer outro corpo é de uma migration POSTERIOR: restaurar a 80 por baixo
-- dela apagaria a guarda dela em silêncio.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa.
-- ============================================================================

DO $guarda_rollback_20261198$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.update_order_status_atomic(uuid,text,text,boolean)');
  IF v_hash IS NULL OR v_hash NOT IN (
    'e2a821a1fb498740bc4356e3f22bf022', -- corpo que a 20261198000000 deixa
    'ed2f7fd3e0177c027720049b2fe55d3b'  -- já é o da 20261180000000 (rollback repetido)
  ) THEN
    RAISE EXCEPTION 'corpo vivo de update_order_status_atomic (hash %) não é o da 20261198000000 nem o da 20261180000000 — uma migration posterior o redefiniu; reverta-a antes.', COALESCE(v_hash, 'ausente');
  END IF;
END $guarda_rollback_20261198$;

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
    v_metodo_online TEXT;
    v_gateway_payment_id TEXT;
    v_total NUMERIC;
    v_ja_manual NUMERIC;
    v_item RECORD;
    v_result jsonb;
BEGIN
    -- Antes de qualquer leitura: sem sessão, nem existência de pedido se revela.
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado: é preciso estar autenticado para alterar um pedido.';
    END IF;

    -- Get current status and lock row
    SELECT status, user_id, cancelled_after_shipping, payment_status, paid_at, total,
           metodo_online, gateway_payment_id
      INTO v_old_status, v_user_id, v_cancelled_after_shipping, v_payment_status, v_paid_at, v_total,
           v_metodo_online, v_gateway_payment_id
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

        -- NOVO (achado independente de risco, dinheiro, 26/09/2026):
        -- cobrança de CARTÃO ainda pode virar aprovada no banco. Ver o
        -- cabeçalho desta migration (20261180000000) para o cenário e a
        -- prova de que PIX continua cancelável. `v_payment_status =
        -- 'aguardando'` isola o caso: pedido já pago segue o ramo do ledger
        -- do estorno logo abaixo, sem mudança. Dentro de 'aguardando', a
        -- vaga (`gateway_payment_id`) tem uma cobrança de cartão em jogo
        -- quando:
        --   (a) `v_metodo_online IN ('credito','debito')` — a cobrança foi
        --       gravada de verdade na MESMA transação que ocupou a vaga
        --       (criar-pagamento/index.ts, "Fase 3.5") e pode ser aprovada
        --       pelo desafio 3DS ou pela análise antifraude a qualquer
        --       momento; ou
        --   (b) a vaga guarda o SENTINELA `verificando:` (prefixo
        --       PREFIXO_VAGA_EM_VERIFICACAO, supabase/functions/_shared/
        --       mercadopago.ts) — um 409 idempotency_key_already_used cuja
        --       cobrança da tentativa anterior PODE estar aprovada por
        --       baixo; só o webhook resolve a ambiguidade (adoção, em
        --       webhook-mercadopago.ts). O sentinela nunca grava
        --       `metodo_online` (só a adoção grava — achado S3 da
        --       20261176000000), por isso entra como condição própria, não
        --       coberta pelo IN acima.
        -- Um cartão RECUSADO não cai aqui: `liberar_cobranca_do_pedido`
        -- (20261176000000) já limpou os dois campos para NULL antes de
        -- soltar a vaga para a próxima tentativa. Sem `USING ERRCODE`: ver
        -- o cabeçalho desta migration — o padrão do plpgsql (P0001) é o
        -- único código que `mensagemAmigavelErroAtualizacaoStatus`
        -- repassa ao cliente tal como veio do banco.
        IF v_payment_status = 'aguardando'
           AND (
                v_metodo_online IN ('credito', 'debito')
                OR v_gateway_payment_id LIKE 'verificando:%'
           )
        THEN
            RAISE EXCEPTION 'Este pedido tem uma cobrança no cartão em confirmação com o banco. Aguarde a confirmação ou fale com a loja antes de cancelar.';
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
    --     total — o valor pelo qual o pedido fechou), MENOS o que uma
    --     devolução deste pedido já devolveu manualmente (achado A2, rodada
    --     3) — sem isto, o pedido reativado e cancelado de novo devolvia o
    --     total CHEIO por cima do que a devolução já tinha pago por fora.
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
        SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
          FROM public.devolucoes d
         WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;

        IF v_total - v_ja_manual > 0 THEN
            INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
            VALUES (p_order_id, v_total - v_ja_manual, 'cancelamento antes do envio',
                    CASE WHEN v_is_admin THEN 'lojista' ELSE 'cliente' END);
        END IF;
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

DROP FUNCTION IF EXISTS public.cancelar_pedido_com_cobranca(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.pedido__mudar_status(uuid, text, text, uuid, boolean, boolean);
DROP FUNCTION IF EXISTS public.pedido__saldo_a_estornar(uuid);

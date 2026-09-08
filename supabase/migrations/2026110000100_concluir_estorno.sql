-- CONCLUIR_ESTORNO — Task 3 da frente "estorno de dinheiro pelo app"
-- (plano 20260907). Nasce em migration PROPIA (nao na 2026110000000) porque
-- quem a chama sao TRES caminhos: a edge estornar-pagamento (o clique do
-- lojista), o cron reconciliar-pagamentos (Task 4) e o webhook do Mercado
-- Pago (Task 5) — a soma e' a MESMA para os tres, então mora num lugar so'.
--
-- O QUE ESTA RPC FAZ (e o que ela NAO faz):
--   Conclui a linha de order_refunds E soma marketplace_orders.valor_estornado
--   NUMA transacao so' (atômico), virando payment_status='estornado' APENAS
--   quando o acumulado alcanca o total do pedido (parcial mantem 'pago').
--   NAO fala com o Mercado Pago e NAO decide NADA sozinha: quem chama so'
--   chama depois de o MP dizer approved/refunded/partially_refunded na
--   resposta ou na consulta (o executor da Task 2 e' quem traduz).
--
-- IDEMPOTENCIA (prova P13): o UPDATE so' pega a linha com
--   (status <> 'concluido' OR concluido_em IS NULL).
--   * A primeira clausula fecha o "concluido duas vezes": webhook, cron e
--     edge podem completar o MESMO estorno, e a soma acontece UMA vez.
--   * A segunda clausula abre a porta do webhook da Task 5 (estorno feito
--     FORA do app): a linha e' inserida ja' 'concluido' com concluido_em
--     NULL e a RPC e' chamada na sequencia — sem a clausula, essa linha
--     NUNCA somaria e o banco divergiria do MP (o oposto do objetivo).
--     Apos a primeira conclusao, concluido_em fica preenchido para sempre
--     e nenhuma chamada soma de novo.
--
-- GRANTS: NENHUM para authenticated/anon/PUBLIC (laudo C1 do PR #439). A
-- regua da casa para RPC que SO' o servidor chama e' confirmar_pagamento
-- (20260810000000: REVOKE e nenhum GRANT depois). Quem chama aqui e' so' a
-- service role (edge estornar-pagamento, cron da Task 4, webhook da Task 5);
-- a autorizacao do CLIQUE do lojista ja' aconteceu na edge (JWT + papel).
-- Dar EXECUTE a authenticated abriria a porta medida no laudo: o cliente le
-- o id da propria linha pela RLS e conclui a devolucao SEM dinheiro sair do
-- MP — e nem is_admin() por dentro fecha isso (o lojista tambem nao carimba
-- devolucao que o MP nao confirmou).
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK do script de prova
-- vira no-op e a mudanca fica gravada).
--
-- PROVA (transacao com ROLLBACK, vermelho primeiro):
--   node scripts/db-prove-estorno-ledger.cjs   (P12-P14: soma, idempotencia,
--   grants de servidor e a recusa do acima do total)
-- ROLLBACK MANUAL: rollback-manual-2026110000100_concluir_estorno.sql
--
-- NAO APLICADA NO BANCO VIVO: aplicacao e' pendencia do dono, com este SQL
-- mostrado inteiro no PR. NUNCA supabase db push.

-- Padrao da casa (M3 do laudo do PR #436): DROP IF EXISTS antes do CREATE —
-- re-aplicar TROCA a funcao em vez de criar sobrecarga; os grants sao
-- recasados explicitos logo abaixo. O DROP da assinatura curta (uuid) e'
-- cinto e suspensao: esta funcao nunca existiu com ela, mas o DROP com
-- assinatura errada num futuro re-apply deixaria fantasma.
DROP FUNCTION IF EXISTS public.concluir_estorno(uuid);
DROP FUNCTION IF EXISTS public.concluir_estorno(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.concluir_estorno(
    p_refund_id uuid,
    p_mp_refund_id text DEFAULT NULL,
    p_mp_status text DEFAULT NULL,
    p_mp_status_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_amount numeric(12,2);
    v_order_id uuid;
    v_valor_estornado numeric(12,2);
    v_payment_status text;
BEGIN
    -- Linha que nao existe e' erro de PROGRAMACAO (quem chama carregou a
    -- linha antes): falha alto, nao devolve "ja concluida" disfarcada.
    IF NOT EXISTS (SELECT 1 FROM public.order_refunds WHERE id = p_refund_id) THEN
        RAISE EXCEPTION 'Linha de devolução não encontrada: %.', p_refund_id;
    END IF;

    -- A conclusao da linha + o carimbo, SO' na primeira passagem (P13).
    -- COALESCE nos campos do MP: quem ja' gravou diagnostico melhor (a
    -- consulta do cron) nao e' sobrescrito por quem chegou depois.
    UPDATE public.order_refunds
       SET status = 'concluido',
           mp_refund_id = COALESCE(p_mp_refund_id, mp_refund_id),
           mp_status = COALESCE(p_mp_status, mp_status),
           mp_status_detail = COALESCE(p_mp_status_detail, mp_status_detail),
           concluido_em = now(),
           updated_at = now()
     WHERE id = p_refund_id
       AND (status <> 'concluido' OR concluido_em IS NULL)
    RETURNING amount, order_id INTO v_amount, v_order_id;

    IF v_order_id IS NULL THEN
        -- Ja' concluida antes (P13a): devolve o estado SEM somar de novo.
        -- E' o contrato que faz webhook/cron/edge poderem completar o mesmo
        -- estorno sem cuidado de coordenacao entre eles.
        SELECT o.valor_estornado, o.payment_status
          INTO v_valor_estornado, v_payment_status
          FROM public.marketplace_orders o
          JOIN public.order_refunds r ON r.order_id = o.id
         WHERE r.id = p_refund_id;
        RETURN jsonb_build_object(
            'concluido', true,
            'ja_concluida', true,
            'valor_estornado', v_valor_estornado,
            'payment_status', v_payment_status
        );
    END IF;

    -- A soma e' AQUI e so' aqui: valor_estornado so' anda com confirmacao
    -- do Mercado Pago (o chamador atestou). payment_status vira 'estornado'
    -- apenas quando o acumulado alcanca o total — parcial mantem o que era
    -- (o CASE le o valor ANTIGO da linha, regra do UPDATE do Postgres).
    -- A condicao valor_estornado + v_amount <= total e' a M3 do laudo do
    -- PR #439: a RPC e' o UNICO ponto por onde a soma passa (a Task 5 vai
    -- inserir linhas 'sistema' de estorno feito FORA do app) — o acumulado
    -- NUNCA passa do total do pedido.
    UPDATE public.marketplace_orders
       SET valor_estornado = valor_estornado + v_amount,
           payment_status = CASE
               WHEN valor_estornado + v_amount >= total THEN 'estornado'
               ELSE payment_status
           END,
           updated_at = now()
     WHERE id = v_order_id
       AND valor_estornado + v_amount <= total
    RETURNING valor_estornado, payment_status INTO v_valor_estornado, v_payment_status;

    IF v_valor_estornado IS NULL THEN
        -- Soma que passaria do total: RECUSA com erro nomeado (a Task 5
        -- decide o que fazer com estorno externo maior que o pago). A
        -- excecao desfaz tambem a conclusao da linha acima — mesma
        -- transacao, nada fica meio-concluido. Prova: P14b.
        RAISE EXCEPTION 'estorno_acima_do_total: a linha % somaria % e o acumulado passaria do total do pedido %.',
            p_refund_id, v_amount, v_order_id;
    END IF;

    RETURN jsonb_build_object(
        'concluido', true,
        'ja_concluida', false,
        'valor_estornado', v_valor_estornado,
        'payment_status', v_payment_status
    );
END;
$$;

COMMENT ON FUNCTION public.concluir_estorno(uuid, text, text, text) IS
  'Fecha a devolucao CONFIRMADA pelo Mercado Pago (edge estornar-pagamento, cron reconciliar-pagamentos e webhook-mercadopago chamam, todos com service role — SEM grant a authenticated, regua confirmar_pagamento): conclui a linha de order_refunds e soma valor_estornado no pedido NUMA transacao so'', virando payment_status=''estornado'' so'' quando o acumulado alcanca o total. Recusa com erro nomeado estorno_acima_do_total soma que passaria do total. Idempotente: o UPDATE exige (status <> ''concluido'' OR concluido_em IS NULL) — chamada repetida nao soma duas vezes (prova P13), e linha nascida concluida pelo webhook (estorno fora do app) soma uma unica vez.';

-- Padrao da casa para RPC de SERVIDOR (regua: confirmar_pagamento,
-- 20260810000000:236 — REVOKE e NENHUM GRANT depois). O REVOKE nomeia
-- anon/authenticated porque o REVOKE FROM PUBLIC nao alcanc,a os default
-- privileges do Supabase; a service role executa pelos default privileges
-- do schema. Prova: P12c/P14 do db-prove-estorno-ledger.cjs.
REVOKE ALL ON FUNCTION public.concluir_estorno(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

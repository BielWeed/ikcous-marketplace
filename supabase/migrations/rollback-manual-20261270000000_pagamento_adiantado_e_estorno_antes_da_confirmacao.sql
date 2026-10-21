-- Rollback manual da 20261270000000: restaura os dois corpos anteriores byte a byte.
-- Aplicar SOMENTE pelo aplicar-migrations.yml (o envelope abre a transacao e retira
-- a versao do ledger). Sem transacao propria, sem mudar dados, assinaturas ou ACL.
-- Reverter primeiro as edges desta frente: a guarda do webhook exige o fechamento
-- atomico da reserva nunca paga. Depois deste rollback o defeito antigo volta.
-- Recusa corpo ausente, ja desfeito ou alterado por migration posterior, como a 20261190.

DO $preflight_rollback_20261270$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.concluir_estorno(uuid,text,text,text)');
  IF v_hash IS DISTINCT FROM '1738457c2b95c5c3709beed42e656394' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: concluir_estorno (hash %) nao e o da 20261270000000; revise antes de reverter.', COALESCE(v_hash, 'ausente');
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.pagamentos_a_reconciliar()');
  IF v_hash IS DISTINCT FROM 'aed09ec910825168a3217b2e308824c5' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: pagamentos_a_reconciliar (hash %) nao e o da 20261270000000; revise antes de reverter.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_rollback_20261270$;

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

CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT o.id, o.gateway_payment_id
      FROM public.marketplace_orders o
      LEFT JOIN public.reconciliacao_visitas v ON v.order_id = o.id
     WHERE o.gateway_payment_id IS NOT NULL
       AND o.paid_at IS NULL
       -- 24 h para todo mundo (passado isso o PIX não é mais pagável); 14
       -- dias para o cartão possivelmente vivo — análise manual do MP pode
       -- aprovar dias depois (D2, revisor financeiro: N = 14).
       AND (
             o.expires_at > now() - interval '24 hours'
          OR (
               o.expires_at > now() - interval '14 days'
               AND COALESCE(
                     o.gateway_payment_id LIKE 'verificando:%'
                     OR o.metodo_online IN ('credito', 'debito'),
                     false
                   )
             )
       )
       -- Cobrança que o MP já deu como terminal sai da fila; cobrança NOVA na
       -- vaga (outro id) volta na hora.
       AND (v.cobranca_terminal IS NULL OR v.cobranca_terminal <> o.gateway_payment_id)
       AND (
             -- morto por expiracao (20260808000100)
             o.payment_status = 'expirado'
             -- morto por cancelamento com a cobranca viva (20260812000000)
          OR (o.payment_status = 'aguardando' AND o.status = 'cancelled')
             -- VIVO, e ainda da' para salvar (20261010000000)
          OR (o.payment_status = 'aguardando' AND o.status = 'pending')
       )
     -- Vivo primeiro; depois rodízio (nunca visitado / visitado há mais
     -- tempo); por fim o mais novo (D3: o LIMIT não monopoliza mais a fila).
     ORDER BY (o.status = 'pending') DESC, v.visitado_em ASC NULLS FIRST, o.expires_at DESC
     LIMIT 100;
$candidatos$;

COMMENT ON FUNCTION public.concluir_estorno(uuid, text, text, text) IS
  'Fecha a devolucao CONFIRMADA pelo Mercado Pago (edge estornar-pagamento, cron reconciliar-pagamentos e webhook-mercadopago chamam, todos com service role — SEM grant a authenticated, regua confirmar_pagamento): conclui a linha de order_refunds e soma valor_estornado no pedido NUMA transacao so'', virando payment_status=''estornado'' so'' quando o acumulado alcanca o total. Recusa com erro nomeado estorno_acima_do_total soma que passaria do total. Idempotente: o UPDATE exige (status <> ''concluido'' OR concluido_em IS NULL) — chamada repetida nao soma duas vezes (prova P13), e linha nascida concluida pelo webhook (estorno fora do app) soma uma unica vez.';

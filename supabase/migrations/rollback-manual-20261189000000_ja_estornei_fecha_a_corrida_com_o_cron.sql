-- ============================================================================
-- Rollback manual — "Já estornei" fecha a corrida com o cron (20261189000000)
-- ============================================================================
-- Restaura, byte a byte, o corpo de `public.registrar_estorno_manual` que a
-- 20261176000000 deixou: o registro manual volta a NÃO olhar o ledger
-- `order_refunds` (sem trava, sem levar a linha `solicitado` a `recusado`,
-- sem recusar com linha `em_processamento`). Nada mais muda: mesma
-- assinatura, mesmo SECURITY DEFINER, mesmo search_path, mesma ACL — este
-- arquivo não toca ACL pelo mesmo motivo da migration (CREATE OR REPLACE
-- preserva a ACL vigente).
--
-- Depois do rollback a corrida volta a existir: "Já estornei" entre a leitura
-- do pedido pelo cron e a marca da linha deixa o cron POSTAR o estorno com a
-- leitura velha, e o cliente pode receber duas vezes. Reverter só faz sentido
-- se a regra nova estiver causando um problema pior.
--
-- DADOS: as linhas que a regra nova já levou a `recusado` (com
-- ultimo_erro 'A loja registrou a devolução feita fora do app') FICAM como
-- estão — o pedido delas já está `estornado`, e devolver a linha a
-- `solicitado` faria o executor recusá-la de novo (guarda "não está pago")
-- na melhor hipótese, ou reabriria a corrida na pior. Nada é apagado.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261189$` recusa com
-- `B1_BASELINE_DIVERGENT` se o corpo VIVO não for o que a 20261189000000
-- deixou (`3632b8b804ecf913bd849879212ff1ba`, md5 de `replace(prosrc, E'\r', '')`):
-- desfazer por cima de uma redefinição POSTERIOR apagaria a dela em silêncio,
-- e desfazer duas vezes não tem o que desfazer. Mesma transação do restante:
-- recusa = nada gravado.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger de migrations como se fosse uma migration nova). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261189$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.registrar_estorno_manual(uuid)');

  IF v_hash IS DISTINCT FROM '3632b8b804ecf913bd849879212ff1ba' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de registrar_estorno_manual (hash %) não é o que a 20261189000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_rollback_20261189$;

CREATE OR REPLACE FUNCTION public.registrar_estorno_manual(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existe boolean;
    v_ja_estornado boolean;
    v_total numeric;
    v_valor_estornado numeric;
    v_ja_manual numeric;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'somente a loja registra o estorno'
            USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.marketplace_orders WHERE id = p_order_id
    ),
    EXISTS (
        SELECT 1 FROM public.marketplace_orders
         WHERE id = p_order_id AND payment_status = 'estornado'
    )
    INTO v_existe, v_ja_estornado;

    IF NOT v_existe THEN
        RAISE EXCEPTION 'pedido nao encontrado' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_ja_estornado THEN
        SELECT total, COALESCE(valor_estornado, 0) INTO v_total, v_valor_estornado
          FROM public.marketplace_orders WHERE id = p_order_id;
        SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
          FROM public.devolucoes d
         WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;

        IF v_total - v_valor_estornado - v_ja_manual <= 0 THEN
            RAISE EXCEPTION 'Este pedido não tem mais nada a devolver: o valor já saiu por outro caminho (devolução ou estorno).'
                USING ERRCODE = '22023';
        END IF;

        UPDATE public.marketplace_orders
           SET payment_status = 'estornado',
               estorno_manual_registrado_em = COALESCE(estorno_manual_registrado_em, now())
         WHERE id = p_order_id;
    END IF;

    RETURN json_build_object('ok'::text, true, 'payment_status'::text, 'estornado');
END;
$$;

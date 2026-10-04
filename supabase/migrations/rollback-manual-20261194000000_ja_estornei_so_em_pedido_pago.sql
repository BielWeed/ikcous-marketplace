-- ============================================================================
-- Rollback manual — "Já estornei" só em pedido pago (20261194000000)
-- ============================================================================
-- Restaura, byte a byte, o corpo de `public.registrar_estorno_manual` que a
-- 20261189000000 deixou: o registro manual volta a NÃO conferir o pagamento
-- (sai a recusa 22023 'Este pedido não tem pagamento confirmado ...'). Nada
-- mais muda: as travas e recusas da 20261189 ficam, mesma assinatura, mesmo
-- SECURITY DEFINER, mesmo search_path, mesma ACL — este arquivo não toca ACL
-- pelo mesmo motivo da migration (CREATE OR REPLACE preserva a ACL vigente).
--
-- Depois do rollback o defeito volta: um admin pode marcar `estornado` um
-- pedido `aguardando` com PIX aberto, e o pagamento que chega depois cai em
-- 'ignorado' no confirmar_pagamento e some sem alerta. Reverter só faz
-- sentido se a guarda estiver recusando um caso legítimo.
--
-- DADOS: a migration não gravou nada em linha nenhuma (só recusou cliques),
-- então não há dado a desfazer. Nada é apagado.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261194$` recusa com
-- `B1_BASELINE_DIVERGENT` se o corpo VIVO não for o que a 20261194000000
-- deixou (`18ea2e76d075634b57189592fb91ac0d`, md5 de `replace(prosrc, E'\r', '')`):
-- desfazer por cima de uma redefinição POSTERIOR apagaria a dela em silêncio,
-- e desfazer duas vezes não tem o que desfazer. Mesma transação do restante:
-- recusa = nada gravado.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger de migrations como se fosse uma migration nova). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261194$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.registrar_estorno_manual(uuid)');

  IF v_hash IS DISTINCT FROM '18ea2e76d075634b57189592fb91ac0d' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de registrar_estorno_manual (hash %) não é o que a 20261194000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_rollback_20261194$;

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
    v_em_processamento boolean;
    v_disputa_em_curso boolean;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'somente a loja registra o estorno'
            USING ERRCODE = '42501';
    END IF;

    -- 1. Trava as linhas VIVAS do ledger antes do pedido: a mesma ordem
    --    (linha -> pedido) de concluir_estorno, para as duas nunca se
    --    esperarem em cruz.
    PERFORM 1
       FROM public.order_refunds viva
      WHERE viva.order_id = p_order_id
        AND viva.status IN ('solicitado', 'em_processamento')
      ORDER BY viva.id
        FOR UPDATE OF viva;

    -- 2. Trava o pedido; o estado lido aqui já é o da linha travada.
    SELECT COALESCE(o.payment_status = 'estornado', false),
           o.total,
           COALESCE(o.valor_estornado, 0)
      INTO v_ja_estornado, v_total, v_valor_estornado
      FROM public.marketplace_orders o
     WHERE o.id = p_order_id
       FOR UPDATE OF o;

    v_existe := FOUND;

    IF NOT v_existe THEN
        RAISE EXCEPTION 'pedido nao encontrado' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_ja_estornado THEN
        -- 3. Relê e TRAVA as linhas vivas com o pedido já travado. A linha
        --    que nasceu (cancelamento, solicitar_estorno) enquanto a trava do
        --    pedido era esperada fica travada ANTES da checagem abaixo: sem
        --    isto a marca do cron/edge cai entre a checagem e o UPDATE e o
        --    POST sai (cenário iv). O UPDATE final sozinho NÃO cobre isso.
        PERFORM 1
           FROM public.order_refunds releitura
          WHERE releitura.order_id = p_order_id
            AND releitura.status IN ('solicitado', 'em_processamento')
          ORDER BY releitura.id
            FOR UPDATE OF releitura;

        SELECT COALESCE(bool_or(r.solicitado_por IS DISTINCT FROM 'sistema'), false),
               COALESCE(bool_or(r.solicitado_por = 'sistema'), false)
          INTO v_em_processamento, v_disputa_em_curso
          FROM public.order_refunds r
         WHERE r.order_id = p_order_id
           AND r.status = 'em_processamento';

        -- O POST já saiu com a chave da linha: registrar uma devolução por
        -- fora agora é o caminho do cliente receber duas vezes.
        IF v_em_processamento THEN
            RAISE EXCEPTION 'O Mercado Pago já está devolvendo este dinheiro ao cliente (o app já pediu a devolução). Não registre nem faça outra devolução: se ela não aparecer no painel do Mercado Pago, faça-a pelo painel do Mercado Pago, nunca por outro caminho.'
                USING ERRCODE = '22023';
        END IF;

        -- Linha do SISTEMA (contestação/disputa no MP): o app não pediu nada,
        -- mas há dinheiro em movimento pelo MP — mesma recusa, texto próprio.
        IF v_disputa_em_curso THEN
            RAISE EXCEPTION 'Há uma disputa ou devolução do Mercado Pago em andamento para este pedido. Acompanhe pelo painel do Mercado Pago; não devolva por outro meio.'
                USING ERRCODE = '22023';
        END IF;

        SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
          FROM public.devolucoes d
         WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;

        IF v_total - v_valor_estornado - v_ja_manual <= 0 THEN
            RAISE EXCEPTION 'Este pedido não tem mais nada a devolver: o valor já saiu por outro caminho (devolução ou estorno).'
                USING ERRCODE = '22023';
        END IF;

        -- Ninguém pediu ao MP ainda: a linha sai da fila (as marcas do cron e
        -- da edge são condicionais por status e passam a achar 0 linhas).
        UPDATE public.order_refunds r
           SET status = 'recusado',
               ultimo_erro = 'A loja registrou a devolução feita fora do app',
               updated_at = now()
         WHERE r.order_id = p_order_id
           AND r.status = 'solicitado';

        UPDATE public.marketplace_orders
           SET payment_status = 'estornado',
               estorno_manual_registrado_em = COALESCE(estorno_manual_registrado_em, now())
         WHERE id = p_order_id;
    END IF;

    RETURN json_build_object('ok'::text, true, 'payment_status'::text, 'estornado');
END;
$$;

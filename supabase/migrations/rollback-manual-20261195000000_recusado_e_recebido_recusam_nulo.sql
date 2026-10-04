-- ROLLBACK MANUAL da 20261195000000_recusado_e_recebido_recusam_nulo.sql
-- Restaura, byte a byte, os dois corpos vigentes antes dela: confirmar_pagamento
-- (20260901000000, md5 b34f8033380177a45d500a2360ba2bdd) e registrar_pagamento_recebido
-- (20261020000000, md5 ac0b2d9856a1c3d2d38add0b5d737575). Aplicar com `psql -1 -f`: sem
-- BEGIN/COMMIT (regra da casa) e sem GRANT/REVOKE (CREATE OR REPLACE preserva
-- a ACL). Não há dado a desfazer — a migration só trocou corpo de função.
-- Depois de aplicar, NULL em 'recusado' volta a devolver estoque e NULL em
-- registrar_pagamento_recebido volta a significar "desfazer".
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT: o `DO $preflight_rollback_20261195$` logo
-- abaixo, ANTES de qualquer CREATE, confere o corpo VIVO das DUAS funções por
-- `md5(replace(prosrc, E'\r', ''))` (CRLF normalizado). Cada uma tem de ser o
-- que a 20261195 deixou OU o vigente original (reexecutar o rollback é
-- idempotente, de forma consciente):
--   confirmar_pagamento          pós-20261195  dc5632ca36019058225cdb520687c74a
--                                original      b34f8033380177a45d500a2360ba2bdd
--   registrar_pagamento_recebido pós-20261195  0a594768d4836bcc6d5064ce537b47dc
--                                original      ac0b2d9856a1c3d2d38add0b5d737575
-- Qualquer outro hash (ou função ausente) recusa com B1_BASELINE_DIVERGENT,
-- dizendo qual função e qual hash, sem gravar NADA: as duas são checadas antes
-- de recusar e nenhuma é recriada antes disso. Por quê: desfazer por cima de uma
-- redefinição POSTERIOR (uma migration futura que mexa em qualquer das duas
-- funções) apagaria o corpo dela em silêncio. Os quatro hashes são o md5 REAL
-- dos corpos e estão amarrados ao texto dos arquivos por
-- tests/migration_recusado_e_recebido_recusam_nulo_test.ts. O DO block roda na
-- MESMA transação do `psql -1 -f`: recusa = nada gravado.

DO $preflight_rollback_20261195$
DECLARE
  v_confirmar text;
  v_registrar text;
  v_problemas text := '';
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_confirmar
    FROM pg_proc
   WHERE oid = to_regprocedure('public.confirmar_pagamento(uuid,text,text)');

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_registrar
    FROM pg_proc
   WHERE oid = to_regprocedure('public.registrar_pagamento_recebido(uuid,boolean)');

  IF v_confirmar IS NULL OR v_confirmar NOT IN (
    'dc5632ca36019058225cdb520687c74a', -- corpo que a 20261195 deixou (o que este rollback desfaz)
    'b34f8033380177a45d500a2360ba2bdd'  -- corpo original que a 20260901 deixou — reexecução idempotente
  ) THEN
    v_problemas := v_problemas || format(' confirmar_pagamento (hash %s);', COALESCE(v_confirmar, 'ausente'));
  END IF;

  IF v_registrar IS NULL OR v_registrar NOT IN (
    '0a594768d4836bcc6d5064ce537b47dc', -- corpo que a 20261195 deixou (o que este rollback desfaz)
    'ac0b2d9856a1c3d2d38add0b5d737575'  -- corpo original que a 20261020 deixou — reexecução idempotente
  ) THEN
    v_problemas := v_problemas || format(' registrar_pagamento_recebido (hash %s);', COALESCE(v_registrar, 'ausente'));
  END IF;

  IF v_problemas <> '' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo diferente do que a 20261195000000 deixou e do original em:%  — uma redefinição posterior está no ar (desfazer por cima a apagaria) ou a função sumiu; revise antes de reverter.', v_problemas;
  END IF;
END $preflight_rollback_20261195$;

CREATE OR REPLACE FUNCTION public.confirmar_pagamento(
    p_order_id   uuid,
    p_payment_id text,
    p_status     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $confirmar$
DECLARE
    v_pedido RECORD;
BEGIN
    -- FOR UPDATE sem SKIP LOCKED: se a expirar_pedidos_vencidos esta com a
    -- linha, ESPERAR e' o comportamento correto. Pular deixaria o pagamento
    -- sem registro. Depois da espera, o payment_status lido aqui embaixo ja
    -- e' o que a varredura gravou — e' a releitura que decide, nao o WHERE.
    -- `status` entra no SELECT porque as transicoes que mexem em estoque OU
    -- decidem entre 'pago' e 'pago_apos_expirar' dependem dele — ver as tres
    -- guardas mais abaixo: `status = 'pending'` (estorno), `status <>
    -- 'pending'` (recusado) e `status = 'cancelled'` (pago — a que esta
    -- migration acrescenta).
    SELECT id, payment_status, status, gateway_payment_id
      INTO v_pedido
      FROM public.marketplace_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'inexistente';
    END IF;

    -- O pedido guarda o id da cobranca desde a criacao (Fase 2). Se o que
    -- chegou nao bate, alguem esta confirmando o pagamento de OUTRO pedido:
    -- nao escrever e deixar para uma pessoa olhar.
    --
    -- As duas primeiras clausulas NAO sao redundantes. `IS DISTINCT FROM`
    -- sozinho e' NULL-safe no sentido ERRADO para uma checagem de
    -- identidade: dois NULLs contam como iguais, e a guarda LIBERA
    -- justamente quando nao ha com o que comparar. Medido em 07/08/2026
    -- contra o banco real: pedido 'aguardando' sem gateway_payment_id,
    -- confirmado com p_payment_id NULL, virava 'pago' com paid_at carimbado
    -- e sem pagamento nenhum. E 'aguardando' + gateway_payment_id NULL e' o
    -- estado NORMAL de todo pedido entre o checkout e a criacao da cobranca
    -- — com a flag da Fase 2 desligada, e' o estado permanente.
    IF p_payment_id IS NULL
       OR v_pedido.gateway_payment_id IS NULL
       OR v_pedido.gateway_payment_id IS DISTINCT FROM p_payment_id THEN
        RETURN 'divergente';
    END IF;

    IF p_status = 'estornado' THEN
        IF v_pedido.payment_status = 'estornado' THEN
            RETURN 'ja_estornado';
        END IF;

        -- A partir de 'aguardando' NADA saiu: o estoque esta apenas
        -- RESERVADO, e devolver e' seguro. A regra "estorno nunca mexe em
        -- estoque" existe para o caso 'pago', onde a mercadoria pode ja ter
        -- saido — nao para este.
        --
        -- Sem este ramo o pedido ficaria 'estornado' com status 'pending', e
        -- a expirar_pedidos_vencidos (que exige payment_status='aguardando',
        -- ver 20260807000000:106) NUNCA MAIS o alcancaria: a reserva sumiria
        -- do catalogo para sempre. Medido em 07/08/2026 — 3 unidades
        -- perdidas, e a varredura rodando logo depois nao tocou na linha.
        -- `AND status = 'pending'` NAO e' zelo: e' a MESMA guarda que a
        -- expirar_pedidos_vencidos ja usa, pelo MESMO motivo, e esta
        -- explicada em 20260807000000:97-102. A update_order_status_atomic
        -- devolve o estoque quando o cliente cancela pelo app e NAO escreve
        -- payment_status — o pedido fica 'aguardando' + 'cancelled' com o
        -- estoque JA de volta. Sem esta clausula, creditar aqui poe no
        -- catalogo unidade que nao existe. Medido em 07/08/2026: 10 -> 13.
        --
        -- Vale igual para 'processing': venda que o admin fechou por fora
        -- dentro dos 30 min nao pode ser cancelada por confirmacao de
        -- gateway, e a mercadoria pode ja ter saido.
        IF v_pedido.payment_status = 'aguardando'
           AND v_pedido.status = 'pending' THEN
            PERFORM public.devolver_estoque(p_order_id);
            UPDATE public.marketplace_orders
               SET payment_status = 'estornado',
                   status         = 'cancelled',
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'estornado';
        END IF;

        -- Todo o resto: marca e NAO mexe em estoque. Isso inclui 'pago',
        -- 'pago_apos_expirar', 'expirado', 'recusado', NULL — e tambem o
        -- 'aguardando' que NAO esta 'pending', que caiu ate aqui pela guarda
        -- acima. A partir de 'pago' houve venda e possivelmente entrega;
        -- repor sozinho e' chutar onde a mercadoria esta. Nos demais o
        -- estoque JA voltou por outro caminho, e mexer de novo creditaria em
        -- dobro — devolver_estoque nao e' idempotente.
        UPDATE public.marketplace_orders
           SET payment_status = 'estornado',
               updated_at     = now()
         WHERE id = p_order_id;
        RETURN 'estornado';
    END IF;

    IF p_status = 'pago' THEN
        -- Idempotencia do webhook: o MP reenvia quando nao recebe 200 rapido.
        -- A segunda chamada cai aqui e nao dispara push de novo.
        IF v_pedido.payment_status IN ('pago', 'pago_apos_expirar') THEN
            RETURN 'ja_pago';
        END IF;

        -- A varredura ganhou a corrida: o estoque JA voltou. Nao mexer em
        -- estoque nem em status — so marcar e chamar uma pessoa. A vaga do
        -- cupom (Rodada 4) NUNCA saiu daqui: expirar_pedidos_vencidos parou
        -- de devolve-la no momento da expiracao, entao nao ha nada a
        -- reconsumir -- este pedido continua contando contra o limite do
        -- cupom desde a criacao, e a varredura de coupon_usage_returned so'
        -- vai libera-lo se este UPDATE NAO tivesse acontecido (payment_status
        -- 'pago_apos_expirar' fica de fora do WHERE dela -- ver a funcao
        -- devolver_cupons_de_pedidos_mortos() mais abaixo).
        IF v_pedido.payment_status = 'expirado' THEN
            UPDATE public.marketplace_orders
               SET payment_status = 'pago_apos_expirar',
                   paid_at        = now(),
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'pago_apos_expirar';
        END IF;

        IF v_pedido.payment_status = 'aguardando' THEN
            -- Achado bloqueante da revisao do PR #179 (Item 1): este era o
            -- UNICO dos tres ramos que so olhava payment_status, sem olhar
            -- status — os outros dois (estorno acima, recusado abaixo) ja
            -- tinham essa guarda. Cenario: cliente cancela pelo app com o QR
            -- do PIX na mao (OrderDetailsView.tsx, botao exposto para todo
            -- status='pending'); a update_order_status_atomic DEVOLVE o
            -- estoque e escreve so `status` — payment_status continua
            -- 'aguardando'. Nada cancela a cobranca no Mercado Pago, e o
            -- cliente paga o PIX assim mesmo. Sem esta guarda, o webhook
            -- gravava payment_status='pago' + paid_at com o pedido em
            -- 'cancelled': dinheiro recebido, estoque ja de volta na
            -- prateleira e revendivel, e o admin via o badge "Pago" verde,
            -- sem sinal de atencao — a varredura de expiracao nunca corrige,
            -- porque exige status='pending'.
            --
            -- A condicao e' `= 'cancelled'`, NAO `<> 'pending'`. A primeira
            -- versao usava `<> 'pending'` e foi reprovada em revisao: a CHECK
            -- de `status` permite pending, processing, shipping, delivered,
            -- cancelled, new — `<> 'pending'` pega CINCO desses, mas so
            -- 'cancelled' devolve estoque de verdade (update_order_status_
            -- atomic, 20260806000000_baseline_do_schema_vivo.sql:3512, so
            -- credita quando `p_new_status = 'cancelled'`). Um pedido que o
            -- admin adiantou para 'processing' dentro dos 30 min (o proprio
            -- caso que 20260807000000_reserva_com_expiracao.sql:100-102
            -- documenta como esperado) tem o PIX pago em seguida e cairia
            -- aqui com `<> 'pending'`, virando 'pago_apos_expirar' com
            -- estoque intacto — regressao: hoje em producao esse caso vira
            -- 'pago', que e' o correto, e o pedido ficaria preso na fila de
            -- atencao para sempre, porque nada reescreve 'pago_apos_expirar'
            -- de volta. `= 'cancelled'` e' exato porque, para
            -- payment_status='aguardando', o UNICO caminho ate status=
            -- 'cancelled' e' esta mesma update_order_status_atomic — a
            -- expiracao grava payment_status='expirado' (capturado pelo ramo
            -- de cima) e os ramos de estorno/recusa desta funcao gravam
            -- payment_status diferente de 'aguardando'. 'cancelled' implica
            -- "estoque ja voltou"; os outros quatro status implicam "dinheiro
            -- entrou, mercadoria saiu ou vai sair" — 'pago' e' o rotulo
            -- certo para eles.
            --
            -- Reusa 'pago_apos_expirar' em vez de criar um valor novo: o
            -- significado ja e' exatamente este ("dinheiro entrou, estoque ja
            -- voltou, precisa de gente"), e o valor ja tem needsAttention no
            -- badge do admin, balde no filtro por status de pagamento e texto
            -- proprio no push. Um valor novo exigiria alterar a CHECK em
            -- producao e mexer em quatro lugares a mais para o mesmo efeito.
            --
            -- A vaga do cupom (Rodada 4): mesmo raciocinio do ramo 'expirado'
            -- acima. update_order_status_atomic nunca a devolveu, entao nao
            -- ha o que reconsumir -- o pedido continua contando contra o
            -- limite do cupom desde a criacao.
            IF v_pedido.status = 'cancelled' THEN
                UPDATE public.marketplace_orders
                   SET payment_status = 'pago_apos_expirar',
                       paid_at        = now(),
                       updated_at     = now()
                 WHERE id = p_order_id;
                RETURN 'pago_apos_expirar';
            END IF;

            UPDATE public.marketplace_orders
               SET payment_status = 'pago',
                   paid_at        = now(),
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'pago';
        END IF;

        -- 'recusado', NULL (os 64 pedidos historicos) ou qualquer outro:
        -- nao inventar transicao.
        RETURN 'ignorado';
    END IF;

    IF p_status = 'recusado' THEN
        -- devolver_estoque NAO e' idempotente (ver o COMMENT dela). So se
        -- chama a partir de 'aguardando', que e' a unica transicao que
        -- acontece uma vez, e de dentro desta trava.
        IF v_pedido.payment_status <> 'aguardando' THEN
            RETURN 'ignorado';
        END IF;

        -- Mesma guarda do ramo do estorno, e pelo mesmo motivo — o gatilho
        -- aqui e' ate mais provavel: cartao recusado logo depois de o
        -- cliente desistir e cancelar pelo app. O estoque JA voltou pela
        -- update_order_status_atomic; creditar de novo poe unidade fantasma
        -- no catalogo. Medido em 07/08/2026: 10 -> 13.
        --
        -- Marca mesmo assim, em vez de 'ignorado': sem isso o pedido ficaria
        -- 'aguardando' para sempre — a varredura tambem exige
        -- status = 'pending' e nunca mais o alcancaria.
        IF v_pedido.status <> 'pending' THEN
            UPDATE public.marketplace_orders
               SET payment_status = 'recusado',
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'recusado';
        END IF;

        PERFORM public.devolver_estoque(p_order_id);

        UPDATE public.marketplace_orders
           SET payment_status = 'recusado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = p_order_id;
        RETURN 'recusado';
    END IF;

    -- 'aguardando' vindo do MP (pending/in_process) cai aqui: nada a fazer,
    -- o pedido ja esta nesse estado e a expiracao cuida do prazo.
    RETURN 'ignorado';
END;
$confirmar$;

CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(
    p_order_id uuid,
    p_recebido boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status          TEXT;
    v_payment_status  TEXT;
    v_payment_method  TEXT;
    v_caller          UUID := auth.uid();
    v_antes           TEXT;
    v_depois          TEXT;
    v_ja_estava       BOOLEAN := FALSE;
    v_recebido_em     TIMESTAMPTZ;
    v_recebido_por    UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';
    END IF;

    SELECT status, payment_status, payment_method,
           pagamento_recebido_em, pagamento_recebido_por
      INTO v_status, v_payment_status, v_payment_method,
           v_recebido_em, v_recebido_por
      FROM public.marketplace_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'Pedido cancelado não recebe pagamento.';
    END IF;

    IF v_payment_method = 'online' THEN
        RAISE EXCEPTION 'Este pedido é pago pelo site: quem confirma o pagamento é o gateway, não a loja.';
    END IF;

    v_antes := v_payment_status;

    IF p_recebido THEN
        IF v_payment_status = 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSIF v_payment_status IS NOT NULL THEN
            RAISE EXCEPTION 'Este pedido já tem pagamento registrado como "%": não dá para marcar recebimento na entrega por cima.', v_payment_status;
        ELSE
            v_depois := 'recebido_na_entrega';
            UPDATE public.marketplace_orders
               SET payment_status = v_depois,
                   pagamento_recebido_em = now(),
                   pagamento_recebido_por = v_caller,
                   updated_at = now()
             WHERE id = p_order_id
             RETURNING pagamento_recebido_em, pagamento_recebido_por
                  INTO v_recebido_em, v_recebido_por;
        END IF;
    ELSE
        IF v_payment_status IS DISTINCT FROM 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSE
            v_depois := NULL;
            UPDATE public.marketplace_orders
               SET payment_status = NULL,
                   pagamento_recebido_em = NULL,
                   pagamento_recebido_por = NULL,
                   updated_at = now()
             WHERE id = p_order_id;
            v_recebido_em := NULL;
            v_recebido_por := NULL;
        END IF;
    END IF;

    IF NOT v_ja_estava THEN
        INSERT INTO public.marketplace_order_payment_history
            (order_id, acao, payment_status_antes, payment_status_depois, created_by)
        VALUES
            (p_order_id,
             CASE WHEN p_recebido THEN 'recebido' ELSE 'desfeito' END,
             v_antes, v_depois, v_caller);
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'payment_status', v_depois,
        'pagamento_recebido_em', v_recebido_em,
        'pagamento_recebido_por', v_recebido_por,
        'ja_estava', v_ja_estava
    );
END;
$$;

-- Conserto do achado bloqueante da revisao do PR #179 (Item 1): o ramo 'pago'
-- da confirmar_pagamento (20260808000000) e' o UNICO dos tres que decide so
-- olhando payment_status, sem olhar status. Os outros dois (estorno e
-- recusado) ja receberam essa guarda em rodadas de conserto anteriores.
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

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
        -- estoque nem em status — so marcar e chamar uma pessoa.
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

REVOKE ALL ON FUNCTION public.confirmar_pagamento(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.confirmar_pagamento(uuid, text, text) IS
  'Unico caminho que escreve payment_status a partir do gateway. O webhook e a '
  'reconciliacao chamam ESTA funcao — nao um UPDATE proprio — porque a decisao '
  'depende de reler o estado sob FOR UPDATE, e nao do WHERE da chamada.';

-- RECUSADO E RECEBIDO RECUSAM O NULO (dinheiro; 04/10/2026) — duas guardas de
-- ENTRADA que a prova viva de 04/10/2026 (tests/banco/pagamentos-rpc-viva.cjs,
-- achados A1 e A3) mediu com o comportamento errado. Redefine
-- `public.confirmar_pagamento(uuid, text, text)` e
-- `public.registrar_pagamento_recebido(uuid, boolean)`, cada uma com UMA
-- mudança e o resto do corpo copiado VERBATIM do vigente.
--
-- (A1) confirmar_pagamento — o DEFEITO MEDIDO: no ramo 'recusado', a guarda
--   `IF v_pedido.payment_status <> 'aguardando' THEN RETURN 'ignorado'` NÃO
--   dispara quando payment_status é NULL: `NULL <> 'aguardando'` é NULL, e o
--   IF trata NULL como falso. Um pedido com payment_status NULL, cobrança
--   gravada (gateway_payment_id = o id que chegou) e status 'pending' passava
--   direto, DEVOLVIA o estoque e CANCELAVA o pedido — enquanto o 'pago' do
--   mesmo pedido dava 'ignorado' (o ramo do pago só age em 'expirado' e
--   'aguardando'). Assimetria que ninguém desenhou. Medido em 04/10/2026, no
--   Postgres 17: estoque 10 -> 13 e status 'cancelled'.
--   A CORREÇÃO: `IS DISTINCT FROM 'aguardando'` no lugar de `<> 'aguardando'`.
--   Para payment_status não nulo as duas formas dão o MESMO resultado; só o
--   NULL muda, e passa a ser 'ignorado' (não age em pedido que nunca esteve
--   aguardando pagamento).
--   HOJE NÃO ALCANÇÁVEL em produção: criar-pagamento só grava cobrança em
--   'aguardando'; só uma linha histórica com NULL + cobrança cairia aqui. É
--   por isso que a correção é barata e segura — e por isso vale fazer antes
--   que alguém a alcance.
--
-- (A3) registrar_pagamento_recebido — o DEFEITO MEDIDO: `p_recebido` NULL caía
--   no ELSE de `IF p_recebido THEN … ELSE …` e se comportava como DESFAZER
--   (zerava payment_status/pagamento_recebido_em/_por e gravava a linha
--   'desfeito' no histórico). O front sempre manda booleano (os três
--   chamadores — OrderDetail, o cartão da lista e a ficha — passam true/false
--   tipados), então o risco é de chamada direta, mas apagar um recebimento por
--   argumento nulo, sem recusa, é dinheiro que some.
--   A CORREÇÃO: logo DEPOIS de `IF NOT public.is_admin()` (autorização
--   primeiro: quem não é admin continua vendo 'Não autorizado', nunca o erro
--   de NULL) e ANTES do `SELECT … FOR UPDATE` e de qualquer UPDATE/INSERT:
--   `IF p_recebido IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22004', …`.
--   Antes do lock de propósito: a recusa não espera quem está gravando a mesma
--   linha. NÃO é STRICT: STRICT devolveria NULL em silêncio, que é o mesmo
--   defeito com outra cara. Para entrada válida (true/false) o retorno e todos
--   os erros são os mesmos de antes.
--
-- O QUE NÃO MUDA (de propósito): o "desfazer" do recebimento de pedido já
-- entregue (decisão de produto a confirmar — achado A2 da prova viva), a
-- assinatura, `SECURITY DEFINER`, `SET search_path = public` (registrar) e
-- `SET search_path TO 'public'` (confirmar), o `FOR UPDATE`, os RETURNs.
-- GRANT/REVOKE: `CREATE OR REPLACE` preserva a ACL vigente (confirmar: só
-- service_role — 20260810000000; registrar: authenticated e service_role —
-- 20261020000000) e nenhuma redefinição repete GRANT/REVOKE aqui.
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita ao aplicar — troca só o
-- corpo das duas funções. Pedido, histórico de recebimento e estoque ficam
-- exatamente como estão.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE FUNCTION` — reaplicar produz o mesmo corpo,
-- e o preflight abaixo aceita tanto o corpo vigente quanto o que esta migration
-- deixa.
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT (mesmo padrão da 20261186000000): o
-- `DO $preflight_20261195$` logo abaixo, ANTES dos dois `CREATE`, recusa com
-- `B1_BASELINE_DIVERGENT` se o corpo VIVO de qualquer das duas funções não
-- bater, por `md5(replace(prosrc, E'\r', ''))` (CRLF normalizado), nem com o
-- vigente nem com o que ESTA migration deixa:
--   confirmar_pagamento          vigente (20260901000000)  b34f8033380177a45d500a2360ba2bdd
--                                esta migration            dc5632ca36019058225cdb520687c74a
--   registrar_pagamento_recebido vigente (20261020000000)  ac0b2d9856a1c3d2d38add0b5d737575
--                                esta migration            0a594768d4836bcc6d5064ce537b47dc
-- Os quatro hashes são o md5 REAL dos corpos e estão amarrados ao texto dos
-- arquivos por tests/migration_recusado_e_recebido_recusam_nulo_test.ts. O DO
-- block roda na MESMA transação do restante: recusa = nada gravado.
--
-- ORDEM DE APLICAÇÃO: depois da 20260901000000 e da 20261020000000 (as duas
-- que deixam os corpos vigentes); independente da 20261192000000 e de qualquer
-- outra migration desta frente (nenhuma toca estas duas funções).
--
-- COMO APLICAR: pelo workflow `aplicar-migrations.yml` (Actions -> Run
-- workflow), `migracoes = 20261195000000_recusado_e_recebido_recusam_nulo.sql` — que roda a prova `BEGIN; <arquivo>;
-- ROLLBACK;` antes do apply de verdade. Sem `BEGIN`/`COMMIT` de nível
-- superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO:
--   1. `SELECT pg_get_functiondef('public.confirmar_pagamento(uuid,text,text)'::regprocedure)`
--      contém `IS DISTINCT FROM 'aguardando'` depois de aplicar.
--   2. Pedido com payment_status NULL, gateway_payment_id = 'X' e status
--      'pending': `SELECT public.confirmar_pagamento(<id>, 'X', 'recusado')`
--      devolve 'ignorado' e não mexe em estoque nem em status.
--   3. Como admin, `SELECT public.registrar_pagamento_recebido(<id>, NULL)`
--      falha com SQLSTATE 22004; com true/false segue como antes.
--   4. Como não-admin, o mesmo NULL falha com 'Não autorizado' (não com 22004).
--   5. Aplicar sobre um corpo diferente dos dois hashes: B1_BASELINE_DIVERGENT.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261195000000_recusado_e_recebido_recusam_nulo.sql
-- restaura, byte a byte, os dois corpos vigentes (20260901000000 e
-- 20261020000000). Aplicar com `psql -1 -f`.

DO $preflight_20261195$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.confirmar_pagamento(uuid,text,text)');

  IF v_hash IS NULL OR v_hash NOT IN (
    'b34f8033380177a45d500a2360ba2bdd', -- corpo que a 20260901 deixou (vigente até aqui)
    'dc5632ca36019058225cdb520687c74a'  -- corpo que ESTA migration deixa — reaplicação idempotente
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de confirmar_pagamento (hash %) não é o que a 20260901000000 deixou nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.registrar_pagamento_recebido(uuid,boolean)');

  IF v_hash IS NULL OR v_hash NOT IN (
    'ac0b2d9856a1c3d2d38add0b5d737575', -- corpo que a 20261020 deixou (vigente até aqui)
    '0a594768d4836bcc6d5064ce537b47dc'  -- corpo que ESTA migration deixa — reaplicação idempotente
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de registrar_pagamento_recebido (hash %) não é o que a 20261020000000 deixou nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_20261195$;

-- 1. confirmar_pagamento: a guarda do 'recusado' passa a ser NULL-safe -------
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
        IF v_pedido.payment_status IS DISTINCT FROM 'aguardando' THEN
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

-- 2. registrar_pagamento_recebido: NULL deixa de significar "desfazer" ------
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

    -- NULL nao e nem "recebi" nem "desfiz": sem esta recusa o ELSE de
    -- `IF p_recebido` o tratava como DESFAZER (20261195000000). Vem DEPOIS da
    -- autorizacao (quem nao e admin nao aprende nada) e ANTES do SELECT ... FOR
    -- UPDATE, para recusar sem esperar a linha de quem esta gravando.
    IF p_recebido IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22004',
            MESSAGE = 'Informe se o pagamento foi recebido (true) ou desfeito (false).';
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

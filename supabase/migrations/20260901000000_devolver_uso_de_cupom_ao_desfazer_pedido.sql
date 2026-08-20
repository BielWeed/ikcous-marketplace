-- Devolve o uso do cupom quando o pedido que o usou esta DEFINITIVAMENTE
-- morto -- e so entao. SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.
--
-- ESTA E A QUARTA RODADA. AS TRES ANTERIORES, E POR QUE CADA UMA MORREU:
--
--   Rodada 1 (a correcao original) devolvia o uso do cupom no MOMENTO em que
--   um pedido com cupom era desfeito -- nos mesmos quatro pontos que ja
--   devolviam estoque: expirar_pedidos_vencidos, update_order_status_atomic
--   (cancelamento manual), e os dois ramos de confirmar_pagamento com a
--   reserva intacta (estornado, recusado). Achado por um revisor de contexto
--   limpo (20/08/2026): expirar_pedidos_vencidos -> devolver_estoque devolve
--   o estoque e NAO decrementa coupons.usage_count -- confirmado ao vivo no
--   banco em 20/08/2026 via pg_get_functiondef.
--
--   Rodada 2 acrescentou reconsumir_uso_cupom nos dois pontos onde
--   confirmar_pagamento grava 'pago_apos_expirar' -- porque um pedido
--   desfeito NAO e necessariamente um pedido morto: o PIX continua pagavel
--   depois da expiracao (ou do cancelamento manual), e o cliente pode pagar
--   o QR na mao mesmo com o pedido ja 'cancelled'. Sem reconsumir, o mesmo
--   cupom de uso unico seria usado duas vezes: devolvido na Rodada 1,
--   consumido de novo na criacao de OUTRO pedido, e o pedido original ainda
--   assim seria pago com desconto.
--
--   Rodada 3 foi bloqueada de novo, e mais fundo: reconsumir_uso_cupom
--   DEDUZIA o fato "a vaga ja foi devolvida" a partir do ESTADO do pedido
--   (payment_status = 'expirado' ou status = 'cancelled'). Para toda linha
--   que JA ESTA nesse estado no momento em que a migration e aplicada -- e
--   sao 27 pedidos 'expirado' e 1 'pago_apos_expirar' so no banco de
--   desenvolvimento --, a deducao e FALSA: a Rodada 1 nunca rodou sobre elas
--   (a migration nunca foi aplicada em producao), entao a vaga NUNCA foi
--   devolvida -- mas confirmar_pagamento acha que sim, e reconsome de
--   qualquer jeito. E o cron reconciliar-pagamentos (20260808000100) varre
--   exatamente esses estados a cada 10 minutos, chamando confirmar_pagamento
--   -- um pedido, uma compra, DUAS vagas consumidas, para sempre.
--
--   Tres defeitos no mesmo subsistema, cada um criado pela correcao
--   anterior, acusam o DESENHO, nao a implementacao. A regra desta casa e
--   remover a premissa, nao tratar o sintoma.
--
-- A DECISAO DE PRODUTO DO GABRIEL, QUE DISSOLVE A PREMISSA (esta rodada):
-- "a vaga fica reservada enquanto o PIX estiver aberto." Traduzido para
-- codigo: a vaga do cupom NAO volta quando o pedido e desfeito -- ela volta
-- quando o pedido esta DEFINITIVAMENTE morto, isto e, quando o PIX ja nao
-- pode mais ser pago. E o projeto ja sabe quando isso acontece: esta escrito
-- em pagamentos_a_reconciliar() (20260808000100_reconciliacao.sql), o mesmo
-- "AND expires_at > now() - interval '24 hours'" que ja governa a
-- reconciliacao -- reusado aqui, nao reinventado.
--
-- O QUE ISTO DISSOLVE, E POR QUE O DESENHO E SUBTRATIVO:
--
--   * reconsumir_uso_cupom DEIXA DE EXISTIR. Nada e devolvido enquanto o
--     pagamento ainda pode chegar, entao nao ha o que reconsumir.
--   * As chamadas de devolver_uso_cupom nos QUATRO pontos de desfazimento
--     SAEM. Devolver ali e exatamente o que abria a janela das Rodadas 2 e 3.
--   * O buraco da linha pre-existente morre: ninguem mais DEDUZ nada a
--     partir do payment_status/status de um pedido. O fato "a vaga ja
--     voltou" passa a ser REGISTRADO, na coluna nova
--     marketplace_orders.coupon_usage_returned -- nunca deduzido. Toda linha
--     nasce (ou ja existe, via DEFAULT) com FALSE, porque nenhuma versao
--     anterior desta migration jamais rodou em producao (nunca foi
--     aplicada) -- entao FALSE e verdadeiro para toda linha viva hoje.
--   * A oscilacao cancelled -> processing -> cancelled (achado 2 da Rodada
--     1, documentado e NAO corrigido la) para de importar: nenhum ponto de
--     desfazimento chama mais devolver_uso_cupom, entao cancelar o mesmo
--     pedido duas vezes nao decrementa duas vezes. Quem devolve e' SO a
--     varredura abaixo, uma unica vez por pedido, guardada pela coluna nova
--     -- efeito colateral da subtracao, nao um consertozinho a parte.
--   * O caminho cancelled -> pago (que um revisor achou usando a fila
--     offline do useOrders.ts) morre junto: sem reconsumir_uso_cupom, um
--     pedido que volta a ser pago nao mexe em usage_count nenhuma vez -- ele
--     so deixa de ser candidato da varredura (ver a guarda de
--     payment_status abaixo).
--   * coupons.usage_count nao pode mais passar de usage_limit por este
--     caminho: a vaga so' sai (na criacao) e so' volta (na varredura, uma
--     vez), nunca as duas coisas fora de ordem.
--
-- ONDE A DEVOLUCAO PASSA A MORAR: um lugar so'. Uma varredura nova,
-- devolver_cupons_de_pedidos_mortos(), no mesmo espirito de
-- expirar_pedidos_vencidos (FOR UPDATE SKIP LOCKED, mesmo padrao de loop),
-- mas com JOB PROPRIO em vez de entrar dentro de expirar_pedidos_vencidos:
--
--   * FUNCAO PROPRIA (a escolha feita aqui): expirar_pedidos_vencidos tem um
--     contrato ja testado e documentado ("flipar reserva vencida em 30
--     min") -- e o db-apply.cjs ja verifica marcadores exatos dentro do
--     corpo dela. Enfiar uma varredura de janela de 24h (oito vezes mais
--     larga, sem relacao com o prazo de 30 min da reserva) dentro dela
--     confunde as duas responsabilidades e arrisca quebrar aquela
--     verificacao por um motivo que nao tem nada a ver com expiracao de
--     reserva. O custo: mais um CREATE FUNCTION, mais um pg_cron job, mais
--     uma entrada no mapa de verificacao do db-apply.cjs -- tudo barato e
--     isolado.
--   * PENDURAR EM expirar_pedidos_vencidos custaria menos codigo (zero
--     funcao nova, zero job novo), mas amarraria para sempre a cadencia da
--     devolucao de cupom (que nao tem pressa -- o pior caso de atraso e'
--     "vaga de cupom fica presa uns minutos a mais", direcao SEGURA) a
--     cadencia da expiracao de reserva (que tem, 5 minutos, porque reserva
--     de estoque parada custa venda perdida). Direcoes de urgencia
--     diferentes nao deveriam compartilhar cadencia.
--
-- CRITERIO DA VARREDURA -- as quatro perguntas que a tarefa exige resposta:
--
--   1. COMO A VARREDURA SABE QUE A VAGA JA VOLTOU: pela coluna
--      marketplace_orders.coupon_usage_returned (boolean, NOT NULL, DEFAULT
--      false) -- um FATO REGISTRADO, nunca deduzido de payment_status ou
--      status. E' exatamente o caminho que o revisor da Rodada 3 apontou, e
--      tem a vantagem de tornar a operacao idempotente por CONSTRUCAO: a
--      segunda passada da varredura sobre o MESMO pedido nao encontra
--      candidato, porque o WHERE ja filtra coupon_usage_returned = FALSE.
--
--   2. ONDE A VARREDURA RODA: funcao propria com job proprio (ver acima),
--      agendada a cada 15 minutos -- mais espacada que os 5 min de
--      expirar_pedidos_vencidos e os 10 min de reconciliar-pagamentos, de
--      proposito: liberar uma vaga de cupom nao tem a mesma urgencia que
--      devolver estoque ou reconciliar dinheiro, e o erro seguro aqui e'
--      atrasar a liberacao, nunca adianta-la.
--
--   3. O CANCELAMENTO MANUAL: um pedido cancelado pelo lojista (ou pelo
--      cliente, via update_order_status_atomic) com payment_status ainda
--      'aguardando' continua com o PIX pagavel ate expires_at + 24h -- a
--      MESMA regra vale para ele, porque o filtro da varredura e' sobre
--      status/tempo, nao sobre COMO o pedido morreu. Nao ha ramo especial
--      para "cancelado manualmente": ele cai no mesmo WHERE que o expirado,
--      o estornado e o recusado, todos com status = 'cancelled' apos o
--      desfazimento.
--
--   4. PEDIDO SEM expires_at: NAO e' so residuo historico -- e' o caminho
--      CORRENTE de todo pedido "na entrega" (comPagamentoOnline=false),
--      criado por create_marketplace_order_v23, que e' a via PADRAO do app
--      (useOrders.ts:1059-1061 -- a v24 so' entra quando comPagamentoOnline
--      e' true). A v23 grava coupon_id e incrementa usage_count, mas nunca
--      grava expires_at nem payment_status -- entao expires_at IS NULL
--      significa "este pedido nunca teve um PIX aberto por este caminho",
--      entao nao ha janela de pagamento tardio nenhuma para proteger: um
--      pedido v23 nunca tem gateway_payment_id, e confirmar_pagamento
--      devolve 'divergente' nesse caso (ver mais abaixo), entao ele jamais
--      vira pago. Criterio: libera assim que o pedido e' desfeito, sem
--      esperar as 24h -- (expires_at IS NULL OR expires_at < now() -
--      interval '24 hours') no WHERE abaixo.
--
-- GUARDA DE STATUS/PAYMENT_STATUS, E POR QUE ELA REPLICA EXATAMENTE OS
-- QUATRO PONTOS ANTIGOS: "status = 'cancelled' AND payment_status IS
-- DISTINCT FROM 'pago' AND payment_status IS DISTINCT FROM
-- 'pago_apos_expirar'" e' o MESMO conjunto de pedidos que os quatro pontos
-- desfeitos desta migration levavam a status='cancelled' -- expirado,
-- estornado (com reserva intacta) e recusado (com reserva intacta) todos
-- gravam status='cancelled' junto com o payment_status correspondente; o
-- cancelamento manual grava status='cancelled' sem tocar payment_status
-- (fica 'aguardando'). O UNICO jeito de um pedido 'cancelled' ter
-- payment_status 'pago' ou 'pago_apos_expirar' e' confirmar_pagamento tendo
-- pago ele DEPOIS do desfazimento -- e a funcao NUNCA reescreve a coluna
-- `status` nesse caminho (ela fica 'cancelled', so payment_status muda) --
-- entao excluir esses dois valores de payment_status e' exatamente excluir
-- "pedido desfeito que foi pago depois", sem deduzir nada alem do que o
-- proprio confirmar_pagamento ja registrou.
--
-- IS DISTINCT FROM, nao <>: 'aguardando' (cancelamento manual) e NULL (as
-- 64 linhas historicas) sao os dois casos onde `payment_status <>
-- 'pago'` avaliaria para NULL (falso) por acidente na comparacao contra
-- NULL -- o mesmo motivo pelo qual update_order_status_atomic ja usa
-- IS DISTINCT FROM para a checagem de dono.

-- 1. Coluna nova: registra o fato, nunca deduz -----------------------------
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS coupon_usage_returned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.marketplace_orders.coupon_usage_returned IS
  'FATO registrado (nunca deduzido de status/payment_status): true quando '
  'devolver_cupons_de_pedidos_mortos() ja devolveu a vaga do cupom deste '
  'pedido. Nasce false para toda linha -- inclusive as pre-existentes -- '
  'porque nenhuma versao anterior desta funcionalidade jamais rodou em '
  'producao. Só importa quando coupon_id IS NOT NULL.';

-- Indice parcial para a varredura nao fazer seq scan a cada 15 minutos --
-- mesmo padrao de idx_marketplace_orders_expiracao (20260807000000).
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_cupom_a_devolver
  ON public.marketplace_orders (expires_at)
  WHERE coupon_id IS NOT NULL
    AND status = 'cancelled'
    AND coupon_usage_returned = FALSE;

-- 2. devolver_uso_cupom: sobrevive sem mudanca -- so' muda QUEM chama ------
CREATE OR REPLACE FUNCTION public.devolver_uso_cupom(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver_cupom$
DECLARE
    v_coupon_id uuid;
    v_novo      integer;
BEGIN
    SELECT coupon_id INTO v_coupon_id
      FROM public.marketplace_orders
     WHERE id = p_order_id;

    IF v_coupon_id IS NULL THEN
        RETURN 0;
    END IF;

    UPDATE public.coupons
       SET usage_count = GREATEST(usage_count - 1, 0)
     WHERE id = v_coupon_id
     RETURNING usage_count INTO v_novo;

    RETURN COALESCE(v_novo, 0);
END;
$devolver_cupom$;

REVOKE ALL ON FUNCTION public.devolver_uso_cupom(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.devolver_uso_cupom(uuid) IS
  'Nao e idempotente por si so (mesmo contrato de devolver_estoque): duas '
  'chamadas para o mesmo pedido decrementam usage_count duas vezes (ate o '
  'piso 0, nunca abaixo). Desde a Rodada 4, o UNICO chamador e '
  'devolver_cupons_de_pedidos_mortos(), que garante "uma unica vez por '
  'pedido, para sempre" por outro caminho: a coluna '
  'marketplace_orders.coupon_usage_returned (registrada, nunca deduzida) '
  'somada ao FOR UPDATE SKIP LOCKED do loop da varredura.';

-- 3. reconsumir_uso_cupom DEIXA DE EXISTIR ---------------------------------
-- Nunca foi aplicada em producao (nenhuma rodada anterior chegou a subir);
-- o DROP e' defensivo, para o caso de algum ambiente de teste ter aplicado
-- uma versao anterior deste MESMO arquivo por fora do fluxo normal.
DROP FUNCTION IF EXISTS public.reconsumir_uso_cupom(uuid);

-- 4. expirar_pedidos_vencidos: a chamada de devolver_uso_cupom SAI ---------
--    (ela nao devolve mais no momento do desfazimento -- so' na varredura)
CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $expirar$
DECLARE
    v_pedido   RECORD;
    v_expirados integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED protege contra OUTRA varredura: se dois ciclos do
    -- pg_cron se sobrepuserem, o segundo pula a linha travada em vez de creditar
    -- estoque duas vezes. NAO resolve a corrida com o webhook da Fase 3: se a
    -- varredura pegar a trava primeiro, o UPDATE do webhook espera, reavalia o
    -- WHERE por id (que continua valendo) e sobrescreve — sai pedido 'pago' com
    -- status 'cancelled' e estoque ja devolvido. Tratar esse estado e' obrigacao
    -- de quem escrever o webhook; a CHECK ja reserva 'pago_apos_expirar' para
    -- ele. Este comentario e' o que a Fase 3 vai ler: nao prometa aqui garantia
    -- que o codigo nao da.
    --
    -- status = 'pending' e' o filtro que impede credito em dobro: quando o
    -- cliente cancela pelo app, a update_order_status_atomic JA devolve o
    -- estoque e NAO escreve payment_status. Sem este AND, o pedido cancelado as
    -- 10:05 seria varrido as 10:30 e creditado uma segunda vez. Vale tambem para
    -- o pedido que o admin adiantou para 'processing' dentro dos 30 minutos:
    -- venda fechada por fora nao pode ser cancelada por varredura.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE payment_status = 'aguardando'
          AND status = 'pending'
          AND expires_at IS NOT NULL
          AND expires_at < now()
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_estoque(v_pedido.id);

        UPDATE public.marketplace_orders
           SET payment_status = 'expirado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = v_pedido.id;

        v_expirados := v_expirados + 1;
    END LOOP;

    RETURN v_expirados;
END;
$expirar$;

-- 5. update_order_status_atomic: a chamada de devolver_uso_cupom SAI -------
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
    v_item RECORD;
    v_result jsonb;
BEGIN
    -- Antes de qualquer leitura: sem sessão, nem existência de pedido se revela.
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado: é preciso estar autenticado para alterar um pedido.';
    END IF;

    -- Get current status and lock row
    SELECT status, user_id INTO v_old_status, v_user_id
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
        IF v_old_status IS DISTINCT FROM 'pending' THEN
            RAISE EXCEPTION 'Apenas pedidos pendentes podem ser cancelados pelo usuário.';
        END IF;
    END IF;

    -- STOCK RESTORATION LOGIC
    -- If transitioning to 'cancelled' from a non-cancelled status
    IF p_new_status = 'cancelled' AND v_old_status IS DISTINCT FROM 'cancelled' THEN
        FOR v_item IN SELECT product_id, variant_id, quantity FROM public.marketplace_order_items WHERE order_id = p_order_id
        LOOP
            IF v_item.variant_id IS NOT NULL THEN
                UPDATE public.product_variants
                SET stock_increment = stock_increment + v_item.quantity
                WHERE id = v_item.variant_id;
            ELSE
                UPDATE public.produtos
                SET estoque = estoque + v_item.quantity
                WHERE id = v_item.product_id;
            END IF;
        END LOOP;

        -- A vaga do cupom NAO volta aqui (Rodada 4): ela so' volta na
        -- varredura devolver_cupons_de_pedidos_mortos(), depois que o PIX
        -- ja nao pode mais ser pago (expires_at + 24h). Devolver no momento
        -- do cancelamento e' exatamente o que abriu a janela das Rodadas 2 e
        -- 3 -- ver o cabecalho desta migration.
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

-- 6. confirmar_pagamento: as quatro chamadas (2 devolver + 2 reconsumir) ---
--    SAEM. A reserva estornada/recusada fica intacta ate a varredura, e o
--    pedido que volta a ser pago nao mexe em usage_count nenhuma vez.
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

-- 7. A varredura: o lugar unico onde a vaga do cupom volta -----------------
CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver_cupons_mortos$
DECLARE
    v_pedido     RECORD;
    v_devolvidos integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED: mesma protecao de expirar_pedidos_vencidos --
    -- se dois ciclos deste cron se sobrepuserem, ou se confirmar_pagamento
    -- estiver processando o MESMO pedido neste instante (por exemplo, um
    -- pagamento tardio que acabou de chegar), quem perder a corrida pela
    -- linha pula e tenta de novo no proximo ciclo -- nunca decrementa duas
    -- vezes, nunca decrementa um pedido que acabou de ser pago.
    --
    -- coupon_id IS NOT NULL: so' pedido com cupom entra na varredura.
    --
    -- status = 'cancelled' AND payment_status IS DISTINCT FROM 'pago' AND
    -- payment_status IS DISTINCT FROM 'pago_apos_expirar': exatamente o
    -- conjunto dos quatro pontos de desfazimento que ANTES desta migration
    -- devolviam (ou reconsumiam) o uso do cupom -- ver o cabecalho desta
    -- migration para a prova de que este WHERE reproduz aquele conjunto sem
    -- deduzir nada alem do que confirmar_pagamento ja registra.
    --
    -- coupon_usage_returned = FALSE: o FATO registrado, nunca deduzido --
    -- e' isto que torna a operacao idempotente por construcao. Pedido
    -- pre-existente (criado antes desta migration) nasce FALSE pelo
    -- DEFAULT da coluna, e entra na varredura normalmente -- correto,
    -- porque nenhuma versao anterior desta migration jamais rodou em
    -- producao.
    --
    -- expires_at IS NULL OR expires_at < now() - interval '24 hours': o
    -- numero da casa (pagamentos_a_reconciliar, 20260808000100), a decisao
    -- do Gabriel de que "a vaga fica reservada enquanto o PIX estiver
    -- aberto". expires_at IS NULL NAO e' so residuo historico -- e' o
    -- caminho CORRENTE de todo pedido "na entrega" criado por
    -- create_marketplace_order_v23 (a via PADRAO do app, useOrders.ts:
    -- 1059-1061; a v24 so' entra com pagamento online): v23 nunca grava
    -- expires_at nem payment_status, entao NULL aqui significa "nunca
    -- houve PIX por este caminho" -- sem janela nenhuma para proteger.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE coupon_id IS NOT NULL
          AND status = 'cancelled'
          AND payment_status IS DISTINCT FROM 'pago'
          AND payment_status IS DISTINCT FROM 'pago_apos_expirar'
          AND coupon_usage_returned = FALSE
          AND (expires_at IS NULL OR expires_at < now() - interval '24 hours')
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_uso_cupom(v_pedido.id);

        UPDATE public.marketplace_orders
           SET coupon_usage_returned = TRUE
         WHERE id = v_pedido.id;

        v_devolvidos := v_devolvidos + 1;
    END LOOP;

    RETURN v_devolvidos;
END;
$devolver_cupons_mortos$;

REVOKE ALL ON FUNCTION public.devolver_cupons_de_pedidos_mortos()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.devolver_cupons_de_pedidos_mortos() IS
  'Unico lugar onde a vaga de um cupom volta depois que um pedido que o '
  'usou e desfeito. Só age sobre pedido definitivamente morto -- PIX '
  'que ja nao pode mais ser pago, pelo mesmo criterio de '
  'pagamentos_a_reconciliar (expires_at + 24h) -- e nunca deduz "ja '
  'devolvido" do estado: le e grava o fato na coluna '
  'coupon_usage_returned. Agendada via pg_cron a cada 15 minutos, ver '
  'abaixo.';

-- 8. Agendamento: job proprio, cadencia proprio ----------------------------
-- pg_cron ja foi instalada por 20260807000001_agenda_expiracao.sql; a linha
-- abaixo e' no-op em producao e existe so' para a migration ser
-- auto-suficiente num banco que ainda nao tenha a extensao.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove agendamento anterior de mesmo nome, para a migration ser
-- reaplicavel.
SELECT cron.unschedule('devolver-cupons-de-pedidos-mortos')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'devolver-cupons-de-pedidos-mortos'
);

-- */15: mais espacado que os 5 min de expirar-pedidos-vencidos e os 10 min
-- de reconciliar-pagamentos, de proposito -- ver o cabecalho desta
-- migration ("ONDE A VARREDURA RODA").
SELECT cron.schedule(
  'devolver-cupons-de-pedidos-mortos',
  '*/15 * * * *',
  $cron$ SELECT public.devolver_cupons_de_pedidos_mortos(); $cron$
);

-- Botao de desligar, se o job se comportar mal (comentario, nao instrucao
-- executavel):
-- SELECT cron.unschedule('devolver-cupons-de-pedidos-mortos');

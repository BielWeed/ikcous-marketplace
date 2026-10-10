-- "JÁ ESTORNEI" SÓ EM PEDIDO PAGO (dinheiro; 04/10/2026) — redefine
-- `public.registrar_estorno_manual` (corpo vigente vindo de
-- `20261189000000_ja_estornei_fecha_a_corrida_com_o_cron.sql`, a última
-- definição da fila) acrescentando UMA guarda: só registra a devolução feita
-- fora do app se o dinheiro ENTROU — `payment_status` em 'pago',
-- 'pago_apos_expirar' ou 'recebido_na_entrega'.
--
-- O DEFEITO: a RPC não conferia o pagamento. Um admin podia marcar
-- `estornado` um pedido `aguardando` com PIX aberto; o pagamento que chega
-- depois cai em `RETURN 'ignorado'` no confirmar_pagamento (20260901000000
-- ~563-565: pedido já estornado) e o dinheiro some sem alerta nenhum.
-- `solicitar_estorno` já exige pago (20261175000000 ~1838). As telas só
-- mostram o botão em pedido pago e cancelado, mas a RPC é a fronteira.
--
-- A REGRA: dentro do `IF NOT v_ja_estornado` — o pedido já está travado
-- (`FOR UPDATE OF o`) e o 'pedido nao encontrado' já passou —, ANTES da
-- releitura do ledger e de qualquer escrita, recusa com
-- `RAISE ... USING ERRCODE = '22023'` (mesmo SQLSTATE das recusas vizinhas;
-- o painel mostra o texto do servidor para 22023, AdminOrdersView.tsx
-- ~950-962) quando o pedido não está em nenhum dos três status. É
-- `NOT EXISTS (... payment_status IN (...))`: payment_status NULL também
-- recusa (um `IF v NOT IN (...)` com v NULL avaliaria NULL e deixaria
-- passar). `recebido_na_entrega` CONTINUA aceito: é o status da venda de
-- balcão (registrar_venda_presencial, 20261162000000) e da entrega paga em
-- dinheiro/PIX na mão (registrar_pagamento_recebido, 20261020000000) — o
-- "Já devolvi" desses é a devolução em espécie, e o Financeiro desconta da
-- gaveta (20261177000000).
--   Pedido JÁ `estornado`: continua ok idempotente — a guarda fica DENTRO do
-- `IF NOT v_ja_estornado`, então o clique repetido não é recusado.
--
-- O QUE NÃO MUDA: o corpo inteiro da 20261189 byte a byte (as três travas
-- linha -> pedido -> releitura, as recusas de `em_processamento` e de
-- disputa, a regra de saldo, a linha `solicitado` -> `recusado`, o carimbo
-- `estorno_manual_registrado_em`), assinatura `(p_order_id uuid) RETURNS
-- json`, `SECURITY DEFINER`, `SET search_path = public`, a porta
-- `is_admin()` (42501), o 'pedido nao encontrado' (P0002) e o retorno
-- `{ok: true, payment_status: 'estornado'}`. GRANT/REVOKE: `CREATE OR
-- REPLACE` preserva a ACL vigente (nascida na 20261072000000; nem a 20261176
-- nem a 20261189 a repetem). Nenhum COMMENT ON FUNCTION existe nem é criado.
-- A guarda só LÊ a linha que a própria função já travou: nenhuma trava nova,
-- nenhuma ordem de trava nova (o raciocínio de deadlock da 20261189 vale
-- inteiro).
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita ao aplicar — troca só
-- o corpo da função. Pedido que JÁ foi marcado `estornado` estando
-- `aguardando` (antes desta migration) fica como está: a guarda só vale para
-- o próximo clique, e o clique repetido nele segue ok (já estornado). Esta
-- migration NÃO procura nem conserta esses pedidos: se um pagamento chegou
-- depois para algum deles, ele já caiu em 'ignorado' — levantá-los é
-- consulta à parte. Em dinheiro, o Financeiro já não os conta na gaveta
-- (guarda de `pagamento_recebido_em`, 20261177000000, provada em
-- tests/banco/financeiro-viva.cjs A3-8, que planta esse estado direto).
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE FUNCTION` — reaplicar produz o mesmo corpo,
-- e o preflight aceita o hash do corpo que esta migration deixa.
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT: `CREATE OR REPLACE FUNCTION` em plpgsql
-- NÃO valida identificador na criação. O `DO $preflight_20261194$` abaixo,
-- ANTES do `CREATE`, recusa se o corpo VIVO de `registrar_estorno_manual`,
-- por `md5(replace(prosrc, E'\r', ''))`, não for nem o que a 20261189 deixou
-- (`3632b8b804ecf913bd849879212ff1ba`) nem o que ESTA migration deixa
-- (`18ea2e76d075634b57189592fb91ac0d`). Os dois hashes são o md5 REAL dos corpos, amarrados ao
-- texto dos arquivos por tests/migration_ja_estornei_so_em_pedido_pago_test.ts.
-- O DO block roda na MESMA transação do restante: recusa = nada gravado.
--
-- TRANSAÇÃO: sem `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da
-- casa, AGENTS.md: com eles o `ROLLBACK` da prova do workflow vira no-op; a
-- Fase 0 de scripts/db-prove-rollback.cjs recusa o arquivo). O workflow
-- `aplicar-migrations.yml` manda o arquivo inteiro numa consulta só (prova
-- `BEGIN; <arquivo>; ROLLBACK;` e depois o apply) — o preflight e o CREATE
-- caem juntos ou não caem.
--
-- ORDEM DE APLICAÇÃO: depois da 20261189000000. Nenhuma edge nem tela muda:
-- o contrato da RPC é o mesmo, com uma recusa 22023 a mais.
--
-- COMO APLICAR: pelo workflow `aplicar-migrations.yml` (Actions -> Run
-- workflow), `migracoes = 20261194000000_ja_estornei_so_em_pedido_pago.sql`.
--
-- FICHA DE VERIFICAÇÃO:
--   1. `SELECT pg_get_functiondef('public.registrar_estorno_manual(uuid)'::regprocedure)`
--      contém 'Este pedido não tem pagamento confirmado' e ainda contém
--      `FOR UPDATE OF releitura` e 'A loja registrou a devolução feita fora do app'.
--   2. Pedido `aguardando` cancelado: "Já estornei" -> erro "Este pedido não
--      tem pagamento confirmado ...", pedido continua `aguardando`.
--   3. Pedido `pago`, `pago_apos_expirar` ou `recebido_na_entrega` cancelado:
--      "Já estornei" -> ok, `estornado`.
--   4. `proacl` igual antes e depois.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261194000000_ja_estornei_so_em_pedido_pago.sql
-- restaura, byte a byte, o corpo que a 20261189000000 deixou.

DO $preflight_20261194$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.registrar_estorno_manual(uuid)');

  IF v_hash IS NULL OR v_hash NOT IN (
    '3632b8b804ecf913bd849879212ff1ba', -- corpo que a 20261189 deixou (vigente até aqui)
    '18ea2e76d075634b57189592fb91ac0d'  -- corpo que ESTA migration deixa — reaplicação idempotente
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de registrar_estorno_manual (hash %) não é o que a 20261189000000 deixou nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_20261194$;

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
        -- Dinheiro que não entrou não se devolve (20261194). Pedido
        -- `aguardando` (PIX aberto, cartão em análise) marcado como estornado
        -- faz o pagamento que chega DEPOIS cair em 'ignorado' no
        -- confirmar_pagamento e sumir sem alerta. `recebido_na_entrega` passa:
        -- é a devolução do dinheiro em espécie (balcão e entrega). NOT EXISTS
        -- sobre a linha (já travada acima) para payment_status NULL também
        -- recusar. Antes da releitura do ledger e de qualquer escrita.
        IF NOT EXISTS (
            SELECT 1
              FROM public.marketplace_orders pedido
             WHERE pedido.id = p_order_id
               AND pedido.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
        ) THEN
            RAISE EXCEPTION 'Este pedido não tem pagamento confirmado: não há dinheiro a devolver. Registrar o estorno agora esconderia um pagamento que ainda pode chegar.'
                USING ERRCODE = '22023';
        END IF;

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

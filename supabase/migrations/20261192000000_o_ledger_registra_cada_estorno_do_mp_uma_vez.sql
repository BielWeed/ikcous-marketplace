-- O LEDGER REGISTRA CADA ESTORNO DO MERCADO PAGO UMA VEZ SÓ (dinheiro: ledger
-- de estorno; Lote A, 04/10/2026) — índice único PARCIAL em `order_refunds`,
-- para duas entregas simultâneas do MESMO estorno não virarem duas linhas.
--
-- O DEFEITO (R2, lido no código e reproduzido no dublê com a corrida do
-- `webhook-mercadopago/index_test.ts`, "Lote A R2 - controle"): o webhook lê
-- o ledger do pedido e, para um estorno feito FORA do app (painel do MP) que
-- nenhuma linha tem, faz INSERT de uma linha `sistema` já concluída. Duas
-- notificações do MP chegando juntas (a mesma atualização + o reenvio) leem
-- o ledger VAZIO e inserem duas linhas com UUIDs diferentes: um estorno de
-- R$ 20 num pedido de R$ 100 somava R$ 40 em `valor_estornado`. Hoje
-- `order_refunds` só tem índices NÃO únicos (2026110000000:117-121), então
-- nada no banco recusa a segunda.
--
-- O QUE MUDA:
--   1. `uq_order_refunds_pedido_refund_mp`: UNIQUE (order_id, mp_refund_id)
--      WHERE mp_refund_id IS NOT NULL. Um refund do MP credita UMA linha do
--      pedido — a invariante P0 que o código já seguia por leitura (laudo do
--      PR #440), agora garantida pelo banco. Parcial de propósito: as linhas
--      do app nascem SEM id (`solicitado`) e o recebem só quando o MP
--      responde — várias linhas sem id por pedido continuam valendo.
--   O código que acompanha (mesmo PR): o webhook trata o 23505 do INSERT como
--   "já registrado" e conclui a linha existente se a outra entrega caiu entre
--   o INSERT e a RPC (`recuperarLinhaJaRegistrada`); e a leitura da resposta
--   do POST de estorno (`_shared/estorno.ts`, `refundDaLinhaNaResposta`)
--   passa a excluir os ids que OUTRAS linhas já têm — sem isso, dois parciais
--   de mesmo valor davam o MESMO id às duas linhas e o `concluir_estorno` da
--   segunda estouraria 23505 (o COALESCE grava o id) em vez de concluir.
--
-- DADOS EXISTENTES: nada é lido para reescrever, nada é apagado, nada é
-- fundido. Se o ledger JÁ tiver um par (pedido, mp_refund_id) em mais de uma
-- linha — o próprio defeito acima, se ele aconteceu em produção —, o índice
-- não pode nascer, e o preflight RECUSA a migration inteira com a contagem
-- (LEDGER_DUPLICADO). Resolver essas linhas é decisão do dono (apagar ou
-- fundir linha de dinheiro), nunca efeito colateral desta migration.
--
-- IDEMPOTÊNCIA: `CREATE UNIQUE INDEX IF NOT EXISTS` só depois de o preflight
-- provar que um índice com este nome, se existir, tem EXATAMENTE a definição
-- desta migration (não se confia em IF NOT EXISTS). Reaplicar não muda nada.
--
-- TRAVA: o CREATE INDEX (sem CONCURRENTLY — CONCURRENTLY não roda dentro de
-- transação, e a aplicação é UMA transação) segura a tabela contra escrita
-- enquanto o índice nasce. `order_refunds` é pequena (uma linha por pedido de
-- devolução); a janela é de milissegundos.
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT / LEDGER_DUPLICADO — o
-- `DO $preflight_20261192$` abaixo é o PRIMEIRO comando e roda na MESMA
-- transação do restante (recusa = nada gravado).
--
-- ORDEM DE PUBLICAÇÃO: esta migration ANTES das edges `webhook-mercadopago`,
-- `estornar-pagamento` e `reconciliar-pagamentos` novas. Edge antiga com o
-- índice no ar: a corrida rara que antes duplicava passa a responder 500 na
-- segunda entrega (o MP reenvia; a reentrega lê a linha e não insere) — nada
-- se perde. Edge nova sem o índice: igual a hoje.
--
-- COMO APLICAR: pelo workflow `aplicar-migrations.yml`, `migracoes =
-- 20261192000000_o_ledger_registra_cada_estorno_do_mp_uma_vez.sql` (prova
-- `BEGIN; <arquivo>; ROLLBACK;` antes do apply; o apply é um único comando
-- multi-instrução, uma transação implícita). Sem `BEGIN`/`COMMIT` de nível
-- superior neste arquivo (regra da casa: com eles o ROLLBACK da prova vira
-- no-op).
--
-- FICHA DE VERIFICAÇÃO:
--   1. `pg_get_indexdef('public.uq_order_refunds_pedido_refund_mp'::regclass)`
--      igual à definição esperada no preflight.
--   2. Numa transação descartável: dois INSERT `sistema` com o mesmo
--      (order_id, mp_refund_id) -> o segundo falha com 23505; dois com
--      mp_refund_id NULL -> os dois entram; `ROLLBACK`.
-- Prova viva no CI: tests/banco/invariantes-dinheiro.cjs, prova (f).
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261192000000_o_ledger_registra_cada_estorno_do_mp_uma_vez.sql
-- (apaga só o índice; nenhuma linha do ledger é tocada).

DO $preflight_20261192$
DECLARE
  v_def text;
  v_duplicatas integer;
BEGIN
  IF to_regclass('public.uq_order_refunds_pedido_refund_mp') IS NOT NULL THEN
    SELECT pg_get_indexdef(to_regclass('public.uq_order_refunds_pedido_refund_mp'))
      INTO v_def;
    IF v_def IS DISTINCT FROM 'CREATE UNIQUE INDEX uq_order_refunds_pedido_refund_mp ON public.order_refunds USING btree (order_id, mp_refund_id) WHERE (mp_refund_id IS NOT NULL)' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.uq_order_refunds_pedido_refund_mp já existe com outra definição (%) — revise antes de aplicar.', v_def;
    END IF;
  END IF;

  SELECT count(*)::integer INTO v_duplicatas
    FROM (
      SELECT 1
        FROM public.order_refunds
       WHERE mp_refund_id IS NOT NULL
       GROUP BY order_id, mp_refund_id
      HAVING count(*) > 1
    ) repetidos;

  IF v_duplicatas > 0 THEN
    RAISE EXCEPTION 'LEDGER_DUPLICADO: % par(es) (pedido, mp_refund_id) aparecem em mais de uma linha de public.order_refunds — o índice único não pode nascer e NADA foi alterado. Liste com: SELECT order_id, mp_refund_id, count(*) FROM public.order_refunds WHERE mp_refund_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1; resolver essas linhas é decisão do dono.', v_duplicatas;
  END IF;
END $preflight_20261192$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_refunds_pedido_refund_mp
  ON public.order_refunds (order_id, mp_refund_id)
  WHERE mp_refund_id IS NOT NULL;

COMMENT ON INDEX public.uq_order_refunds_pedido_refund_mp IS
  'Um refund do Mercado Pago credita UMA linha do pedido (20261192000000): '
  'duas entregas simultâneas do mesmo estorno feito fora do app não viram duas '
  'linhas. Parcial: linhas do app sem id ainda (solicitado) não entram.';

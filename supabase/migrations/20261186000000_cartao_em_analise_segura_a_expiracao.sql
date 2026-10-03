-- O CARTÃO EM ANÁLISE SEGURA A EXPIRAÇÃO (dinheiro; 02/10/2026) — a varredura
-- que cancela pedido não pago passa a PULAR o pedido cuja cobrança de cartão
-- ainda pode ser aprovada pelo banco. Redefine `public.expirar_pedidos_vencidos`
-- (corpo vigente vindo de `20260901000000_devolver_uso_de_cupom_ao_desfazer_
-- pedido.sql`, copiado VERBATIM) e acrescenta UM predicado ao SELECT.
--
-- O DEFEITO MEDIDO: a varredura (pg_cron, a cada 5 minutos) pega todo pedido
-- `payment_status = 'aguardando' AND status = 'pending'` com `expires_at`
-- vencido, devolve o estoque e grava `expirado`/`cancelled` — sem olhar o
-- cartão. Só que um cartão em análise antifraude (`processing`, sem 3DS) NÃO
-- estende `expires_at`: passou dos 30 minutos, o pedido é cancelado e a
-- mercadoria volta para a prateleira. Se o banco aprovar depois, o dinheiro
-- entra sem pedido: o webhook grava `pago_apos_expirar`, o admin recebe push e
-- o estorno é manual (e a mercadoria já pode ter sido vendida a outro).
--
-- A REGRA: cartão possivelmente vivo :=
--     gateway_payment_id LIKE 'verificando:%'                  (sentinela)
--  OU (gateway_payment_id IS NOT NULL
--      AND metodo_online IN ('credito','debito'))              (vaga de cartão)
-- ENQUANTO `expires_at > now() - interval '24 hours'` o pedido NÃO expira.
-- Em palavras: expira se (vencido) E (não é cartão vivo OU venceu há 24 h ou
-- mais). Fatos do código que sustentam isto:
--   - O sentinela `verificando:` só é gravado no fluxo do CARTÃO
--     (`criar-pagamento/index.ts`, `ocuparVagaComSentinela`); pode vir com
--     `metodo_online` NULL, ou trocando um PIX que estava aberto.
--   - A vaga do cartão grava o id da order + `metodo_online` IN
--     ('credito','debito') na mesma transação. Recusa/cancelamento da order
--     chama `liberar_cobranca_do_pedido` (20261176000000), que zera
--     `gateway_payment_id`, `metodo_online` e `parcelas` — daí o pedido deixa
--     de ser "cartão vivo" e expira NA PRÓXIMA varredura, como sempre.
--   - PIX grava `metodo_online = 'pix'` (a coluna tem CHECK NULL/pix/credito/
--     debito) e NUNCA entra na exceção.
--
-- O TETO DE 24 h é a MESMA janela de `pagamentos_a_reconciliar()`
-- (20261010000000: `expires_at > now() - interval '24 hours'`), que varre a
-- cada 10 minutos os pedidos com `gateway_payment_id`, inclusive os vivos
-- (aguardando/pending). Dentro da janela quem decide é a reconciliação:
-- aprovado -> `confirmar_pagamento('pago')` (que NÃO olha `expires_at`: um
-- pedido ainda aguardando/pending vira `pago`, não `pago_apos_expirar`);
-- recusado -> libera a vaga e a varredura expira o pedido. Fora da janela
-- ninguém mais está olhando, então o pedido expira como hoje e o pagamento
-- tardio segue a política de sempre (`pago_apos_expirar`, honrar). É também o
-- teto de retenção de estoque: nenhum pedido segura prateleira além disso.
--
-- O QUE NÃO MUDA:
--   - PIX vencido expira como hoje, inclusive a venda PIX do balcão
--     (20261184000000), que depende da expiração para devolver a reserva.
--   - Pedido sem vaga (NULL/NULL), vaga liberada após recusa, id de gateway
--     sem `metodo_online` (pedido anterior à 20261176000000): expiram como hoje.
--   - O laço (`FOR UPDATE SKIP LOCKED`), `devolver_estoque`, o UPDATE, o
--     retorno (quantos pedidos expirou), a assinatura, `SECURITY DEFINER` e
--     `SET search_path TO 'public'`. A corrida entre a varredura e o
--     `criar-pagamento` (que grava a vaga) é a de sempre: o predicado é
--     reavaliado na versão da linha que a varredura trava.
--   - GRANT/REVOKE: `CREATE OR REPLACE` preserva a ACL vigente, e nenhuma
--     redefinição anterior desta função repete GRANT/REVOKE.
--   - NULL em `metodo_online`: o predicado embrulha o teste inteiro em
--     `COALESCE(..., false)`. Sem isso `NOT (NULL)` seria NULL e o pedido
--     sem método sumiria da varredura para sempre.
--
-- CUSTO CONHECIDO (aceito): um pedido de cartão em análise segura o estoque
-- por até 24 h em vez de 30 min. O sentinela cuja order morreu e cujo cliente
-- não volta a mexer no pedido também fica até o teto — `reconciliar-pagamentos`
-- só adota a order CAPTURADA e deixa a viva/morta/inconclusiva como está.
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita ao aplicar — troca só o
-- corpo da função. Efeito nas próximas varreduras: pedido de cartão vencido que
-- a varredura ainda não pegou deixa de ser pego (até o teto). O que já expirou
-- fica como está.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE FUNCTION` — reaplicar produz o mesmo corpo.
-- O preflight abaixo aceita tanto o corpo da 20260901 quanto o desta migration.
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT (mesmo padrão da 20261180000000): o
-- predicado lê `metodo_online`, coluna nascida na 20261176000000 — e
-- `CREATE OR REPLACE FUNCTION` em plpgsql NÃO valida identificador na criação:
-- sem a coluna a função nasceria quebrada e só falharia na PRIMEIRA varredura,
-- parando de expirar pedido nenhum. Por isso o `DO $preflight_20261186$`
-- logo abaixo, ANTES do `CREATE`, recusa com `B1_BASELINE_DIVERGENT` se: (a) a
-- coluna não existir; ou (b) o corpo VIVO de `expirar_pedidos_vencidos` não
-- bater, por `md5(replace(prosrc, E'\r', ''))` (CRLF normalizado), nem com o
-- que a 20260901 deixou (`9419699d1f1879e19c1514211afa4464`) nem com o que ESTA migration
-- deixa (`4e6b4c105ee2eaaecd9c2e19a5c535af`). Os dois hashes são o md5 REAL dos corpos e estão
-- amarrados ao texto dos arquivos por tests/migration_cartao_em_analise_segura_
-- a_expiracao_test.ts. O DO block roda na MESMA transação do restante: recusa
-- = nada gravado.
--
-- ORDEM DE APLICAÇÃO: depois da 20261176000000 (precisa de `metodo_online`);
-- independente da 20261184000000 e da 20261185000000 (a 84 só depende da
-- expiração de PIX, que não muda) e da 20261180000000.
--
-- COMO APLICAR: pelo workflow `aplicar-migrations.yml` (Actions -> Run
-- workflow), `migracoes = 20261186000000_cartao_em_analise_segura_a_expiracao.sql`
-- — que roda a prova `BEGIN; <arquivo>; ROLLBACK;` antes do apply de verdade.
-- Sem `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO:
--   1. `SELECT pg_get_functiondef('public.expirar_pedidos_vencidos()'::regprocedure)`
--      contém `verificando:` e `interval '24 hours'` depois de aplicar.
--   2. Pedido 'pending'/'aguardando', `expires_at` vencido há 31 min,
--      `metodo_online = 'credito'` e `gateway_payment_id` preenchido:
--      `SELECT public.expirar_pedidos_vencidos()` NÃO o toca.
--   3. Mesmo pedido com `expires_at` vencido há 25 h: expira e devolve o estoque.
--   4. PIX vencido (`metodo_online = 'pix'`): expira como hoje.
--   5. Aplicar num banco sem a 20261176000000: `B1_BASELINE_DIVERGENT`.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261186000000_cartao_em_analise_segura_a_expiracao.sql
-- restaura, byte a byte, o corpo que a 20260901000000 deixou.

DO $preflight_20261186$
DECLARE
  v_hash text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'marketplace_orders'
       AND column_name = 'metodo_online'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marketplace_orders.metodo_online não existe — aplique antes a 20261176000000_o_cartao_online_nasce.sql.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.expirar_pedidos_vencidos()');

  IF v_hash IS NULL OR v_hash NOT IN (
    '9419699d1f1879e19c1514211afa4464', -- corpo que a 20260901 deixou (vigente até aqui)
    '4e6b4c105ee2eaaecd9c2e19a5c535af'  -- corpo que ESTA migration deixa — reaplicação idempotente
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de expirar_pedidos_vencidos (hash %) não é o que a 20260901000000 deixou nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_20261186$;

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
          -- Cartao possivelmente vivo NAO expira enquanto a reconciliacao ainda
          -- o enxerga (mesma janela de 24 h de pagamentos_a_reconciliar,
          -- 20261010000000): um cartao em analise antifraude nao estende
          -- expires_at, e cancelar aqui devolveria o estoque de um pedido que o
          -- banco ainda pode aprovar. O COALESCE embrulha o teste inteiro: com
          -- metodo_online NULL, NOT (NULL) seria NULL e a linha sumiria da
          -- varredura. PIX, sem vaga e vaga liberada nunca sao "cartao vivo".
          AND (
                expires_at <= now() - interval '24 hours'
                OR NOT COALESCE(
                     gateway_payment_id LIKE 'verificando:%'
                     OR (
                          gateway_payment_id IS NOT NULL
                          AND metodo_online IN ('credito', 'debito')
                        ),
                     false
                   )
              )
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

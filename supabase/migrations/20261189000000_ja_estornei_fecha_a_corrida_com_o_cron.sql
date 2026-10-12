-- "JÁ ESTORNEI" FECHA A CORRIDA COM O CRON (dinheiro; 02/10/2026) — redefine
-- `public.registrar_estorno_manual` (corpo vigente vindo de
-- `20261176000000_o_cartao_online_nasce.sql`) para olhar e TRAVAR as linhas
-- vivas do ledger `order_refunds` do pedido antes de registrar a devolução
-- feita fora do app.
--
-- O DEFEITO MEDIDO (PGlite, cron REAL, 02/10/2026): o admin cancela um pedido
-- pago -> `update_order_status_atomic` cria a linha `solicitado` -> o cron
-- `reconciliar-pagamentos` lê o pedido (`payment_status = 'pago'`,
-- index.ts ~1043) -> o admin clica "Já estornei" e esta RPC grava
-- `estornado` sem tocar na linha -> o cron marca a linha (UPDATE condicional
-- `WHERE status = 'solicitado'`, index.ts ~1099-1108), que ainda casa ->
-- o executor decide com a leitura VELHA (`pago`) e POSTA o estorno no Mercado
-- Pago. Se a loja já tinha devolvido por fora (PIX do banco, dinheiro), o
-- cliente recebe DUAS vezes. A mesma corrida vale para a edge do clique
-- `estornar-pagamento` (lê o pedido, depois marca `IN ('solicitado',
-- 'em_processamento')`).
--
-- A REGRA (revisor financeiro, mudança obrigatória 3), numa transação só:
--   1. Trava as linhas `solicitado`/`em_processamento` do pedido e o pedido.
--   2. Linha `solicitado` (ninguém pediu ao MP ainda) -> `recusado`, com
--      `ultimo_erro` = 'A loja registrou a devolução feita fora do app', e o
--      registro manual SEGUE. Nunca recusar aqui: recusar deixaria o cron
--      devolver pelo MP em cima da devolução feita por fora.
--      Por que fecha a corrida: as duas marcas (cron e edge) são UPDATE
--      condicionais por status; com a linha em `recusado` elas voltam 0
--      linhas e NÃO chamam o MP. Se a marca chegar enquanto esta transação
--      segura a trava, o Postgres (READ COMMITTED) espera e reavalia o WHERE
--      na versão nova da linha -> 0 linhas.
--   3. Linha `em_processamento` (o POST já saiu, inclusive no regime "só
--      consulta" de 5+ tentativas) -> RECUSA o registro manual, nada gravado,
--      com a mensagem: o Mercado Pago já está devolvendo; se não aparecer no
--      painel do MP, devolver PELO PAINEL do MP, nunca por outro caminho.
--      Linha `em_processamento` do SISTEMA (`solicitado_por = 'sistema'`:
--      contestação/disputa em análise no MP) também recusa, mas com mensagem
--      própria (o app NÃO pediu devolução nenhuma): há uma disputa ou
--      devolução do MP em andamento; acompanhar pelo painel do MP, não
--      devolver por outro meio. Mesmo SQLSTATE (22023). Se houver as duas,
--      vale a do app.
--   4. `falhou`/`recusado`/`concluido`: a regra de saldo de hoje, intocada.
--   Pedido JÁ `estornado`: ok idempotente, nada muda (contrato de hoje).
--
-- ORDEM DAS TRAVAS (deadlock): `concluir_estorno` (2026110000100) trava
-- linha -> pedido (UPDATE order_refunds, depois UPDATE marketplace_orders).
-- Esta RPC segue a MESMA ordem: (1) trava as linhas vivas do ledger,
-- (2) trava o pedido, (3) RELÊ e trava as linhas vivas de novo, já com o
-- pedido travado. Quem cria linha nova (`update_order_status_atomic`,
-- `solicitar_estorno`, devolução) faz isso segurando a trava do pedido; a
-- linha que nasce enquanto esta RPC espera o pedido NÃO está na pré-trava.
-- A RELEITURA EXISTE PARA TRAVAR ESSA LINHA: sem a trava, a marca do cron ou
-- da edge pode cair ENTRE a checagem de `em_processamento` e o UPDATE para
-- `recusado`, levar a linha a `em_processamento` (1 linha -> POST) enquanto
-- esta RPC grava `estornado` — devolução em dobro (cenário iv da revisão
-- Opus, provado em Postgres 17 real com duas sessões, 02/10/2026). NÃO a
-- remova achando que o UPDATE final cobre: o UPDATE (snapshot novo) até
-- enxerga a linha, mas só a trava ANTES da checagem impede a marca de entrar
-- no meio. A releitura só encontra linha NOVA, que ninguém está concluindo.
-- `admin_devolucao_reemitir_reembolso` trava pedido -> linha
-- (`v_d.refund_id` FOR UPDATE, 20261175:1310, ANTES de conferir o status):
-- um cruzamento 40P01 (deadlock) com esta RPC só é possível se a reemissão
-- apontar para uma linha VIVA — e ela recusa linha que não seja `recusado`.
-- Se o Postgres detectar um deadlock, ele aborta a transação INTEIRA de um
-- dos lados, sem escrita pela metade, e quem perdeu tenta de novo.
--
-- O QUE NÃO MUDA: assinatura `(p_order_id uuid) RETURNS json`, `SECURITY
-- DEFINER`, `SET search_path = public`, a porta `is_admin()` (42501), o
-- 'pedido nao encontrado' (P0002), a recusa de saldo (22023, mesma
-- mensagem), o carimbo `estorno_manual_registrado_em` só na primeira vez e o
-- retorno `{ok: true, payment_status: 'estornado'}`. GRANT/REVOKE: `CREATE OR
-- REPLACE` preserva a ACL vigente (nascida na 20261072000000; a 20261176000000
-- também não a repete). Nenhum COMMENT ON FUNCTION existe nem é criado.
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita ao aplicar — troca só o
-- corpo da função. Efeito daqui para a frente, só quando a loja clicar
-- "Já estornei": linha `solicitado` do pedido vira `recusado`; com linha
-- `em_processamento` o clique é recusado. Pedido que já estava `estornado`
-- com uma linha `solicitado` esquecida (corrida de antes desta migration)
-- não é mexido: a guarda do executor já a leva a `recusado` sem POST.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE FUNCTION` — reaplicar produz o mesmo corpo.
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT: `CREATE OR REPLACE FUNCTION` em plpgsql
-- NÃO valida identificador na criação. O `DO $preflight_20261189$` abaixo,
-- ANTES do `CREATE`, recusa se: (a) `public.order_refunds` não tiver
-- `order_id`, `status`, `ultimo_erro` e `updated_at` (o corpo novo escreve
-- nelas); ou (b) o corpo VIVO de `registrar_estorno_manual`, por
-- `md5(replace(prosrc, E'\r', ''))`, não for nem o que a 20261176 deixou
-- (`ed824820fbe1ea1503c9afe58a9edcbb`) nem o que ESTA migration deixa
-- (`3632b8b804ecf913bd849879212ff1ba`). Os dois hashes são o md5 REAL dos corpos, amarrados ao
-- texto dos arquivos por
-- tests/migration_ja_estornei_fecha_a_corrida_com_o_cron_test.ts. O DO block
-- roda na MESMA transação do restante: recusa = nada gravado.
--
-- ORDEM DE APLICAÇÃO: depois da 20261176000000 (corpo de partida e coluna
-- `estorno_manual_registrado_em`) e da 2026110000000 (ledger). Independente
-- da 20261186000000. Nenhuma edge muda: o contrato da RPC é o mesmo, e as
-- marcas condicionais do cron e da edge já existem.
--
-- COMO APLICAR: pelo workflow `aplicar-migrations.yml` (Actions -> Run
-- workflow), `migracoes = 20261189000000_ja_estornei_fecha_a_corrida_com_o_cron.sql`
-- — que roda a prova `BEGIN; <arquivo>; ROLLBACK;` antes do apply de verdade.
-- Sem `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO:
--   1. `SELECT pg_get_functiondef('public.registrar_estorno_manual(uuid)'::regprocedure)`
--      contém `FOR UPDATE OF viva`, `FOR UPDATE OF o`, `FOR UPDATE OF releitura`
--      e 'A loja registrou a devolução feita fora do app'.
--   2. Pedido pago cancelado com linha `solicitado`: "Já estornei" -> ok, a
--      linha vira `recusado`, o próximo ciclo do cron não posta nada.
--   3. Com linha `em_processamento`: "Já estornei" -> erro "O Mercado Pago já
--      está devolvendo ...", pedido continua `pago`.
--   4. `proacl` igual antes e depois.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261189000000_ja_estornei_fecha_a_corrida_com_o_cron.sql
-- restaura, byte a byte, o corpo que a 20261176000000 deixou.

DO $preflight_20261189$
DECLARE
  v_hash text;
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'order_refunds'
       AND column_name IN ('order_id', 'status', 'ultimo_erro', 'updated_at')
  ) <> 4 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds sem order_id/status/ultimo_erro/updated_at — aplique antes a 2026110000000_o_estorno_nasce_no_ledger.sql.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.registrar_estorno_manual(uuid)');

  IF v_hash IS NULL OR v_hash NOT IN (
    'ed824820fbe1ea1503c9afe58a9edcbb', -- corpo que a 20261176 deixou (vigente até aqui)
    '3632b8b804ecf913bd849879212ff1ba'  -- corpo que ESTA migration deixa — reaplicação idempotente
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de registrar_estorno_manual (hash %) não é o que a 20261176000000 deixou nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_20261189$;

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

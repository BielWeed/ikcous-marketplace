-- A RECONCILIAÇÃO ALCANÇA O CARTÃO TARDIO (dinheiro; 02/10/2026) — a fila do
-- cron `reconciliar-pagamentos` (`public.pagamentos_a_reconciliar`, corpo
-- vigente vindo de `20261010000000_reconciliacao_alcanca_o_pedido_vivo.sql`)
-- ganha uma janela maior SÓ para o cartão possivelmente vivo, um rodízio que
-- impede o LIMIT 100 de matar candidato de fome, e uma marca que tira da fila
-- a cobrança já TERMINAL no Mercado Pago.
--
-- OS DEFEITOS MEDIDOS (PGlite, SQL real + cron REAL, 02/10/2026):
--   D2 — cartão em análise manual no MP aprovado MAIS de 24 h depois de
--        `expires_at`, com a notificação perdida: a fila corta em
--        `expires_at > now() - interval '24 hours'` (20261010) e o candidato
--        some. Dinheiro capturado, nada gravado, nenhum alerta. Vale para o
--        pedido expirado pelo cron, cancelado pelo admin com a order gravada e
--        cancelado com o sentinela `verificando:`.
--   D3 — `ORDER BY expires_at DESC LIMIT 100`: com 100 candidatos mais novos
--        (PIX abandonados ficam 24 h na fila), o mais velho — justamente o
--        cartão tardio — nunca é visitado, ciclo após ciclo.
--
-- O QUE MUDA (revisor financeiro, mudanças obrigatórias 1 e 2):
--   1. Janela: 24 h para todo mundo, como hoje, MAIS 14 dias quando a vaga é
--      de cartão possivelmente vivo — `gateway_payment_id LIKE 'verificando:%'`
--      (sentinela) OU `metodo_online IN ('credito', 'debito')`, o MESMO
--      predicado de cartão da 20261186000000, com `COALESCE(..., false)` para
--      `metodo_online` NULL. PIX fica em 24 h (passado o prazo o PIX não é mais
--      pagável). N = 14 dias foi decidido pelo revisor financeiro.
--   2. Rodízio: `public.reconciliacao_visitas` guarda quando cada pedido foi
--      visitado; a fila serve primeiro o pedido VIVO (`status = 'pending'`, o
--      único que ainda dá para salvar inteiro), depois quem nunca foi visitado
--      ou foi visitado há mais tempo, e só então `expires_at DESC`. O teto de
--      100 consultas por ciclo continua o mesmo.
--   3. Cobrança terminal: quando a consulta POR ID devolve a order `failed`,
--      `canceled`/`cancelled` ou `expired` (sem dinheiro capturável — ver
--      `mapearStatusOrder`, _shared/mercadopago.ts), o cron grava o ID DAQUELA
--      cobrança em `cobranca_terminal`, e a fila pula o pedido enquanto a vaga
--      tiver ESSE MESMO id. Cobrança NOVA na vaga (o cliente tentou de novo)
--      volta à fila na hora — a marca é da cobrança, nunca do pedido. Sem isto
--      a janela de 14 dias faria o cron perguntar ao MP de 10 em 10 minutos,
--      por duas semanas, sobre um cartão já recusado cuja vaga não pode ser
--      solta (pedido já expirado: `liberar_cobranca_do_pedido` só solta vaga
--      de pedido 'aguardando').
--   4. `marcar_visitas_da_reconciliacao(p_visitados, p_terminais,
--      p_cobrancas_terminais)`: o carimbo, chamado pelo cron UMA vez no fim do
--      laço de pagamentos. Ordena os ids antes do upsert — dois ciclos
--      sobrepostos do pg_cron travam as linhas na MESMA ordem, sem deadlock.
--      Ignora id que não existe mais (pedido apagado no meio do ciclo).
--   5. `COMMENT ON FUNCTION liberar_cobranca_do_pedido` ganha a invariante da
--      vaga (o texto anterior é mantido inteiro, a frase vem no fim). Só o
--      comentário muda: corpo, ACL e dono da função ficam como estão.
--
-- O QUE NÃO MUDA: a forma do retorno da fila `(order_id uuid,
-- gateway_payment_id text)` — o cron antigo funciona com a fila nova —, os
-- três ramos de status (expirado; aguardando+cancelled; aguardando+pending),
-- `gateway_payment_id IS NOT NULL`, `paid_at IS NULL`, `LIMIT 100`,
-- `SECURITY DEFINER`, `SET search_path TO 'public'` e a ACL da fila
-- (`CREATE OR REPLACE` preserva a ACL vigente, e a 20261010 já fez o REVOKE).
-- Quem decide o pagamento continua sendo só `confirmar_pagamento`.
--
-- OBJETOS NOVOS E ACL:
--   - `public.reconciliacao_visitas`: tabela separada (não coluna em
--     `marketplace_orders`), para nenhum gatilho de UPDATE do pedido disparar
--     a cada carimbo. Só metadado de visita — nenhum dado de dinheiro ou de
--     cliente. RLS ligada e nenhuma policy; REVOKE de PUBLIC/anon/
--     authenticated (tabela NOVA: não há grant de coluna para perder). Quem
--     lê e escreve são as duas funções SECURITY DEFINER.
--   - `public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[])`:
--     SECURITY DEFINER, search_path fixo, EXECUTE só para service_role (mesma
--     régua de `liberar_cobranca_do_pedido`).
--
-- DADOS EXISTENTES: nenhuma linha de pedido é lida ou reescrita ao aplicar. A
-- tabela nasce vazia. Efeito nos próximos ciclos: pedidos de cartão
-- cancelados/expirados nos últimos 14 dias com `paid_at` NULL e vaga
-- preenchida voltam a ser candidatos; o que tiver sido aprovado com a
-- notificação perdida é confirmado como `pago_apos_expirar` (o cliente recebe
-- o aviso de atraso e, com a edge nova, o admin recebe o push). Pico possível:
-- 100 consultas ao MP por ciclo, o mesmo teto de hoje.
--
-- IDEMPOTÊNCIA: `CREATE TABLE IF NOT EXISTS` só depois de o preflight provar
-- que a tabela existente (se existir) tem EXATAMENTE a forma desta migration;
-- `CREATE OR REPLACE FUNCTION` nas duas funções; REVOKE/GRANT/COMMENT são
-- reaplicáveis. Reaplicar não apaga visita nenhuma.
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT — o `DO $preflight_20261190$` abaixo é o
-- PRIMEIRO comando e roda na MESMA transação do restante (recusa = nada
-- gravado). Recusa se:
--   (a) `marketplace_orders.metodo_online` não existir (vem da 20261176);
--   (b) o corpo VIVO de `pagamentos_a_reconciliar`, por
--       `md5(replace(prosrc, E'\r', ''))`, não for o da 20261010
--       (`6b3fd779573e2badc52e02ab84fa931c`) nem o desta migration
--       (`a8aae3c132cac141c27091a4e3648cf4`);
--   (c) `reconciliacao_visitas` existir com forma DIFERENTE (colunas, tipos,
--       NOT NULL, PK em order_id, FK para marketplace_orders ON DELETE
--       CASCADE, nada além disso) — não se confia em IF NOT EXISTS;
--   (d) existir qualquer `marcar_visitas_da_reconciliacao` que não seja a
--       desta migration (outra assinatura, ou o corpo com md5 diferente de
--       `072dca9dd2f0d0a2911b69f72fc8f5c0`);
--   (e) o COMMENT vivo de `liberar_cobranca_do_pedido` não for o da 20261176
--       nem o desta migration.
-- Os hashes são o md5 REAL dos corpos, amarrados ao texto dos arquivos por
-- tests/migration_a_reconciliacao_alcanca_o_cartao_tardio_test.ts.
--
-- ORDEM DE PUBLICAÇÃO: esta migration ANTES da edge `reconciliar-pagamentos`
-- nova. A edge antiga funciona com a fila nova (mesma forma, só não carimba
-- visita — o rodízio fica parado, como hoje). A edge nova sem esta migration
-- só loga o erro do carimbo (não fatal) e continua com a fila antiga.
--
-- COMO APLICAR: pelo workflow `aplicar-migrations.yml`, `migracoes =
-- 20261190000000_a_reconciliacao_alcanca_o_cartao_tardio.sql` (prova
-- `BEGIN; <arquivo>; ROLLBACK;` antes do apply). Sem `BEGIN`/`COMMIT` de nível
-- superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO:
--   1. `pg_get_functiondef('public.pagamentos_a_reconciliar()'::regprocedure)`
--      contém `interval '14 days'` e `v.visitado_em ASC NULLS FIRST`.
--   2. `to_regclass('public.reconciliacao_visitas')` não nulo, RLS ligada.
--   3. `has_function_privilege('authenticated',
--      'public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[])',
--      'EXECUTE')` = false.
--   4. Cartão expirado há 3 dias, `metodo_online = 'credito'`, `paid_at`
--      NULL: aparece em `SELECT * FROM public.pagamentos_a_reconciliar()`.
--      PIX expirado há 25 h: não aparece.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261190000000_a_reconciliacao_alcanca_o_cartao_tardio.sql
-- restaura o corpo da 20261010 byte a byte, apaga a RPC e a tabela de visitas
-- (só metadado) e devolve o COMMENT da 20261176.

DO $preflight_20261190$
DECLARE
  v_hash text;
  v_colunas text;
  v_constraints integer;
  v_pk boolean;
  v_fk boolean;
  v_marcar integer;
  v_comentario text;
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
   WHERE oid = to_regprocedure('public.pagamentos_a_reconciliar()');

  IF v_hash IS NULL OR v_hash NOT IN (
    '6b3fd779573e2badc52e02ab84fa931c', -- corpo que a 20261010 deixou (vigente até aqui)
    'a8aae3c132cac141c27091a4e3648cf4'  -- corpo que ESTA migration deixa — reaplicação idempotente
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de pagamentos_a_reconciliar (hash %) não é o que a 20261010000000 deixou nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  IF to_regclass('public.reconciliacao_visitas') IS NOT NULL THEN
    SELECT string_agg(
             a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
               || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
             ', ' ORDER BY a.attnum)
      INTO v_colunas
      FROM pg_attribute a
     WHERE a.attrelid = 'public.reconciliacao_visitas'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped;

    SELECT count(*) FILTER (WHERE c.contype IN ('p', 'f', 'u', 'c', 'x')),
           COALESCE(bool_or(c.contype = 'p' AND c.conkey = ARRAY[1]::int2[]), false),
           COALESCE(bool_or(c.contype = 'f' AND c.conkey = ARRAY[1]::int2[]
                            AND c.confrelid = 'public.marketplace_orders'::regclass
                            AND c.confdeltype = 'c'), false)
      INTO v_constraints, v_pk, v_fk
      FROM pg_constraint c
     WHERE c.conrelid = 'public.reconciliacao_visitas'::regclass;

    IF v_colunas IS DISTINCT FROM 'order_id uuid NOT NULL, visitado_em timestamp with time zone NOT NULL, cobranca_terminal text'
       OR v_constraints <> 2 OR NOT v_pk OR NOT v_fk THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.reconciliacao_visitas já existe com outra forma (colunas: %; constraints: %) — revise antes de aplicar.', v_colunas, v_constraints;
    END IF;
  END IF;

  SELECT count(*) INTO v_marcar
    FROM pg_proc
   WHERE proname = 'marcar_visitas_da_reconciliacao'
     AND pronamespace = 'public'::regnamespace;

  IF v_marcar > 0 AND (
       v_marcar <> 1
       OR (SELECT md5(replace(prosrc, E'\r', ''))
             FROM pg_proc
            WHERE oid = to_regprocedure('public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[])'))
          IS DISTINCT FROM '072dca9dd2f0d0a2911b69f72fc8f5c0'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marcar_visitas_da_reconciliacao já existe com outra forma — revise antes de aplicar.';
  END IF;

  v_comentario := obj_description(to_regprocedure('public.liberar_cobranca_do_pedido(uuid, text)'), 'pg_proc');
  IF v_comentario IS NULL OR v_comentario NOT IN (
    'Cartão recusado não mata o pedido: solta a vaga da cobrança (se ainda for a '
    'gravada, com o pedido aguardando e sem pagamento) e conta a tentativa. Sem '
    'id, só conta. Só o service role (edges criar-pagamento, webhook e '
    'reconciliação) executa.',
    'Cartão recusado não mata o pedido: solta a vaga da cobrança (se ainda for a '
    'gravada, com o pedido aguardando e sem pagamento) e conta a tentativa. Sem '
    'id, só conta. Só o service role (edges criar-pagamento, webhook e '
    'reconciliação) executa. INVARIANTE: só esta RPC (liberar_cobranca_do_pedido) '
    'esvazia a vaga, e só por prova ou cancelamento confirmado — as adoções do '
    'webhook e da reconciliação TROCAM a vaga (UPDATE condicional pelo valor '
    'antigo), nunca a esvaziam.'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o COMMENT de liberar_cobranca_do_pedido não é o da 20261176000000 nem o desta migration — revise antes de aplicar.';
  END IF;
END $preflight_20261190$;

CREATE TABLE IF NOT EXISTS public.reconciliacao_visitas (
    order_id uuid PRIMARY KEY REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
    visitado_em timestamptz NOT NULL,
    cobranca_terminal text
);

ALTER TABLE public.reconciliacao_visitas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reconciliacao_visitas FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.reconciliacao_visitas IS
  'Rodízio da fila de reconciliação (20261190000000): quando o cron visitou '
  'cada pedido candidato, e o id da cobrança que o Mercado Pago já deu como '
  'terminal (failed/canceled/expired) — a fila pula o pedido enquanto a vaga '
  'tiver ESSE id. Só metadado; escrita só por marcar_visitas_da_reconciliacao.';

CREATE OR REPLACE FUNCTION public.marcar_visitas_da_reconciliacao(
    p_visitados uuid[],
    p_terminais uuid[] DEFAULT '{}',
    p_cobrancas_terminais text[] DEFAULT '{}'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $marcar$
DECLARE
    v_visitas integer;
BEGIN
    IF COALESCE(cardinality(p_terminais), 0) <> COALESCE(cardinality(p_cobrancas_terminais), 0) THEN
        RAISE EXCEPTION 'marcar_visitas_da_reconciliacao: p_terminais e p_cobrancas_terminais com tamanhos diferentes'
            USING ERRCODE = '22023';
    END IF;

    -- Ordenado por id: dois ciclos sobrepostos travam as linhas na MESMA
    -- ordem (sem deadlock). Pedido que sumiu no meio do ciclo fica de fora
    -- (a FK recusaria).
    INSERT INTO public.reconciliacao_visitas AS rv (order_id, visitado_em)
    SELECT DISTINCT x.id, now()
      FROM unnest(p_visitados) AS x(id)
     WHERE x.id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.marketplace_orders mo WHERE mo.id = x.id)
     ORDER BY x.id
    ON CONFLICT (order_id) DO UPDATE SET visitado_em = EXCLUDED.visitado_em;
    GET DIAGNOSTICS v_visitas = ROW_COUNT;

    INSERT INTO public.reconciliacao_visitas AS rv (order_id, visitado_em, cobranca_terminal)
    SELECT DISTINCT ON (t.id) t.id, now(), t.cobranca
      FROM unnest(p_terminais, p_cobrancas_terminais) AS t(id, cobranca)
     WHERE t.id IS NOT NULL
       AND t.cobranca IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.marketplace_orders mo WHERE mo.id = t.id)
     ORDER BY t.id
    ON CONFLICT (order_id) DO UPDATE
       SET cobranca_terminal = EXCLUDED.cobranca_terminal,
           visitado_em = EXCLUDED.visitado_em;

    RETURN v_visitas;
END;
$marcar$;

REVOKE ALL ON FUNCTION public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[]) TO service_role;

COMMENT ON FUNCTION public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[]) IS
  'Carimbo do cron reconciliar-pagamentos (20261190000000): visitado_em = now() '
  'para cada pedido visitado no ciclo, e cobranca_terminal para a cobrança que '
  'o MP deu como terminal. Só service role. Devolve quantas visitas gravou.';

CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT o.id, o.gateway_payment_id
      FROM public.marketplace_orders o
      LEFT JOIN public.reconciliacao_visitas v ON v.order_id = o.id
     WHERE o.gateway_payment_id IS NOT NULL
       AND o.paid_at IS NULL
       -- 24 h para todo mundo (passado isso o PIX não é mais pagável); 14
       -- dias para o cartão possivelmente vivo — análise manual do MP pode
       -- aprovar dias depois (D2, revisor financeiro: N = 14).
       AND (
             o.expires_at > now() - interval '24 hours'
          OR (
               o.expires_at > now() - interval '14 days'
               AND COALESCE(
                     o.gateway_payment_id LIKE 'verificando:%'
                     OR o.metodo_online IN ('credito', 'debito'),
                     false
                   )
             )
       )
       -- Cobrança que o MP já deu como terminal sai da fila; cobrança NOVA na
       -- vaga (outro id) volta na hora.
       AND (v.cobranca_terminal IS NULL OR v.cobranca_terminal <> o.gateway_payment_id)
       AND (
             -- morto por expiracao (20260808000100)
             o.payment_status = 'expirado'
             -- morto por cancelamento com a cobranca viva (20260812000000)
          OR (o.payment_status = 'aguardando' AND o.status = 'cancelled')
             -- VIVO, e ainda da' para salvar (20261010000000)
          OR (o.payment_status = 'aguardando' AND o.status = 'pending')
       )
     -- Vivo primeiro; depois rodízio (nunca visitado / visitado há mais
     -- tempo); por fim o mais novo (D3: o LIMIT não monopoliza mais a fila).
     ORDER BY (o.status = 'pending') DESC, v.visitado_em ASC NULLS FIRST, o.expires_at DESC
     LIMIT 100;
$candidatos$;

COMMENT ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) IS
  'Cartão recusado não mata o pedido: solta a vaga da cobrança (se ainda for a '
  'gravada, com o pedido aguardando e sem pagamento) e conta a tentativa. Sem '
  'id, só conta. Só o service role (edges criar-pagamento, webhook e '
  'reconciliação) executa. INVARIANTE: só esta RPC (liberar_cobranca_do_pedido) '
  'esvazia a vaga, e só por prova ou cancelamento confirmado — as adoções do '
  'webhook e da reconciliação TROCAM a vaga (UPDATE condicional pelo valor '
  'antigo), nunca a esvaziam.';

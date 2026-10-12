-- ============================================================================
-- Migration 20261209000000 -- a foto da cobranca no cancelamento
-- (cupom; peca 1 de 2 de "o cupom preso depois de cancelar com o PIX gerado
-- volta em minutos, nao em 24 h"; 09/10/2026)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION FAZ (E O QUE NAO FAZ)
--
-- Passa a guardar, no instante em que um pedido vira 'cancelled', uma FOTO do estado da
-- cobranca dele: o id de cobranca gravado na vaga (`gateway_payment_id`), quantas
-- tentativas de pagamento ja tinham sido contadas (`tentativas_de_pagamento`), o metodo
-- online e o `payment_status`. Quem usa a foto e a migration SEGUINTE (20261210000000,
-- que ensina a varredura do cupom a ler a foto). Esta aqui so GRAVA a foto. Nenhum
-- comportamento visivel muda: ninguem le a tabela nova, nenhum corpo de funcao existente
-- e redefinido (create_marketplace_order_v23/v24, cancelar_pedido_com_cobranca,
-- pedido__mudar_status, cupom__vaga_volta_em e a varredura ficam como estao), e a vaga
-- do cupom continua voltando 24 h depois do PIX, como hoje.
--
-- POR QUE UM GATILHO NO BANCO E NAO UMA MUDANCA NA EDGE. O pedido vira 'cancelled' por
-- varios caminhos: o cliente pelo app, o lojista pelo painel, a edge criar-pagamento
-- (cancelar_pedido_com_cobranca), a expiracao do agendador. Um gatilho
-- AFTER UPDATE OF status cobre todos de uma vez, inclusive os que ainda nao existem, e nao
-- exige publicar nenhuma edge function.
--
-- OBJETOS CRIADOS (todos novos; nada existente e alterado):
--   * public.pedido_cobranca_ao_cancelar: uma linha por pedido (order_id e a chave e
--     tem FK para marketplace_orders com ON DELETE CASCADE). Seguranca por linha LIGADA e
--     NENHUMA politica; todo privilegio revogado de PUBLIC, anon, authenticated e
--     service_role (o Supabase concede por padrao a tabela nova a tres deles). So o dono
--     da tabela e as funcoes SECURITY DEFINER dele enxergam;
--   * public.pedido__foto_da_cobranca_ao_cancelar(): a funcao do gatilho. SECURITY
--     DEFINER, search_path = public, SEM EXECUTE para PUBLIC, anon, authenticated nem
--     service_role (o gatilho dispara sem esse privilegio). Faz
--     INSERT ... ON CONFLICT (order_id) DO UPDATE;
--   * tr_pedido_foto_da_cobranca_ao_cancelar em marketplace_orders: AFTER UPDATE OF status,
--     FOR EACH ROW, WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM
--     'cancelled').
--
-- 2. O QUE A FOTO GUARDA E QUANDO ELA MUDA
--
-- A foto e do instante do cancelamento (valores de NEW naquele UPDATE). Recancelar um
-- pedido que JA esta cancelado nao dispara o gatilho (o WHEN) e nao grava foto nova. Se o
-- pedido for reativado (o lojista tira de 'cancelled') e cancelado de novo, a foto e
-- SOBRESCRITA pelo estado do segundo cancelamento (ON CONFLICT DO UPDATE): e o lado seguro,
-- porque quem decide pela foto olha o estado MAIS RECENTE (um cartao tentado no meio, por
-- exemplo, aparece na foto nova e a pista rapida deixa de valer). UPDATE que nao inclui
-- `status` na lista de colunas nao dispara o gatilho. Um pedido que NASCE 'cancelled' (INSERT)
-- nao ganha foto: nenhum caminho real faz isso, e sem foto nada muda (segue valendo o
-- prazo de hoje).
--
-- Se a gravacao da foto falhar, o cancelamento FALHA junto (o gatilho nao engole o erro): uma
-- foto velha mantida em silencio, depois de uma reativacao, seria pior do que um cancelamento
-- que pede para tentar de novo. A tabela e o gatilho nascem e sao conferidos na mesma
-- transacao (pos-voo), entao nao ha estado "gatilho sem tabela".
--
-- 3. DADOS QUE JA EXISTEM
--
-- Nenhuma linha de nenhuma tabela existente e lida nem reescrita. Pedido que JA estava
-- cancelado antes desta migration NAO ganha foto (nao ha como saber o estado dele no
-- instante em que foi cancelado) e nao ganha depois (recancelar nao dispara): segue com o
-- prazo de hoje. Nada e apagado, nada e preenchido (backfill) retroativamente.
--
-- 4. O PRE-VOO (RECUSA, COM O NOME DO QUE DIVERGE, SEM GRAVAR NADA)
--
--   (a) `public.marketplace_orders` existe com as seis colunas que o gatilho le (id uuid,
--       status text, gateway_payment_id text, tentativas_de_pagamento integer,
--       metodo_online text, payment_status text);
--   (b) se `public.pedido_cobranca_ao_cancelar` ja existe (reaplicacao), tem EXATAMENTE a
--       forma desta migration (colunas, tipos, NOT NULL, DEFAULT, chave, FK com CASCADE) e
--       NENHUMA politica; outra tabela com esse nome e de outra pessoa;
--   (c) se ja existe funcao com o nome `pedido__foto_da_cobranca_ao_cancelar`: so a de zero
--       argumentos com o corpo desta migration (hash, LF ou CRLF); outra sobrecarga ou outro
--       corpo e de outra pessoa;
--   (d) se ja existe gatilho com o nome do gatilho: tem de ser o desta migration (mesma
--       funcao, AFTER UPDATE OF status, FOR EACH ROW, mesmo WHEN, ativo).
--
-- 5. ORDEM, TRAVAS E CONCORRENCIA (leia antes de aplicar)
--
-- CREATE TRIGGER e a chave estrangeira pedem `marketplace_orders` em SHARE ROW EXCLUSIVE
-- (barra gravacao de pedido ate o COMMIT; leitura segue). O pre-voo pega essa trava PRIMEIRO,
-- ANTES de qualquer outra coisa, mas SEM FICAR NA FILA: tenta `LOCK ... NOWAIT` e, se a
-- tabela esta ocupada por um pedido em andamento, espera 100 ms e tenta de novo, por no
-- maximo 4 s; passado isso, RECUSA (55P03) sem gravar nada e basta repetir. POR QUE NAO
-- `LOCK` SIMPLES (que espera na fila): enquanto a migration espera, TODO pedido ou
-- cancelamento que chega depois dela espera atras dela (a fila de travas do Postgres), isto e,
-- o checkout inteiro para ate a transacao que segura a tabela terminar (ou ate 5 s). Pior: um
-- pedido pega a linha do cupom e DEPOIS grava em `marketplace_orders`, e outro faz o contrario;
-- com a migration na fila os dois formam um ciclo "mole" que o Postgres so desfaz depois de
-- `deadlock_timeout` (1 s), com o checkout parado esse tempo todo. Quem so TENTA e dorme nunca
-- entra na fila: o checkout segue andando enquanto a migration espera o seu momento. Esperando
-- ela nao segura nada que um pedido queira (so leitura do catalogo), entao nao ha deadlock
-- (40P01) possivel; depois de pegar a trava so cria objetos novos. Medido na prova viva com
-- dois pedidos reais cruzados (o pedido que chega com a migration esperando termina em
-- milissegundos; com `LOCK` simples fica parado) e nenhum 40P01.
-- `SET LOCAL lock_timeout = '5s'` fica como cinto de seguranca para qualquer outra espera.
-- O `SET LOCAL statement_timeout = '30s'` vale ate o fim da transacao (limita tambem os
-- comandos seguintes do envelope do workflow). Aplicar FORA DO HORARIO DE PICO.
--
-- NO ENVELOPE DO WORKFLOW (aplicar-migrations.yml): a transacao e REPEATABLE READ e a
-- impressao digital tira a foto do banco ANTES da trava. Esta migration nao le nem escreve
-- LINHA de nenhuma tabela, so catalogo e objetos novos, entao a foto velha nao a engana e ela
-- nunca falha por 40001. Um pedido que chega DEPOIS da trava espera o COMMIT e ja encontra o
-- gatilho (provado).
--
-- 6. IDEMPOTENCIA
--
-- Rodar duas vezes e o mesmo que rodar uma: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, CREATE OR REPLACE TRIGGER, ENABLE ROW LEVEL SECURITY, REVOKE e COMMENT reaplicam
-- sem efeito colateral (o pre-voo ja provou que o que existe e o que esta migration deixaria).
-- A foto de um pedido nao e tocada por reaplicar. DUAS APLICACOES AO MESMO TEMPO (o workflow
-- serializa, mas se acontecer): a segunda espera a primeira terminar; em READ COMMITTED ela
-- ja encontra tudo pronto e reaplica sem efeito; no envelope REPEATABLE READ a transacao dela
-- nao enxerga a tabela nova (a foto e anterior) e ela RECUSA com "apareceu agora", sem gravar
-- nada; repetir resolve. Provado com as duas conexoes reais.
--
-- 7. TRANSACAO
--
-- Sem BEGIN/COMMIT de nivel superior (regra da casa: com eles o ROLLBACK da prova do workflow
-- vira no-op). O arquivo roda numa unica consulta: os SET LOCAL, o pre-voo, as pecas e o
-- pos-voo caem juntos ou nao caem. Num banco local, com `psql`, usar `-1`.
--
-- 8. FRONT E EDGE ANTIGOS COM ESTE BANCO
--
-- Nada muda para eles: ninguem le a tabela nova e a unica diferenca observavel e uma linha
-- gravada a mais por cancelamento.
--
-- 9. ROLLBACK MANUAL: supabase/migrations/rollback-manual-20261209000000_a_foto_da_cobranca_no_cancelamento.sql
--    (apaga o gatilho, a funcao e a tabela, e com ela as fotos: sem elas a vaga do cupom volta
--    pelo prazo de hoje, 24 h. Se a 20261210000000 estiver aplicada, desfaca ELA primeiro:
--    o rollback recusa enquanto alguma funcao citar a tabela.)
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261209$
DECLARE
  r record;
  v_forma text;
  v_hash text;
  v_tentativa integer := 0;
  v_attnum smallint;
BEGIN
  IF to_regclass('public.marketplace_orders') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_20261209: falta a tabela public.marketplace_orders -- aplique as migrations anteriores antes desta.';
  END IF;

  -- A trava vem ANTES de qualquer leitura que decida e SEM esperar na fila: ver o item 5.
  LOOP
    BEGIN
      LOCK TABLE public.marketplace_orders IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      v_tentativa := v_tentativa + 1;
      IF v_tentativa >= 40 THEN
        RAISE EXCEPTION 'PREFLIGHT_20261209: public.marketplace_orders ficou ocupada por mais de 4 s (um pedido em andamento) -- nada foi gravado; repita a aplicacao.'
          USING ERRCODE = 'lock_not_available';
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;

  -- (a) as colunas que o gatilho le.
  FOR r IN
    SELECT * FROM (VALUES
      ('id', 'uuid'), ('status', 'text'), ('gateway_payment_id', 'text'),
      ('tentativas_de_pagamento', 'integer'), ('metodo_online', 'text'),
      ('payment_status', 'text')
    ) AS e(coluna, tipo)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
       WHERE a.attrelid = 'public.marketplace_orders'::regclass
         AND a.attname = r.coluna AND a.attnum > 0 AND NOT a.attisdropped
         AND format_type(a.atttypid, a.atttypmod) = r.tipo
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT_20261209: public.marketplace_orders.% (%) ausente ou em outra forma -- este banco nao e o que a 20261209000000 espera; nada foi gravado.', r.coluna, r.tipo;
    END IF;
  END LOOP;

  -- (b) a tabela, se ja existe, e a desta migration.
  IF to_regclass('public.pedido_cobranca_ao_cancelar') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
                      || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum)
      INTO v_forma
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.pedido_cobranca_ao_cancelar'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_forma IS NULL THEN
      RAISE EXCEPTION 'PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar apareceu agora (outra aplicacao desta migration ao mesmo tempo?) e esta transacao ainda nao a enxerga -- nada foi gravado; repita a aplicacao.';
    END IF;
    IF v_forma IS DISTINCT FROM 'order_id:uuid:true:,gateway_payment_id:text:false:,tentativas:integer:true:,metodo_online:text:false:,payment_status:text:false:,cancelado_em:timestamp with time zone:true:now()' THEN
      RAISE EXCEPTION 'PREFLIGHT_20261209: ja existe public.pedido_cobranca_ao_cancelar com outra forma de colunas (%) -- e de outra pessoa; nada foi gravado.', v_forma;
    END IF;
    SELECT a.attnum INTO v_attnum FROM pg_attribute a
     WHERE a.attrelid = 'public.pedido_cobranca_ao_cancelar'::regclass AND a.attname = 'order_id';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.pedido_cobranca_ao_cancelar'::regclass
         AND c.contype = 'p' AND c.conkey = ARRAY[v_attnum]
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar nao tem a chave primaria em order_id -- e de outra pessoa; nada foi gravado.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.pedido_cobranca_ao_cancelar'::regclass
         AND c.contype = 'f' AND c.conkey = ARRAY[v_attnum]
         AND c.confrelid = 'public.marketplace_orders'::regclass AND c.confdeltype = 'c'
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar nao tem a chave estrangeira para marketplace_orders com ON DELETE CASCADE -- e de outra pessoa; nada foi gravado.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.pedido_cobranca_ao_cancelar'::regclass) THEN
      RAISE EXCEPTION 'PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar tem politica de seguranca por linha -- a tabela e fechada de proposito (nenhuma politica); nada foi gravado.';
    END IF;
  END IF;

  -- (c) a funcao, se ja existe, e a desta migration.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'pedido__foto_da_cobranca_ao_cancelar'
       AND p.oid IS DISTINCT FROM to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()')::oid
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261209: ja existe public.pedido__foto_da_cobranca_ao_cancelar com outra assinatura -- e de outra pessoa; nada foi gravado.';
  END IF;
  IF to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()') IS NOT NULL THEN
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc WHERE oid = to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()');
    IF v_hash NOT IN ('026044748667e241a86479c4e7a9a7d7fb99a677df5ef15a939335ff8403acf4', '269a863b65e3db29f14dc22fec553d8ce624a5ba070e6b7fe9cad72c12a6bcb7') THEN
      RAISE EXCEPTION 'PREFLIGHT_20261209: public.pedido__foto_da_cobranca_ao_cancelar() tem corpo diferente do desta migration (hash %) -- e de outra pessoa; nada foi gravado.', v_hash;
    END IF;
  END IF;

  -- (d) o gatilho, se ja existe, e o desta migration.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.marketplace_orders'::regclass AND NOT t.tgisinternal
       AND t.tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'
       AND NOT (
         t.tgfoid = to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()')::oid
         AND t.tgtype = 17 AND t.tgenabled = 'O'
         AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a
                                WHERE a.attrelid = t.tgrelid AND a.attname = 'status')
         AND regexp_replace(lower(substring(pg_get_triggerdef(t.oid) from ' WHEN (.*) EXECUTE FUNCTION')), '[()[:space:]]', '', 'g')
             = 'new.status=''cancelled''::textandold.statusisdistinctfrom''cancelled''::text'
       )
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261209: ja existe o gatilho tr_pedido_foto_da_cobranca_ao_cancelar em marketplace_orders com outra definicao (ou desligado) -- e de outra pessoa; nada foi gravado.';
  END IF;
END
$preflight_20261209$;

CREATE TABLE IF NOT EXISTS public.pedido_cobranca_ao_cancelar (
  order_id uuid PRIMARY KEY REFERENCES public.marketplace_orders (id) ON DELETE CASCADE,
  gateway_payment_id text,
  tentativas integer NOT NULL,
  metodo_online text,
  payment_status text,
  cancelado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pedido_cobranca_ao_cancelar ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pedido_cobranca_ao_cancelar FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.pedido_cobranca_ao_cancelar IS 'Foto da cobranca do pedido no instante em que ele virou cancelled (20261209000000): id de cobranca na vaga, tentativas de pagamento, metodo online e payment_status. Uma linha por pedido; cancelar de novo apos reativar sobrescreve. Gravada pelo gatilho tr_pedido_foto_da_cobranca_ao_cancelar; so o dono e funcoes SECURITY DEFINER leem (seguranca por linha ligada, sem politica, sem privilegio para PUBLIC, anon, authenticated nem service_role). Pedido cancelado antes da migration nao tem foto.';

CREATE OR REPLACE FUNCTION public.pedido__foto_da_cobranca_ao_cancelar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $foto_da_cobranca$
BEGIN
  INSERT INTO public.pedido_cobranca_ao_cancelar
         (order_id, gateway_payment_id, tentativas, metodo_online, payment_status, cancelado_em)
  VALUES (NEW.id, NEW.gateway_payment_id, NEW.tentativas_de_pagamento, NEW.metodo_online,
          NEW.payment_status, now())
  ON CONFLICT (order_id) DO UPDATE
     SET gateway_payment_id = EXCLUDED.gateway_payment_id,
         tentativas = EXCLUDED.tentativas,
         metodo_online = EXCLUDED.metodo_online,
         payment_status = EXCLUDED.payment_status,
         cancelado_em = EXCLUDED.cancelado_em;
  RETURN NULL;
END;
$foto_da_cobranca$;

REVOKE ALL ON FUNCTION public.pedido__foto_da_cobranca_ao_cancelar() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.pedido__foto_da_cobranca_ao_cancelar() IS 'Gatilho (20261209000000): grava em pedido_cobranca_ao_cancelar a foto da cobranca do pedido que acabou de virar cancelled. SECURITY DEFINER, sem EXECUTE para ninguem alem do dono (o gatilho dispara sem o privilegio). Nao engole erro: se a foto nao grava, o cancelamento falha.';

CREATE OR REPLACE TRIGGER tr_pedido_foto_da_cobranca_ao_cancelar
AFTER UPDATE OF status ON public.marketplace_orders
FOR EACH ROW
WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
EXECUTE FUNCTION public.pedido__foto_da_cobranca_ao_cancelar();

DO $posvoo_20261209$
DECLARE
  v_hash text;
BEGIN
  IF to_regclass('public.pedido_cobranca_ao_cancelar') IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261209: public.pedido_cobranca_ao_cancelar nao existe depois da criacao -- nada foi mantido.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
     WHERE c.oid = 'public.pedido_cobranca_ao_cancelar'::regclass AND c.relrowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.pedido_cobranca_ao_cancelar'::regclass
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261209: public.pedido_cobranca_ao_cancelar saiu sem seguranca por linha ligada ou com politica -- nada foi mantido.';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_class c,
           LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) x
     WHERE c.oid = 'public.pedido_cobranca_ao_cancelar'::regclass
       AND (x.grantee = 0 OR x.grantee IN (
              SELECT r.oid FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')))
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261209: public.pedido_cobranca_ao_cancelar saiu com privilegio para PUBLIC, anon, authenticated ou service_role -- nada foi mantido.';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc p,
           LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()')
       AND (x.grantee = 0 OR x.grantee IN (
              SELECT r.oid FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')))
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261209: public.pedido__foto_da_cobranca_ao_cancelar() saiu com EXECUTE para PUBLIC, anon, authenticated ou service_role -- nada foi mantido.';
  END IF;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()');
  IF v_hash IS NULL OR v_hash NOT IN ('026044748667e241a86479c4e7a9a7d7fb99a677df5ef15a939335ff8403acf4', '269a863b65e3db29f14dc22fec553d8ce624a5ba070e6b7fe9cad72c12a6bcb7') THEN
    RAISE EXCEPTION 'POSVOO_20261209: public.pedido__foto_da_cobranca_ao_cancelar() saiu com o corpo (hash %) e nao com o esperado -- nada foi mantido.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.marketplace_orders'::regclass AND NOT t.tgisinternal
       AND t.tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'
       AND t.tgfoid = to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()')::oid
       AND t.tgtype = 17 AND t.tgenabled = 'O'
       AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a
                              WHERE a.attrelid = t.tgrelid AND a.attname = 'status')
       AND regexp_replace(lower(substring(pg_get_triggerdef(t.oid) from ' WHEN (.*) EXECUTE FUNCTION')), '[()[:space:]]', '', 'g')
           = 'new.status=''cancelled''::textandold.statusisdistinctfrom''cancelled''::text'
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261209: o gatilho tr_pedido_foto_da_cobranca_ao_cancelar nao ficou como esperado em marketplace_orders -- nada foi mantido.';
  END IF;
END
$posvoo_20261209$;

-- ============================================================================
-- Rollback manual -- a foto da cobranca no cancelamento (20261209000000)
-- ============================================================================
-- Apaga o gatilho tr_pedido_foto_da_cobranca_ao_cancelar, a funcao
-- public.pedido__foto_da_cobranca_ao_cancelar() e a tabela
-- public.pedido_cobranca_ao_cancelar. A migration so CRIOU esses tres objetos (nenhum
-- objeto existente foi alterado), entao desfazer e apaga-los: o banco volta EXATAMENTE ao
-- que era antes (provado na prova viva por fotografia do catalogo, antes e depois).
--
-- O QUE SE PERDE: as fotos ja gravadas (uma linha por pedido cancelado depois da migration).
-- Elas so servem para a 20261210000000 antecipar a vaga do cupom; sem elas a vaga do cupom de
-- pedido cancelado volta pelo prazo de sempre (24 h depois do prazo do PIX). Nenhum pedido,
-- cupom nem pagamento e tocado.
--
-- ORDEM: se a 20261210000000 estiver aplicada, desfaca ELA primeiro. Este rollback RECUSA,
-- com o nome das funcoes, enquanto alguma funcao fora a do gatilho citar a tabela (o texto
-- de uma funcao plpgsql nao deixa dependencia no catalogo, so a leitura do texto o ve);
-- uma visao ou chave estrangeira que dependa da tabela faz o DROP TABLE (sem CASCADE de
-- proposito) recusar, tudo desfeito.
--
-- RECUSA TAMBEM (sem apagar nada) se o que existe com esses nomes NAO e o desta migration:
-- tabela de outra forma, funcao de outro corpo, gatilho de outra definicao.
--
-- IDEMPOTENTE: com os tres objetos ja ausentes nao faz nada. Rollback repetido e no-op.
--
-- TRAVA: DROP TRIGGER e DROP TABLE pedem `marketplace_orders` em ACCESS EXCLUSIVE (ate o
-- COMMIT, nem a leitura passa). Como na migration, a trava vem primeiro e sem ficar na
-- fila (LOCK ... NOWAIT, a cada 100 ms, por no maximo 4 s; depois, recusa com 55P03 sem
-- apagar nada e basta repetir). Aplicar fora do horario de pico.
--
-- COMO DESFAZER: pelo WORKFLOW `aplicar-migrations.yml`, com este arquivo
-- (`rollback-manual-<versao>`; o runbook, secao Rollback > Banco). Ele roda o arquivo no
-- mesmo envelope da migration e APAGA a linha 20261209000000 do ledger na MESMA transacao.
-- NUNCA por `psql` direto: os objetos sumiriam com o ledger ainda dizendo "aplicada".
--
-- Sem BEGIN/COMMIT de nivel superior neste arquivo -- regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $rollback_preflight_20261209$
DECLARE
  v_forma text;
  v_hash text;
  v_lista text;
  v_n bigint;
  v_tentativa integer := 0;
  v_attnum smallint;
BEGIN
  IF to_regclass('public.pedido_cobranca_ao_cancelar') IS NULL
     AND to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()') IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.marketplace_orders'::regclass AND NOT t.tgisinternal
          AND t.tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'
     ) THEN
    RETURN; -- ja desfeito: nada a conferir nem a apagar
  END IF;

  LOOP
    BEGIN
      LOCK TABLE public.marketplace_orders IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      v_tentativa := v_tentativa + 1;
      IF v_tentativa >= 40 THEN
        RAISE EXCEPTION 'ROLLBACK_20261209: public.marketplace_orders ficou ocupada por mais de 4 s (um pedido em andamento) -- nada foi apagado; repita.'
          USING ERRCODE = 'lock_not_available';
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;

  -- a tabela, se existe, e a desta migration
  IF to_regclass('public.pedido_cobranca_ao_cancelar') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
                      || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum)
      INTO v_forma
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.pedido_cobranca_ao_cancelar'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_forma IS DISTINCT FROM 'order_id:uuid:true:,gateway_payment_id:text:false:,tentativas:integer:true:,metodo_online:text:false:,payment_status:text:false:,cancelado_em:timestamp with time zone:true:now()' THEN
      RAISE EXCEPTION 'ROLLBACK_20261209: public.pedido_cobranca_ao_cancelar tem outra forma de colunas (%) -- nao e a desta migration; nada foi apagado.', v_forma;
    END IF;
    SELECT a.attnum INTO v_attnum FROM pg_attribute a
     WHERE a.attrelid = 'public.pedido_cobranca_ao_cancelar'::regclass AND a.attname = 'order_id';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.pedido_cobranca_ao_cancelar'::regclass
         AND c.contype = 'p' AND c.conkey = ARRAY[v_attnum]
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.pedido_cobranca_ao_cancelar'::regclass
         AND c.contype = 'f' AND c.conkey = ARRAY[v_attnum]
         AND c.confrelid = 'public.marketplace_orders'::regclass AND c.confdeltype = 'c'
    ) THEN
      RAISE EXCEPTION 'ROLLBACK_20261209: public.pedido_cobranca_ao_cancelar nao tem a chave primaria e a chave estrangeira com CASCADE desta migration -- nao e a dela; nada foi apagado.';
    END IF;
  END IF;

  -- a funcao, se existe, e a desta migration
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'pedido__foto_da_cobranca_ao_cancelar'
       AND p.oid IS DISTINCT FROM to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()')::oid
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_20261209: existe public.pedido__foto_da_cobranca_ao_cancelar com outra assinatura -- nao e a desta migration; nada foi apagado.';
  END IF;
  IF to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()') IS NOT NULL THEN
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc WHERE oid = to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()');
    IF v_hash NOT IN ('026044748667e241a86479c4e7a9a7d7fb99a677df5ef15a939335ff8403acf4', '269a863b65e3db29f14dc22fec553d8ce624a5ba070e6b7fe9cad72c12a6bcb7') THEN
      RAISE EXCEPTION 'ROLLBACK_20261209: public.pedido__foto_da_cobranca_ao_cancelar() tem corpo diferente do desta migration (hash %) -- nada foi apagado.', v_hash;
    END IF;
  END IF;

  -- o gatilho, se existe, e o desta migration (chama a funcao dela)
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.marketplace_orders'::regclass AND NOT t.tgisinternal
       AND t.tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'
       AND t.tgfoid IS DISTINCT FROM to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()')::oid
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_20261209: o gatilho tr_pedido_foto_da_cobranca_ao_cancelar chama outra funcao -- nao e o desta migration; nada foi apagado.';
  END IF;

  -- ninguem mais cita a tabela no texto de uma funcao (por exemplo a 20261210000000)
  SELECT count(*), string_agg(s.nspname || '.' || p.proname::text, ', ' ORDER BY s.nspname, p.proname)
    INTO v_n, v_lista
    FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
     AND strpos(lower(p.prosrc), 'pedido_cobranca_ao_cancelar') > 0
     AND p.oid IS DISTINCT FROM to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()')::oid;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ROLLBACK_20261209: % funcao(oes) citam pedido_cobranca_ao_cancelar (%) -- desfaca a 20261210000000 antes; nada foi apagado.', v_n, v_lista;
  END IF;
END
$rollback_preflight_20261209$;

DROP TRIGGER IF EXISTS tr_pedido_foto_da_cobranca_ao_cancelar ON public.marketplace_orders;

DROP FUNCTION IF EXISTS public.pedido__foto_da_cobranca_ao_cancelar();

DROP TABLE IF EXISTS public.pedido_cobranca_ao_cancelar;

DO $verifica_rollback_20261209$
BEGIN
  IF to_regclass('public.pedido_cobranca_ao_cancelar') IS NOT NULL
     OR to_regprocedure('public.pedido__foto_da_cobranca_ao_cancelar()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.marketplace_orders'::regclass AND NOT t.tgisinternal
          AND t.tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'
     ) THEN
    RAISE EXCEPTION 'ROLLBACK_20261209: algum objeto da 20261209000000 ainda existe depois do rollback.';
  END IF;
END
$verifica_rollback_20261209$;

-- ============================================================================
-- Migration 20261207000000 -- o contador duplicado do cupom morre
-- (cupom; politica P4 do dono em AGENTS.md: "ao tocar no codigo de cupom,
-- eliminar os contadores duplicados usage_count/used_count"; 09/10/2026)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION FAZ
--
-- Apaga a coluna `public.coupons.used_count` (baseline: integer DEFAULT 0, sem
-- NOT NULL). Quem conta os usos do cupom e `usage_count`: v23/v24 somam 1,
-- `devolver_uso_cupom` tira 1, `validate_coupon_secure_v2` le. A `used_count`
-- nunca foi escrita por RPC, gatilho, edge function ou tela; o front parou de le-la
-- no PAINEL-12 (useCoupons.ts, realtimeSyncEngine.ts) e os tipos gerados deixam de
-- cita-la junto com esta migration. Duas colunas para a mesma coisa so confundem.
--
-- 2. A DECISAO DO DONO E A CONDICAO QUE ELA CARREGA
--
-- O dono aprovou apagar CONDICIONADO a medir tudo zero. Medido em 09/10/2026 pela
-- consulta 13a (runs 37904281952 na IKCOUS e 37904285498 na Savy): nenhum valor
-- diferente de zero, nenhum nulo, nenhum dependente (visao, politica, gatilho,
-- funcao) e a seguranca por linha nao escondia cupom. Esta migration NAO confia
-- na medicao de ontem: refaz a condicao DENTRO do proprio arquivo, na hora de
-- apagar, e RECUSA sem gravar nada se ela nao vale mais (item 4).
--
-- 3. DADOS EXISTENTES
--
-- Cada linha de `coupons` conserva todas as colunas, menos `used_count`. Nenhum
-- valor de `usage_count` e lido para decisao nem alterado. Como so apaga quando
-- TODA linha tem `used_count` igual a 0 exato, o rollback reproduz o estado
-- anterior sem perda: a coluna volta com 0 em todas as linhas.
--
-- 4. O PRE-VOO (RECUSA, COM O NOME DO QUE DIVERGE, SEM GRAVAR NADA)
--
--   (a) a tabela `public.coupons` existe e `usage_count` existe NA FORMA DO BASELINE
--       (integer, aceita NULL, DEFAULT 0, nem gerada nem identidade): sem o contador
--       verdadeiro, apagar o duplicado deixaria o cupom sem contador; e com ele em outra
--       forma a consulta 14a (que cobra essa mesma forma depois do apply) sairia NEGATIVA
--       e o portao da release PARARIA, com a coluna ja apagada. Melhor recusar antes;
--   (b) `used_count` tem a forma do baseline (integer, aceita NULL, DEFAULT 0, nem
--       gerada nem identidade): e o que o rollback recria, e e o que a medicao
--       confirmou. Forma diferente e coluna que alguem mexeu: o dono decide;
--   (b') `used_count` NAO tem permissao propria por coluna (pg_attribute.attacl nulo) nem
--       comentario proprio (pg_description): o DROP COLUMN apaga os dois e o rollback nao os
--       recria (so recria a coluna). Por isso a recusa, com o nome do que existe: o rollback
--       so devolve o estado exato de antes quando nao havia nenhum dos dois;
--   (c) a seguranca por linha nao esconde nenhum cupom DESTE papel
--       (row_security_active falso): sem isso o "tudo zero" contaria so as linhas
--       que o papel enxerga;
--   (d) NENHUM dependente da coluna: qualquer linha de pg_depend sobre ela (visao,
--       politica, gatilho com lista de colunas ou WHEN, indice, constraint, coluna
--       GERADA de outra coluna que a cita, estatistica, publicacao), EXCETO o
--       DEFAULT da propria `used_count` (o pg_attrdef cuja coluna e a mesma da
--       dependencia). Qualquer outro pg_attrdef, como a expressao de uma coluna
--       gerada, CONTA e recusa;
--   (e) NENHUM corpo de funcao em `public` cita `used_count` (qualquer tipo de
--       rotina): o corpo de uma funcao plpgsql nao deixa dependencia em pg_depend,
--       so a leitura do texto o ve. (Politica, gatilho e visao que citam a coluna
--       deixam dependencia, e o item (d) as recusa);
--   (f) TODA linha tem `used_count IS DISTINCT FROM 0` falso: um valor diferente de
--       zero e um NULL RECUSAM (NULL nao vale 0: o rollback devolveria 0 onde era
--       NULL, e o dono nunca decidiu sobre isso).
--
-- 5. ORDEM, TRAVAS E CONCORRENCIA
--
-- A primeira coisa do pre-voo e travar `coupons` em SHARE ROW EXCLUSIVE: a partir do
-- LOCK ninguem grava no cupom (nem em `used_count`) ate o DROP, e a leitura (o checkout
-- validando cupom) continua. Sem essa trava, uma gravacao que terminasse DEPOIS da
-- contagem e ANTES do DROP sumiria junto com a coluna. O DROP sobe a trava para ACCESS
-- EXCLUSIVE. `lock_timeout` de 5 s: se alguem segura a tabela por mais que isso, a
-- migration FALHA (55P03) sem gravar nada, em vez de enfileirar o checkout atras dela; e
-- so repetir.
--
-- A TRAVA SO PROTEGE DO LOCK EM DIANTE. O que o workflow aplicar-migrations.yml faz: a
-- transacao e REPEATABLE READ e a impressao digital ANTES tira a foto do banco ANTES do
-- LOCK. Sob esse nivel a contagem (f) enxergaria a FOTO VELHA: um UPDATE de used_count
-- gravado depois da foto e antes da trava seria invisivel, e a coluna seria apagada com o
-- valor dentro. Por isso, logo depois do LOCK e da checagem de coluna ausente, o pre-voo
-- faz `PERFORM 1 FROM public.coupons FOR SHARE`: sob REPEATABLE READ o Postgres RECUSA
-- (40001, "could not serialize access due to concurrent update") qualquer linha alterada
-- depois da foto -- a migration falha sem gravar nada (o workflow mostra ESTADO
-- DESCONHECIDO) e basta repetir; sob READ COMMITTED o FOR SHARE so trava as linhas.
-- RISCO RESIDUAL ACEITO: um INSERT com used_count explicito diferente de zero, gravado nos
-- segundos entre a foto e o LOCK, NAO e visto (linha nova nao existe na foto e o FOR SHARE
-- nao a alcanca). Ninguem grava essa coluna (nenhuma RPC, gatilho, edge function ou tela),
-- e a janela e de segundos: o risco foi aceito em vez de uma checagem a mais.
-- O DROP e sem CASCADE de proposito: se algum dependente escapasse do pre-voo, o
-- Postgres recusa em vez de apagar o objeto junto.
--
-- 6. IDEMPOTENCIA
--
-- Coluna ja ausente: o pre-voo volta sem recusar, o DROP COLUMN IF EXISTS nao faz
-- nada e o pos-voo confere o estado final. Rodar duas vezes e o mesmo que rodar uma.
--
-- 7. TRANSACAO
--
-- Sem BEGIN/COMMIT de nivel superior (regra da casa: com eles o ROLLBACK da prova
-- do workflow vira no-op). O arquivo roda numa unica consulta: os SET LOCAL, o
-- pre-voo, o DROP e o pos-voo caem juntos ou nao caem; o db-apply grava o ledger
-- na mesma transacao. O caminho real e o workflow aplicar-migrations.yml; num banco
-- local, com `psql`, usar `-1`.
--
-- 8. FRONT ANTIGO COM ESTE BANCO
--
-- O front le `coupons` com select("*") e nunca cita used_count: nada quebra, e a
-- linha de realtime passa a chegar sem a chave (o mapeador ja usa `usage_count`).
--
-- 9. ROLLBACK MANUAL: supabase/migrations/rollback-manual-20261207000000_o_contador_duplicado_do_cupom_morre.sql
--    (recria a coluna como no baseline; nada se perde, porque so apagou com tudo 0).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261207$
DECLARE
  v_attnum smallint;
  v_forma_ok boolean;
  v_n bigint;
  v_lista text;
BEGIN
  IF to_regclass('public.coupons') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_20261207: falta a tabela public.coupons -- aplique as migrations anteriores antes desta.';
  END IF;

  -- A trava vem ANTES de qualquer leitura que decida: o que for conferido abaixo
  -- continua verdadeiro ate o DROP.
  LOCK TABLE public.coupons IN SHARE ROW EXCLUSIVE MODE;

  SELECT a.attnum INTO v_attnum
    FROM pg_attribute a
   WHERE a.attrelid = 'public.coupons'::regclass
     AND a.attname = 'used_count' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_attnum IS NULL THEN
    RETURN; -- ja apagada: reaplicacao, nada a conferir nem a fazer
  END IF;

  -- Sob REPEATABLE READ (o envelope do workflow), recusa (40001) linha alterada depois da
  -- foto da impressao digital; sob READ COMMITTED so trava as linhas. Antes de (f): e o que
  -- faz a contagem enxergar o que a trava impediu de mudar. Ver o item 5.
  PERFORM 1 FROM public.coupons FOR SHARE;

  -- (a) o contador verdadeiro existe.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.coupons'::regclass
       AND a.attname = 'usage_count' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261207: public.coupons.usage_count nao existe -- apagar used_count deixaria o cupom sem contador; nada foi apagado.';
  END IF;

  -- (a') a forma do baseline do contador que FICA: a mesma que a 14b mede antes e a 14a
  --      cobra depois.
  SELECT a.atttypid = 'integer'::regtype AND NOT a.attnotnull
         AND a.attgenerated = '' AND a.attidentity = ''
         AND pg_get_expr(ad.adbin, ad.adrelid) IS NOT DISTINCT FROM '0'
    INTO v_forma_ok
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
   WHERE a.attrelid = 'public.coupons'::regclass
     AND a.attname = 'usage_count' AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT COALESCE(v_forma_ok, false) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261207: public.coupons.usage_count nao tem a forma do baseline (integer, aceita NULL, DEFAULT 0, nem gerada nem identidade) -- e o contador que fica; nada foi apagado.';
  END IF;

  -- (b) a forma do baseline: e a que o rollback recria.
  SELECT a.atttypid = 'integer'::regtype AND NOT a.attnotnull
         AND a.attgenerated = '' AND a.attidentity = ''
         AND pg_get_expr(ad.adbin, ad.adrelid) IS NOT DISTINCT FROM '0'
    INTO v_forma_ok
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
   WHERE a.attrelid = 'public.coupons'::regclass AND a.attnum = v_attnum;
  IF NOT COALESCE(v_forma_ok, false) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261207: public.coupons.used_count nao tem a forma do baseline (integer, aceita NULL, DEFAULT 0, nem gerada nem identidade) -- alguem a alterou; o rollback nao a reproduziria; nada foi apagado.';
  END IF;

  -- (b') nada proprio da coluna que o rollback nao recriaria: permissao por coluna e comentario.
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.coupons'::regclass AND a.attnum = v_attnum AND a.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261207: public.coupons.used_count tem permissao propria por coluna (attacl) -- o DROP a apagaria e o rollback nao a recria; nada foi apagado.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_description d
     WHERE d.classoid = 'pg_class'::regclass
       AND d.objoid = 'public.coupons'::regclass AND d.objsubid = v_attnum
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261207: public.coupons.used_count tem comentario proprio (pg_description) -- o DROP o apagaria e o rollback nao o recria; nada foi apagado.';
  END IF;

  -- (c) a seguranca por linha nao esconde cupom deste papel.
  IF row_security_active('public.coupons') THEN
    RAISE EXCEPTION 'PREFLIGHT_20261207: a seguranca por linha vale para este papel em public.coupons -- a contagem de used_count so veria as linhas visiveis a ele; rode como o dono da tabela; nada foi apagado.';
  END IF;

  -- (d) nenhum dependente da coluna, exceto o DEFAULT da propria used_count
  --     (o pg_attrdef cuja coluna e a mesma da dependencia). O pg_attrdef de OUTRA
  --     coluna (expressao de coluna gerada que cita used_count) conta.
  SELECT count(*), string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', '
                          ORDER BY pg_describe_object(d.classid, d.objid, d.objsubid))
    INTO v_n, v_lista
    FROM pg_depend d
   WHERE d.refclassid = 'pg_class'::regclass
     AND d.refobjid = 'public.coupons'::regclass
     AND d.refobjsubid = v_attnum
     AND NOT (
       d.classid = 'pg_attrdef'::regclass
       AND EXISTS (
         SELECT 1 FROM pg_attrdef ad
          WHERE ad.oid = d.objid
            AND ad.adrelid = d.refobjid
            AND ad.adnum = d.refobjsubid
       )
     );
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_20261207: % objeto(s) dependem de public.coupons.used_count (%) -- nada foi apagado; o dono decide antes de rodar de novo.', v_n, v_lista;
  END IF;

  -- (e) ninguem cita o nome no TEXTO de uma funcao: o corpo de uma funcao plpgsql nao
  --     deixa dependencia em pg_depend, entao so a leitura do texto a ve. (Politica,
  --     gatilho e visao que citam a coluna JA deixam dependencia: o item (d) as pega.)
  SELECT count(*), string_agg(p.proname::text, ', ' ORDER BY p.proname)
    INTO v_n, v_lista
    FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'public' AND strpos(lower(p.prosrc), 'used_count') > 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_20261207: % funcao(oes) de public citam used_count (%) -- nada foi apagado; reescreva-as antes.', v_n, v_lista;
  END IF;

  -- (f) toda linha com used_count igual a 0 exato; NULL tambem recusa.
  EXECUTE 'SELECT count(*) FROM public.coupons WHERE used_count IS DISTINCT FROM 0' INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_20261207: used_count tem % linha(s) diferente(s) de 0 (NULL conta) -- nada foi apagado; o dono decide antes de rodar de novo.', v_n;
  END IF;
END
$preflight_20261207$;

ALTER TABLE public.coupons DROP COLUMN IF EXISTS used_count;

DO $posvoo_20261207$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.coupons'::regclass
       AND a.attname = 'used_count' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261207: public.coupons.used_count ainda existe depois do DROP.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.coupons'::regclass
       AND a.attname = 'usage_count' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261207: public.coupons.usage_count nao existe depois do DROP.';
  END IF;
END
$posvoo_20261207$;

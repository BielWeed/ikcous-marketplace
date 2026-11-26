-- ============================================================================
-- Migration 20261460000000 — a loja tem estado de vida: ativa, adormecida ou encerrada (plano L8, Lote 1, 26/11/2026; caderneta da frota)
-- ============================================================================
--
-- 1. O QUE FALTAVA
--
-- A caderneta da frota (20261141000000: public.frota_lojas + public.resolver_loja) só sabia "ativa ou não" (frota_lojas.ativa). Uma loja que
-- deixou de pagar (adormecida) ou que saiu da IKCOUS (encerrada) só podia SUMIR (ativa = false), e o porteiro a tratava como endereço
-- desconhecido: a cliente da loja não tinha como saber que a loja está fechada, nem a IKCOUS como reabri-la sem perder o histórico.
--
-- 2. O QUE ESTA MIGRATION FAZ (só no banco que guarda a caderneta; nas outras lojas a tabela existe vazia e o efeito é o mesmo)
--
--   a) frota_lojas ganha três colunas:
--        estado        text NOT NULL DEFAULT 'ativa', com o CHECK frota_lojas_estado_check (estado IN ('ativa', 'adormecida', 'encerrada'));
--        estado_desde  timestamptz NOT NULL DEFAULT now() — desde quando a loja está no estado atual;
--        estado_sha    text NULL — campo livre para quem muda o estado (Lote 4, scripts/frota/estado-da-loja.mjs) registrar a release
--                      de referência da loja naquele momento; esta migration não o lê nem o preenche.
--   b) public.resolver_loja (v1, a que o porteiro de hoje chama) passa a exigir também fl.estado = 'ativa'. É a ÚNICA troca no corpo: a
--      assinatura, o RETURNS TABLE de 6 colunas, a porta da chave, SECURITY DEFINER, VOLATILE, search_path vazio, o dono e a ACL (só o
--      anon executa) não mudam (CREATE OR REPLACE preserva OID, dono e ACL; o pré-voo fotografa e o pós-voo confere).
--   c) public.resolver_loja_com_estado (v2, nova; o porteiro do Lote 2 a chama): mesma porta da chave e mesmas travas da v1, devolve
--      id, nome, dominio_publico, project_ref, supabase_url, publishable_key e estado. Loja adormecida ou encerrada vem COM id, nome, ref
--      e estado e SEM a URL e a chave do banco dela (NULL): o porteiro mostra a página de "fechada" sem nunca falar com o banco da loja.
--      ativa = false continua igual na v1 e na v2: zero linhas, endereço desconhecido.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida, apagada ou reescrita por comando desta migration (nenhum INSERT, UPDATE ou DELETE). As linhas que já existem em
-- frota_lojas passam a ter, pelo DEFAULT das colunas novas, estado = 'ativa', estado_desde = o instante do apply (now() da transação) e
-- estado_sha = NULL — ou seja, toda loja continua resolvendo exatamente como antes (inclusive as com ativa = false, que seguem sem linha).
-- frota_segredo não é tocada. Aplicar duas vezes deixa o mesmo estado: ADD COLUMN IF NOT EXISTS não toca coluna que já existe (estado,
-- estado_desde e estado_sha de cada loja são preservados) e o pré-voo aceita o corpo da 20261141 OU o desta migration.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: frota_lojas ou frota_segredo não existirem, ou frota_lojas não tiver a forma da 20261141 (ativa boolean NOT NULL e as colunas
-- de texto que as funções devolvem); extensions.crypt(text, text) não existir; resolver_loja não existir, tiver sobrecarga, ou o corpo vivo
-- (md5 de replace(prosrc, E'\r', '')) não for o da 20261141 nem o desta migration; os atributos dela não forem os de sempre; a ACL não for
-- exatamente "só o anon executa"; o dono dela não for o dono de frota_lojas e de frota_segredo; as três colunas novas e o CHECK não
-- estiverem TODOS ausentes ou TODOS presentes com a forma desta migration (estado parcial é recusado); a v1 já estiver com o corpo novo sem
-- as colunas; resolver_loja_com_estado existir com sobrecarga ou com corpo, atributos ou ACL que não sejam os desta migration.
--
-- 5. TRANSAÇÃO E TRAVAS
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador; pré-voo, colunas, as duas funções e o pós-voo
-- caem juntos ou não caem. lock_timeout de 5 s: o ADD COLUMN pede trava exclusiva de frota_lojas, e o porteiro lê a tabela a cada
-- endereço novo (com cache de 60 s); se alguém segurar a tabela por mais de 5 s a migration desiste sem escrever nada (rodar de novo).
-- As colunas com DEFAULT constante/now() não reescrevem a tabela (PostgreSQL 11+).
--
-- 6. ORDEM E ROLLBACK
--
-- Depois da 20261141000000 (o pré-voo recusa sem ela). Aplicar em CADA banco do canal (IKCOUS e Savy) e também no banco onde a caderneta
-- de produção mora (IKCOUS_FROTA_URL), ANTES de publicar o porteiro do Lote 2. Consultas da publicação: 182b antes, 182a depois.
-- ROLLBACK MANUAL: rollback-manual-20261460000000_a_loja_tem_estado_de_vida.sql devolve a v1 BYTE A BYTE ao corpo da 20261141 e apaga a
-- v2; as colunas, o CHECK e as linhas FICAM (loja que estiver adormecida volta a resolver pela v1, como antes desta migration). Reverter
-- antes o porteiro do Lote 2 (se a v2 sumir antes, ele cai na reserva estreita PGRST202 -> v1). Tirar as colunas é o
-- rollback-manual-destrutivo-20261460000000 (só com o dono, depois do comum).
--
-- 7. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.resolver_loja(text, text)');
--      -- esperado: 19072d99f3253583342a0bb6c42447dd.
--   2. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.resolver_loja_com_estado(text, text)');
--      -- esperado: 92682af1143806d3662411b6d5788096.
--   3. SELECT has_function_privilege('anon', 'public.resolver_loja_com_estado(text, text)', 'EXECUTE'),
--             has_function_privilege('authenticated', 'public.resolver_loja_com_estado(text, text)', 'EXECUTE'),
--             has_function_privilege('service_role', 'public.resolver_loja_com_estado(text, text)', 'EXECUTE');
--      -- esperado: true, false, false.
--   PROVA VIVA: tests/banco/a-loja-tem-estado-de-vida-viva.cjs (rpc-ci); portão da release: consultas 182a e 182b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261460000000$
DECLARE
  v_v1 oid := to_regprocedure('public.resolver_loja(text, text)');
  v_v2 oid := to_regprocedure('public.resolver_loja_com_estado(text, text)');
  v_lojas oid := to_regclass('public.frota_lojas');
  v_segredo oid := to_regclass('public.frota_segredo');
  v_hash_v1 text;
  v_hash_v2 text;
  v_dono oid;
  v_colunas integer;
  v_check integer;
BEGIN
  IF v_lojas IS NULL OR v_segredo IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_lojas ou public.frota_segredo não existe — aplique a 20261141000000 antes.';
  END IF;
  -- A forma da 20261141 que as duas funções leem (as colunas devolvidas e o filtro ativa).
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = v_lojas AND a.attnum > 0 AND NOT a.attisdropped
         AND ((a.attname IN ('id', 'nome', 'dominio_publico', 'project_ref', 'supabase_url', 'publishable_key') AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'ativa' AND a.atttypid = 'boolean'::regtype AND a.attnotnull))) <> 7 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_lojas não tem a forma da 20261141000000 (id, nome, dominio_publico, project_ref, supabase_url, publishable_key text e ativa boolean NOT NULL) — meça o banco e revise antes de aplicar.';
  END IF;
  IF to_regprocedure('extensions.crypt(text, text)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: extensions.crypt(text, text) não existe (pgcrypto no schema extensions) — a porta da chave não funcionaria.';
  END IF;

  -- v1: existe, uma só, corpo conhecido, atributos e ACL de sempre.
  IF v_v1 IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.resolver_loja(text, text) não existe — aplique a 20261141000000 antes.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_loja') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_loja tem sobrecarga em public — meça o banco e revise antes de aplicar.';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r', '')), p.proowner INTO v_hash_v1, v_dono FROM pg_proc p WHERE p.oid = v_v1;
  IF v_hash_v1 IS NULL OR v_hash_v1 NOT IN (
       'fcb01b1e25e00481d8085d53dec291e5', -- corpo da 20261141000000 (vigente até aqui)
       '19072d99f3253583342a0bb6c42447dd'  -- corpo que ESTA migration deixa — reaplicação idempotente
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.resolver_loja (hash %) não é o da 20261141000000 nem o desta migration — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash_v1, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_v1
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND NOT p.proisstrict
          AND p.proconfig = ARRAY['search_path=""']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_host text, p_chave text'
          AND pg_get_function_result(p.oid) = 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.resolver_loja (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os da 20261141000000 — meça o banco e revise antes de aplicar.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_v1 AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR NOT has_function_privilege('anon', v_v1, 'EXECUTE')
     OR has_function_privilege('authenticated', v_v1, 'EXECUTE')
     OR has_function_privilege('service_role', v_v1, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.resolver_loja não é a da 20261141000000 (só o anon executa; PUBLIC, authenticated e service_role não) — meça o banco e revise.';
  END IF;
  -- SECURITY DEFINER lê a caderneta com os privilégios do dono: o dono da função tem de ser o das duas tabelas.
  IF v_dono IS DISTINCT FROM (SELECT c.relowner FROM pg_class c WHERE c.oid = v_lojas)
     OR v_dono IS DISTINCT FROM (SELECT c.relowner FROM pg_class c WHERE c.oid = v_segredo) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o dono de public.resolver_loja não é o dono de frota_lojas e de frota_segredo — meça o banco e revise.';
  END IF;

  -- Colunas novas e CHECK: todos ausentes (primeira vez) ou todos com a forma desta migration (reaplicação). Nada no meio.
  SELECT count(*) INTO v_colunas FROM pg_attribute a
   WHERE a.attrelid = v_lojas AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('estado', 'estado_desde', 'estado_sha');
  SELECT count(*) INTO v_check FROM pg_constraint k WHERE k.conrelid = v_lojas AND k.conname = 'frota_lojas_estado_check';
  IF v_colunas = 0 AND v_check = 0 THEN
    IF v_hash_v1 = '19072d99f3253583342a0bb6c42447dd' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.resolver_loja já está com o corpo desta migration, mas frota_lojas não tem a coluna estado — estado desconhecido, revise antes de aplicar.';
    END IF;
  ELSIF v_colunas <> 3 OR v_check <> 1
     OR (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attname)
           FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = v_lojas AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('estado', 'estado_desde', 'estado_sha'))
        IS DISTINCT FROM 'estado:text:true:''ativa''::text,estado_desde:timestamp with time zone:true:now(),estado_sha:text:false:-'
     OR (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conrelid = v_lojas AND k.conname = 'frota_lojas_estado_check')
        IS DISTINCT FROM 'CHECK ((estado = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])))' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: frota_lojas tem só parte das colunas estado/estado_desde/estado_sha e do CHECK frota_lojas_estado_check, ou com outra forma — meça o banco e revise antes de aplicar.';
  END IF;

  -- v2: ausente (primeira vez) ou exatamente a desta migration (reaplicação).
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_loja_com_estado') > 1
     OR ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_loja_com_estado') = 1 AND v_v2 IS NULL) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_loja_com_estado existe com outra assinatura ou com sobrecarga — meça o banco e revise.';
  END IF;
  IF v_v2 IS NOT NULL THEN
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash_v2 FROM pg_proc p WHERE p.oid = v_v2;
    IF v_hash_v2 IS DISTINCT FROM '92682af1143806d3662411b6d5788096'
       OR NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_v2 AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
            AND p.proowner = v_dono
            AND p.proconfig = ARRAY['search_path=""']::text[]
            AND pg_get_function_result(p.oid) = 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text, estado text)')
       OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                   WHERE p.oid = v_v2 AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
       OR NOT has_function_privilege('anon', v_v2, 'EXECUTE')
       OR has_function_privilege('authenticated', v_v2, 'EXECUTE')
       OR has_function_privilege('service_role', v_v2, 'EXECUTE') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.resolver_loja_com_estado (hash %) já existe e não é a desta migration (corpo, atributos, dono ou ACL) — meça o banco e revise.', COALESCE(v_hash_v2, 'ausente');
    END IF;
  END IF;

  -- Fotografia da v1: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE só pode trocar o texto).
  PERFORM set_config('ikcous.estado1460_v1', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_v1)::text, true);
END $preflight_20261460000000$;

-- As três colunas e o CHECK nascem juntos (o CONSTRAINT é da coluna estado: se ela já existe, nada é feito).
ALTER TABLE public.frota_lojas
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'ativa'
    CONSTRAINT frota_lojas_estado_check CHECK (estado IN ('ativa', 'adormecida', 'encerrada')),
  ADD COLUMN IF NOT EXISTS estado_desde timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS estado_sha text;

-- v1: o corpo da 20261141000000 + o filtro do estado (a única troca; ver item 2b do cabeçalho).
CREATE OR REPLACE FUNCTION public.resolver_loja(p_host text, p_chave text)
RETURNS TABLE (
  id text,
  nome text,
  dominio_publico text,
  project_ref text,
  supabase_url text,
  publishable_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.frota_segredo fs
     WHERE fs.id = 1
       AND fs.hash = extensions.crypt(p_chave, fs.hash)
  ) THEN
    RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"
  END IF;

  RETURN QUERY
  SELECT fl.id, fl.nome, fl.dominio_publico, fl.project_ref, fl.supabase_url, fl.publishable_key
    FROM public.frota_lojas fl
   WHERE lower(fl.dominio_publico) = lower(p_host)
     AND fl.ativa
     -- 20261460000000: loja adormecida ou encerrada nao resolve pela v1 (o porteiro que usa a v1 a trata como endereco desconhecido).
     AND fl.estado = 'ativa';
END;
$$;

-- v2: a mesma porta da chave; a loja fora do ar vem com o estado e SEM a URL e a chave do banco dela.
CREATE OR REPLACE FUNCTION public.resolver_loja_com_estado(p_host text, p_chave text)
RETURNS TABLE (
  id text,
  nome text,
  dominio_publico text,
  project_ref text,
  supabase_url text,
  publishable_key text,
  estado text
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.frota_segredo fs
     WHERE fs.id = 1
       AND fs.hash = extensions.crypt(p_chave, fs.hash)
  ) THEN
    RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"
  END IF;

  -- ativa = false continua sendo endereço desconhecido (zero linhas). Fora do ar (adormecida, encerrada): a linha vem para o porteiro
  -- mostrar a página certa, mas a URL e a chave do banco da loja nunca saem — o porteiro não tem como falar com o banco dela.
  RETURN QUERY
  SELECT fl.id, fl.nome, fl.dominio_publico, fl.project_ref,
         CASE WHEN fl.estado = 'ativa' THEN fl.supabase_url END,
         CASE WHEN fl.estado = 'ativa' THEN fl.publishable_key END,
         fl.estado
    FROM public.frota_lojas fl
   WHERE lower(fl.dominio_publico) = lower(p_host)
     AND fl.ativa;
END;
$$;

-- O ALTER DEFAULT PRIVILEGES do schema public (ver o cabeçalho da 20261141) daria EXECUTE de graça a anon, authenticated e service_role:
-- o REVOKE fecha e o GRANT deixa só o anon, como na v1. Revogar o já revogado e conceder o já concedido é no-op.
REVOKE ALL ON FUNCTION public.resolver_loja_com_estado(text, text) FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolver_loja_com_estado(text, text) TO anon;

DO $posvoo_20261460000000$
DECLARE
  v_v1 oid := to_regprocedure('public.resolver_loja(text, text)');
  v_v2 oid := to_regprocedure('public.resolver_loja_com_estado(text, text)');
  v_lojas oid := to_regclass('public.frota_lojas');
BEGIN
  IF v_v1 IS NULL OR v_v2 IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261460000000: resolver_loja ou resolver_loja_com_estado ausente';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_v1) IS DISTINCT FROM '19072d99f3253583342a0bb6c42447dd' THEN
    RAISE EXCEPTION 'POSVOO_20261460000000: o corpo de resolver_loja não é o desta migration';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_v1) IS DISTINCT FROM current_setting('ikcous.estado1460_v1')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261460000000: atributos, dono, OID ou ACL de resolver_loja mudaram';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado')) <> 2 THEN
    RAISE EXCEPTION 'POSVOO_20261460000000: resolver_loja ou resolver_loja_com_estado ficou com sobrecarga';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_v2 AND md5(replace(p.prosrc, E'\r', '')) = '92682af1143806d3662411b6d5788096'
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
          AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = v_v1)
          AND p.proconfig = ARRAY['search_path=""']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_host text, p_chave text'
          AND pg_get_function_result(p.oid) = 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text, estado text)'
     ) THEN
    RAISE EXCEPTION 'POSVOO_20261460000000: corpo, atributos ou dono de resolver_loja_com_estado não são os desta migration';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_v2 AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR NOT has_function_privilege('anon', v_v2, 'EXECUTE')
     OR has_function_privilege('authenticated', v_v2, 'EXECUTE')
     OR has_function_privilege('service_role', v_v2, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261460000000: a ACL de resolver_loja_com_estado não é "só o anon executa"';
  END IF;
  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attname)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = v_lojas AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('estado', 'estado_desde', 'estado_sha'))
     IS DISTINCT FROM 'estado:text:true:''ativa''::text,estado_desde:timestamp with time zone:true:now(),estado_sha:text:false:-'
     OR (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conrelid = v_lojas AND k.conname = 'frota_lojas_estado_check')
     IS DISTINCT FROM 'CHECK ((estado = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])))' THEN
    RAISE EXCEPTION 'POSVOO_20261460000000: as colunas de estado ou o CHECK frota_lojas_estado_check não têm a forma desta migration';
  END IF;
END $posvoo_20261460000000$;

-- A v2 é RPC nova chamada pelo PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';

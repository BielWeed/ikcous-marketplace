-- ============================================================================
-- Migration 20261490000000 — a caderneta confere a chave sem bcrypt por chamada (26/11/2026; caderneta da frota)
-- ============================================================================
--
-- 1. O QUE FALTAVA
--
-- public.resolver_loja (v1) e public.resolver_loja_com_estado (v2) são executáveis pelo anon e conferiam a chave da frota com
-- extensions.crypt(p_chave, fs.hash) (bcrypt custo 10, ~80 ms de CPU medidos, ver o cabeçalho da 20261141) em TODA chamada, antes de
-- olhar o endereço. A chave publicável que abre o PostgREST é pública por natureza: qualquer um chama as duas portas em laço com chave
-- errada e ocupa a CPU do banco central da frota; o porteiro (middleware.ts, src/hospedagem/porteiro.ts) estoura o tempo e TODAS as
-- lojas mostram "em manutenção". O segredo (IKCOUS_FROTA_CHAVE) é aleatório e de alta entropia: a lentidão do bcrypt não protege nada.
--
-- 2. O QUE ESTA MIGRATION FAZ (no banco que guarda a caderneta; nas outras lojas a tabela existe vazia e o efeito é o mesmo)
--
--   a) public.frota_segredo ganha hash_rapido text e hash_rapido_de text (aceitam nulo, sem padrão). Nenhum GRANT: a tabela continua
--      fechada como a 20261480 deixou (nada para PUBLIC, anon, authenticated nem service_role; só o dono).
--   b) As DUAS portas trocam SÓ a conferência da chave; o resto do corpo (o RETURN QUERY de cada uma) é o da 20261460, letra por letra.
--      Assinatura, retorno, SECURITY DEFINER, VOLATILE, search_path vazio, OID, dono e ACL (só o anon executa) não mudam (CREATE OR
--      REPLACE preserva; o pré-voo fotografa e o pós-voo confere). A conferência nova:
--        - lê a linha id = 1 uma vez;
--        - SE hash_rapido existe E hash_rapido_de = hash (o atalho só vale para o hash bcrypt ATUAL: trocar a chave reescreve hash e
--          invalida o atalho sozinho), confere hash_rapido = sha256(p_chave) em hex — microssegundos, nenhum bcrypt;
--        - SENÃO confere pelo bcrypt de sempre e, SÓ se bater, grava hash_rapido = sha256(p_chave) e hash_rapido_de = o hash lido
--          (UPDATE ... WHERE id = 1 AND hash = o lido: atalho de um hash que mudou no meio não é gravado). A gravação nunca espera e
--          nunca falha: só em transação de escrita (GET do PostgREST e réplica são só leitura: confere e não grava) e só se a linha
--          estiver livre (FOR UPDATE SKIP LOCKED: quem a segura, como uma troca de chave ainda aberta, deixa o atalho para a próxima).
--      Chave errada nunca grava nada; NULL ou vazia continua zero linhas, sem erro (sem oráculo "chave errada" vs. "host inexistente").
--      O custo do bcrypt passa a ser pago UMA vez por hash, pela primeira chamada com a chave certa (o porteiro), e não por chamada.
--   O atalho é MAIS estrito que o bcrypt: o bcrypt só olha os primeiros 72 bytes da chave e o sha256 olha a chave inteira. Com uma chave
--   de mais de 72 bytes, só a grafia exata que abriu pelo bcrypt continua valendo (o porteiro manda sempre a mesma variável).
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida ou escrita por comando desta migration (nenhum INSERT, UPDATE ou DELETE; o pré-voo e o pós-voo leem só o
-- catálogo). A linha que já existe em frota_segredo ganha as duas colunas nulas: a primeira chamada com a chave certa paga o bcrypt e
-- grava o atalho; até lá tudo funciona como hoje. frota_lojas não é tocada. Aplicar duas vezes deixa o mesmo estado: ADD COLUMN IF NOT
-- EXISTS não toca coluna que já existe (o atalho gravado é preservado) e o pré-voo aceita os corpos da 20261460 OU os desta migration.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: frota_lojas ou frota_segredo não existirem, ou frota_segredo não tiver a forma da 20261141 (id integer, hash text NOT NULL);
-- extensions.crypt(text, text) ou extensions.digest(text, text) não existirem; a 20261470 (a porta frota_mudar_estado) ou a 20261480 (o
-- service_role sem nada nas duas tabelas) não estiverem aplicadas — elas conferem os corpos da 20261460 no pré-voo, e aplicá-las depois
-- desta seria impossível; resolver_loja ou resolver_loja_com_estado não existirem, tiverem sobrecarga, corpo que não seja o da 20261460
-- nem o desta migration (as duas no MESMO estado), atributos diferentes dos de sempre, ACL que não seja "só o anon executa" ou dono
-- diferente do dono das duas tabelas; as duas colunas novas não estiverem TODAS ausentes ou TODAS com a forma desta migration (estado
-- parcial é recusado); as portas já estiverem com os corpos desta migration sem as colunas.
--
-- 5. TRANSAÇÃO E TRAVAS
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador; pré-voo, colunas, as duas portas e o pós-voo
-- caem juntos ou não caem. lock_timeout de 5 s: o ADD COLUMN pede trava exclusiva de frota_segredo, e as portas leem a tabela a cada
-- endereço novo do porteiro (cache de 60 s); se alguém segurar a tabela por mais de 5 s a migration desiste sem escrever nada (rodar de
-- novo). Coluna nula sem padrão não reescreve a tabela.
--
-- 6. ORDEM E ROLLBACK
--
-- Depois da 20261460000000, da 20261470000000 e da 20261480000000 (o pré-voo recusa sem elas). Aplicar em CADA banco do canal (IKCOUS e
-- Savy) e no banco onde a caderneta de produção mora (IKCOUS_FROTA_URL, hoje o dekxab, pelo MCP). Consultas da publicação: 186b antes,
-- 186a depois. As consultas 182a e 184a aceitam os corpos desta migration como sucessores.
-- ROLLBACK MANUAL: rollback-manual-20261490000000_a_caderneta_confere_a_chave_sem_bcrypt_por_chamada.sql devolve as duas portas BYTE A
-- BYTE aos corpos da 20261460 (o bcrypt em toda chamada) e deixa as colunas e o atalho gravado (os corpos antigos não os leem). Tirar as
-- colunas é o rollback-manual-destrutivo-20261490000000 (só com o dono, depois do comum; o atalho é só uma cópia derivada da chave, a
-- próxima chamada certa o refaz).
--
-- 7. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.resolver_loja(text, text)');
--      -- esperado: 0c60eb13c0016d2129b51def3ec7c255.
--   2. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.resolver_loja_com_estado(text, text)');
--      -- esperado: a30e752cff5ae4edc2db612866eb8bcd.
--   3. SELECT has_table_privilege('anon', 'public.frota_segredo', 'SELECT'), has_table_privilege('service_role', 'public.frota_segredo', 'SELECT'),
--             has_function_privilege('anon', 'public.resolver_loja_com_estado(text, text)', 'EXECUTE');
--      -- esperado: false, false, true.
--   PROVA VIVA: tests/banco/a-caderneta-confere-a-chave-sem-bcrypt-viva.cjs (rpc-ci); portão da release: consultas 186a e 186b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261490000000$
DECLARE
  v_lojas oid := to_regclass('public.frota_lojas');
  v_segredo oid := to_regclass('public.frota_segredo');
  v_v1 oid := to_regprocedure('public.resolver_loja(text, text)');
  v_v2 oid := to_regprocedure('public.resolver_loja_com_estado(text, text)');
  v_hash_v1 text;
  v_hash_v2 text;
  v_colunas integer;
BEGIN
  IF v_lojas IS NULL OR v_segredo IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_lojas ou public.frota_segredo não existe — aplique a 20261141000000 antes.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = v_segredo AND a.attnum > 0 AND NOT a.attisdropped
         AND ((a.attname = 'id' AND a.atttypid = 'integer'::regtype)
           OR (a.attname = 'hash' AND a.atttypid = 'text'::regtype AND a.attnotnull))) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_segredo não tem a forma da 20261141000000 (id integer, hash text NOT NULL) — meça o banco e revise.';
  END IF;
  IF to_regprocedure('extensions.crypt(text, text)') IS NULL OR to_regprocedure('extensions.digest(text, text)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: extensions.crypt(text, text) ou extensions.digest(text, text) não existe (pgcrypto no schema extensions) — a porta da chave não funcionaria.';
  END IF;
  -- A 20261470 e a 20261480 conferem os corpos da 20261460 no pré-voo delas: depois desta, nenhuma das duas aplicaria mais.
  IF to_regprocedure('public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a 20261470000000 não está aplicada (public.frota_mudar_estado ausente) — aplique-a antes.';
  END IF;
  IF to_regrole('service_role') IS NULL
     OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)
                  AND (has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                       OR has_any_column_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a 20261480000000 não está aplicada (o service_role ainda alcança frota_lojas ou frota_segredo) — aplique-a antes.';
  END IF;

  -- As duas portas: uma só cada, os corpos da 20261460 (primeira vez) ou os desta migration (reaplicação), as duas no MESMO estado.
  IF v_v1 IS NULL OR v_v2 IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_loja ou resolver_loja_com_estado ausente — aplique a 20261460000000 antes.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado')) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_loja ou resolver_loja_com_estado tem sobrecarga em public — meça o banco e revise.';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash_v1 FROM pg_proc p WHERE p.oid = v_v1;
  SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash_v2 FROM pg_proc p WHERE p.oid = v_v2;
  IF NOT ((v_hash_v1 = '19072d99f3253583342a0bb6c42447dd' AND v_hash_v2 = '92682af1143806d3662411b6d5788096')  -- corpos da 20261460000000
       OR (v_hash_v1 = '0c60eb13c0016d2129b51def3ec7c255' AND v_hash_v2 = 'a30e752cff5ae4edc2db612866eb8bcd')) THEN -- desta (reaplicação)
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpos vivos de resolver_loja (hash %) e resolver_loja_com_estado (hash %) não são os da 20261460000000 nem os desta migration — capture os corpos vivos e revise.', COALESCE(v_hash_v1, 'ausente'), COALESCE(v_hash_v2, 'ausente');
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid IN (v_v1, v_v2)
         AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
         AND p.proconfig = ARRAY['search_path=""']::text[]
         AND pg_get_function_arguments(p.oid) = 'p_host text, p_chave text'
         AND pg_get_function_result(p.oid) = CASE WHEN p.oid = v_v1
               THEN 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text)'
               ELSE 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text, estado text)' END) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de resolver_loja ou resolver_loja_com_estado (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os da 20261460000000 — meça o banco e revise.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid IN (v_v1, v_v2) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR NOT has_function_privilege('anon', v_v1, 'EXECUTE') OR NOT has_function_privilege('anon', v_v2, 'EXECUTE')
     OR has_function_privilege('authenticated', v_v1, 'EXECUTE') OR has_function_privilege('authenticated', v_v2, 'EXECUTE')
     OR has_function_privilege('service_role', v_v1, 'EXECUTE') OR has_function_privilege('service_role', v_v2, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a ACL de resolver_loja ou resolver_loja_com_estado não é "só o anon executa" — meça o banco e revise.';
  END IF;
  -- SECURITY DEFINER lê e grava a caderneta como o dono: o dono das duas portas tem de ser o dono das duas tabelas.
  IF (SELECT count(DISTINCT d) FROM (
        SELECT p.proowner AS d FROM pg_proc p WHERE p.oid IN (v_v1, v_v2)
        UNION ALL SELECT c.relowner FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)) x) <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o dono de frota_lojas, frota_segredo, resolver_loja e resolver_loja_com_estado não é o mesmo — meça o banco e revise.';
  END IF;

  -- Colunas novas: as duas ausentes (primeira vez, ou depois do destrutivo) ou as duas com a forma desta migration. Nada no meio.
  SELECT count(*) INTO v_colunas FROM pg_attribute a
   WHERE a.attrelid = v_segredo AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('hash_rapido', 'hash_rapido_de');
  IF v_colunas = 0 THEN
    IF v_hash_v1 = '0c60eb13c0016d2129b51def3ec7c255' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: as portas já estão com os corpos desta migration, mas frota_segredo não tem hash_rapido — estado desconhecido, revise.';
    END IF;
  ELSIF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                           || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') || ':' || COALESCE(a.attacl::text, '-'), ',' ORDER BY a.attname)
           FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = v_segredo AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('hash_rapido', 'hash_rapido_de'))
        IS DISTINCT FROM 'hash_rapido:text:false:-:-,hash_rapido_de:text:false:-:-' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: frota_segredo tem só parte das colunas hash_rapido/hash_rapido_de, ou com outra forma — meça o banco e revise.';
  END IF;

  -- Fotografia do que esta migration não pode mudar: as duas portas sem o texto (OID, dono, ACL, atributos) e as duas tabelas (ACL,
  -- RLS, políticas, restrições, gatilhos e as colunas de antes).
  PERFORM set_config('ikcous.chave1490_base', (
    SELECT jsonb_build_object(
      'portas', (SELECT jsonb_agg(to_jsonb(p) - 'prosrc' ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN (v_v1, v_v2)),
      'tabelas', (SELECT jsonb_agg(jsonb_build_array(c.relname, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity) ORDER BY c.relname)
                    FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)),
      'colunas', (SELECT jsonb_agg(jsonb_build_array(a.attrelid, a.attname, a.atttypid, a.attnotnull, a.attacl) ORDER BY a.attrelid, a.attnum)
                    FROM pg_attribute a WHERE a.attrelid IN (v_lojas, v_segredo) AND a.attnum > 0 AND NOT a.attisdropped
                     AND a.attname NOT IN ('hash_rapido', 'hash_rapido_de')),
      'restricoes', (SELECT jsonb_agg(k.conname || '=' || pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k
                      WHERE k.conrelid IN (v_lojas, v_segredo)),
      'politicas', (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN (v_lojas, v_segredo)),
      'gatilhos', (SELECT jsonb_agg(jsonb_build_array(t.tgname, t.tgfoid, t.tgtype, t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t
                    WHERE t.tgrelid IN (v_lojas, v_segredo))))::text, true);
END $preflight_20261490000000$;

-- O atalho da chave: nasce nulo; só as duas portas o gravam (como o dono), e só depois da chave certa abrir pelo bcrypt.
ALTER TABLE public.frota_segredo
  ADD COLUMN IF NOT EXISTS hash_rapido text,
  ADD COLUMN IF NOT EXISTS hash_rapido_de text;

-- v1: a conferência nova + o RETURN QUERY da 20261460000000, letra por letra.
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
DECLARE
  v_hash text;
  v_rapido text;
  v_rapido_de text;
BEGIN
  -- 20261490000000: o bcrypt roda UMA vez por hash (a primeira chamada com a chave certa grava o atalho); dali em diante a conferência
  -- é um sha256. O atalho só vale para o hash bcrypt ATUAL: trocar a chave reescreve hash e o invalida sozinho.
  SELECT fs.hash, fs.hash_rapido, fs.hash_rapido_de INTO v_hash, v_rapido, v_rapido_de
    FROM public.frota_segredo fs
   WHERE fs.id = 1;
  IF v_rapido IS NOT NULL AND v_rapido_de = v_hash THEN
    IF v_rapido IS DISTINCT FROM encode(extensions.digest(p_chave, 'sha256'), 'hex') THEN
      RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"
    END IF;
  ELSE
    IF v_hash IS NULL OR v_hash IS DISTINCT FROM extensions.crypt(p_chave, v_hash) THEN
      RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"
    END IF;
    -- A chave certa abriu pelo bcrypt: grava o atalho deste hash. Nunca espera (SKIP LOCKED) nem falha em transação só de leitura.
    IF current_setting('transaction_read_only') = 'off' THEN
      PERFORM 1 FROM public.frota_segredo fs WHERE fs.id = 1 AND fs.hash = v_hash FOR UPDATE SKIP LOCKED;
      IF FOUND THEN
        UPDATE public.frota_segredo fs
           SET hash_rapido = encode(extensions.digest(p_chave, 'sha256'), 'hex'),
               hash_rapido_de = v_hash
         WHERE fs.id = 1
           AND fs.hash = v_hash;
      END IF;
    END IF;
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

-- v2: a mesma conferência nova + o RETURN QUERY da 20261460000000, letra por letra.
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
DECLARE
  v_hash text;
  v_rapido text;
  v_rapido_de text;
BEGIN
  -- 20261490000000: o bcrypt roda UMA vez por hash (a primeira chamada com a chave certa grava o atalho); dali em diante a conferência
  -- é um sha256. O atalho só vale para o hash bcrypt ATUAL: trocar a chave reescreve hash e o invalida sozinho.
  SELECT fs.hash, fs.hash_rapido, fs.hash_rapido_de INTO v_hash, v_rapido, v_rapido_de
    FROM public.frota_segredo fs
   WHERE fs.id = 1;
  IF v_rapido IS NOT NULL AND v_rapido_de = v_hash THEN
    IF v_rapido IS DISTINCT FROM encode(extensions.digest(p_chave, 'sha256'), 'hex') THEN
      RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"
    END IF;
  ELSE
    IF v_hash IS NULL OR v_hash IS DISTINCT FROM extensions.crypt(p_chave, v_hash) THEN
      RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"
    END IF;
    -- A chave certa abriu pelo bcrypt: grava o atalho deste hash. Nunca espera (SKIP LOCKED) nem falha em transação só de leitura.
    IF current_setting('transaction_read_only') = 'off' THEN
      PERFORM 1 FROM public.frota_segredo fs WHERE fs.id = 1 AND fs.hash = v_hash FOR UPDATE SKIP LOCKED;
      IF FOUND THEN
        UPDATE public.frota_segredo fs
           SET hash_rapido = encode(extensions.digest(p_chave, 'sha256'), 'hex'),
               hash_rapido_de = v_hash
         WHERE fs.id = 1
           AND fs.hash = v_hash;
      END IF;
    END IF;
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

DO $posvoo_20261490000000$
DECLARE
  v_lojas oid := to_regclass('public.frota_lojas');
  v_segredo oid := to_regclass('public.frota_segredo');
  v_v1 oid := to_regprocedure('public.resolver_loja(text, text)');
  v_v2 oid := to_regprocedure('public.resolver_loja_com_estado(text, text)');
BEGIN
  IF (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_v1) IS DISTINCT FROM '0c60eb13c0016d2129b51def3ec7c255'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_v2) IS DISTINCT FROM 'a30e752cff5ae4edc2db612866eb8bcd' THEN
    RAISE EXCEPTION 'POSVOO_20261490000000: os corpos de resolver_loja e resolver_loja_com_estado não são os desta migration';
  END IF;
  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                        || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') || ':' || COALESCE(a.attacl::text, '-'), ',' ORDER BY a.attname)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = v_segredo AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('hash_rapido', 'hash_rapido_de'))
     IS DISTINCT FROM 'hash_rapido:text:false:-:-,hash_rapido_de:text:false:-:-' THEN
    RAISE EXCEPTION 'POSVOO_20261490000000: as colunas hash_rapido e hash_rapido_de não têm a forma desta migration';
  END IF;
  -- Ninguém além do dono alcança a caderneta (a 20261480 fechou o service_role; nada aqui abre).
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)
               AND (EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee = 0)
                    OR has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                    OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                    OR has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                    OR has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
                    OR has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
                    OR has_any_column_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))) THEN
    RAISE EXCEPTION 'POSVOO_20261490000000: PUBLIC, anon, authenticated ou service_role alcança frota_lojas ou frota_segredo';
  END IF;
  IF (SELECT jsonb_build_object(
        'portas', (SELECT jsonb_agg(to_jsonb(p) - 'prosrc' ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN (v_v1, v_v2)),
        'tabelas', (SELECT jsonb_agg(jsonb_build_array(c.relname, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity) ORDER BY c.relname)
                      FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)),
        'colunas', (SELECT jsonb_agg(jsonb_build_array(a.attrelid, a.attname, a.atttypid, a.attnotnull, a.attacl) ORDER BY a.attrelid, a.attnum)
                      FROM pg_attribute a WHERE a.attrelid IN (v_lojas, v_segredo) AND a.attnum > 0 AND NOT a.attisdropped
                       AND a.attname NOT IN ('hash_rapido', 'hash_rapido_de')),
        'restricoes', (SELECT jsonb_agg(k.conname || '=' || pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k
                        WHERE k.conrelid IN (v_lojas, v_segredo)),
        'politicas', (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN (v_lojas, v_segredo)),
        'gatilhos', (SELECT jsonb_agg(jsonb_build_array(t.tgname, t.tgfoid, t.tgtype, t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t
                      WHERE t.tgrelid IN (v_lojas, v_segredo))))
     IS DISTINCT FROM current_setting('ikcous.chave1490_base')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261490000000: algo além do texto das portas e das duas colunas novas mudou (OID, dono, ACL, atributos, tabelas, restrições, políticas ou gatilhos)';
  END IF;
END $posvoo_20261490000000$;

-- frota_segredo ganhou colunas: recarrega o schema cache do PostgREST. Idempotente.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Migration 20261470000000 — a loja muda de estado só pela porta (plano L8, Lote 4, 26/11/2026; caderneta da frota)
-- ============================================================================
--
-- 1. O QUE FALTAVA
--
-- A 20261460000000 deu a cada loja da caderneta (public.frota_lojas) um estado de vida: ativa, adormecida ou encerrada. Mas qualquer
-- UPDATE direto mudava esse estado sem conferir nada: adormecer a IKCOUS ou a Savy por engano (as duas lojas que nunca dormem), acordar
-- uma loja cujo banco não recebeu as releases em que ela dormiu, encerrar uma loja sem ordem escrita, e nada ficava registrado (quem,
-- quando, por quê, em qual release).
--
-- 2. O QUE ESTA MIGRATION FAZ (só no banco que guarda a caderneta; nas outras lojas a tabela existe vazia e o efeito é o mesmo)
--
--   a) public.frota_estado_historico (nova): uma linha por mudança de estado (loja_id, project_ref, de, para, sha da release, motivo,
--      quem = session_user, em = now()). RLS ligada, NENHUMA política, nenhum privilégio para PUBLIC, anon, authenticated nem
--      service_role (tabela e sequência do id): só o dono lê e escreve.
--   b) public.frota_mudar_estado(p_id, p_ref, p_de, p_para, p_sha, p_base, p_motivo, p_confirmacao, p_valido_ate): a PORTA. SECURITY
--      INVOKER, search_path vazio, EXECUTE só do dono (o REVOKE fecha o ALTER DEFAULT PRIVILEGES do schema public, ver o cabeçalho da
--      20261141). Recusa, sem escrever nada: instrução vencida (agora > p_valido_ate) ou com validade de mais de 1 h; estado de destino
--      fora dos três; de = para; sha que não é 40 hex minúsculos; motivo vazio ou com mais de 200 caracteres; encerrar sem
--      p_confirmacao = 'ENCERRAR <id>'; loja que não existe com aquele id E aquele ref; estado atual diferente de p_de (a mensagem diz o
--      atual); sair de encerrada sem p_confirmacao = 'REABRIR <id>'; voltar a ativa com estado_sha diferente de p_base (a release em que a
--      loja dormiu, que o comando usou para conferir a prontidão). Passando tudo: tranca a linha (FOR UPDATE), troca SÓ estado,
--      estado_desde e estado_sha, grava UMA linha no histórico e devolve id, nome, dominio_publico, estado, estado_desde e estado_sha.
--      Quem gera a chamada é scripts/frota/estado-da-loja.mjs (validade de 30 minutos); roteiro: docs/runbooks/estado-de-vida-da-loja.md.
--   c) gatilho frota_lojas_estado_so_pela_porta (BEFORE INSERT OR UPDATE OF estado, estado_desde, estado_sha, project_ref, por linha):
--      recusa estado diferente de ativa para os refs cafkrminfnokvgjqtkle (IKCOUS) e gnjsrucsmjkajijrakzr (Savy) — os mesmos de
--      scripts/frota/politica.json lojasQueNuncaDormem —, mesmo pela porta; recusa loja que NASCE fora de ativa e qualquer troca de
--      estado, estado_desde ou estado_sha fora da porta (a porta liga ikcous.frota_estado_pela_porta só durante o próprio UPDATE).
--      UPDATE de outras colunas (rotação da publishable_key, troca de supabase_url, nome, domínio, ativa) não dispara o gatilho.
--      A trava é contra ENGANO, não contra o dono do banco: quem tem UPDATE na tabela e sabe o nome da variável consegue ligá-la à mão.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é escrita, apagada ou reescrita por comando desta migration (nenhum INSERT, UPDATE ou DELETE). As lojas que já existem
-- ficam com o estado que têm (depois da 20261460, todas ativas); o histórico nasce vazio (a primeira linha é a primeira mudança pela
-- porta). frota_segredo e as duas portas da caderneta (resolver_loja e resolver_loja_com_estado) não são tocadas. O pré-voo LÊ as linhas
-- só para recusar se a IKCOUS ou a Savy já estiverem fora de ativa (o gatilho nasceria com uma delas presa num estado que ele proíbe) ou
-- se houver loja fora de ativa sem estado_sha de 40 hex (a porta exige essa base para acordá-la: ela ficaria presa).
-- Aplicar duas vezes deixa o mesmo estado: CREATE TABLE IF NOT EXISTS não toca a tabela que existe (nem as linhas do histórico), as
-- funções voltam com o mesmo corpo e o pré-voo só aceita objetos ausentes ou idênticos aos desta migration.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a 20261460000000 não estiver aplicada (as três colunas de estado e o CHECK com a forma dela, a resolver_loja e a
-- resolver_loja_com_estado com os corpos dela); a IKCOUS ou a Savy estiverem fora de ativa; houver loja fora de ativa sem estado_sha de
-- 40 hex; a porta, a função do gatilho e o gatilho não estiverem TODOS ausentes ou TODOS idênticos aos desta migration (corpo,
-- atributos, ACL, eventos e colunas do gatilho; sobrecarga também recusa); a tabela do histórico existir com outra forma (colunas,
-- CHECKs, chave, RLS, política, privilégio na tabela ou na sequência).
-- A tabela pode existir sem a porta e sem o gatilho: é o que o rollback comum deixa (ele preserva o histórico), e reaplicar volta tudo.
--
-- 5. TRANSAÇÃO E TRAVAS
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador; pré-voo, tabela, funções, gatilho e pós-voo
-- caem juntos ou não caem. lock_timeout de 5 s: CREATE TRIGGER pede trava SHARE ROW EXCLUSIVE em frota_lojas (o porteiro só LÊ a
-- tabela, e leitura não bloqueia essa trava; quem a bloqueia é escrita longa na caderneta); se esperar mais de 5 s, a migration desiste sem
-- escrever nada (rodar de novo).
--
-- 6. ORDEM E ROLLBACK
--
-- Depois da 20261460000000 (o pré-voo recusa sem ela). Aplicar em CADA banco do canal (IKCOUS e Savy) e no banco onde a caderneta de
-- produção mora (IKCOUS_FROTA_URL), ANTES de usar scripts/frota/estado-da-loja.mjs. Consultas da publicação: 183b antes, 183a depois.
-- ROLLBACK MANUAL: rollback-manual-20261470000000_a_loja_muda_de_estado_so_pela_porta.sql tira o gatilho, a função do gatilho e a porta
-- e PRESERVA o histórico (a tabela e as linhas). Apagar o histórico é o rollback-manual-destrutivo-20261470000000 (só com o dono, depois
-- do comum). O rollback-manual-destrutivo-20261460000000 (que tira as colunas de estado) só roda DEPOIS do rollback comum DESTA: o
-- gatilho depende das colunas e o Postgres recusa tirá-las com ele no ar.
--
-- 7. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)');
--      -- esperado: 887317817697251468a3ffb12b710e61.
--   2. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.frota_lojas_estado_so_pela_porta()');
--      -- esperado: 58d85afbab0acb79eef70d03c304fb80.
--   3. SELECT has_function_privilege('anon', 'public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)', 'EXECUTE'),
--             has_function_privilege('authenticated', 'public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)', 'EXECUTE'),
--             has_function_privilege('service_role', 'public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)', 'EXECUTE');
--      -- esperado: false, false, false.
--   PROVA VIVA: tests/banco/a-loja-muda-de-estado-so-pela-porta-viva.cjs (rpc-ci); portão da release: consultas 183a e 183b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261470000000$
DECLARE
  v_lojas oid := to_regclass('public.frota_lojas');
  v_hist oid := to_regclass('public.frota_estado_historico');
  v_porta oid := to_regprocedure('public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)');
  v_gatilho_fn oid := to_regprocedure('public.frota_lojas_estado_so_pela_porta()');
  v_dono oid;
  v_seq oid;
  v_gatilhos integer;
  v_presentes integer;
BEGIN
  -- A 20261460000000 aplicada: as três colunas e o CHECK com a forma dela, e as duas portas da caderneta com os corpos dela.
  IF v_lojas IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_lojas não existe — aplique a 20261141000000 e a 20261460000000 antes.';
  END IF;
  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attname)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = v_lojas AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('estado', 'estado_desde', 'estado_sha', 'project_ref'))
     IS DISTINCT FROM 'estado:text:true:''ativa''::text,estado_desde:timestamp with time zone:true:now(),estado_sha:text:false:-,project_ref:text:true:-'
     OR (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conrelid = v_lojas AND k.conname = 'frota_lojas_estado_check')
        IS DISTINCT FROM 'CHECK ((estado = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])))'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.resolver_loja(text, text)'))
        IS DISTINCT FROM '19072d99f3253583342a0bb6c42447dd'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.resolver_loja_com_estado(text, text)'))
        IS DISTINCT FROM '92682af1143806d3662411b6d5788096' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a 20261460000000 não está aplicada como esperado (colunas estado/estado_desde/estado_sha, CHECK frota_lojas_estado_check, resolver_loja e resolver_loja_com_estado) — aplique-a antes ou meça o banco.';
  END IF;
  SELECT c.relowner INTO v_dono FROM pg_class c WHERE c.oid = v_lojas;

  -- As lojas que nunca dormem (scripts/frota/politica.json lojasQueNuncaDormem) têm de estar ativas: o gatilho as prende em ativa.
  IF EXISTS (SELECT 1 FROM public.frota_lojas fl
              WHERE fl.project_ref IN ('cafkrminfnokvgjqtkle', 'gnjsrucsmjkajijrakzr') AND fl.estado <> 'ativa') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a IKCOUS ou a Savy está fora de ativa na caderneta — acorde-a antes (é incidente, não decisão).';
  END IF;
  -- Loja fora do ar sem a release de referência (estado_sha de 40 hex) nunca acordaria pela porta (ela exige a base): meça antes.
  IF EXISTS (SELECT 1 FROM public.frota_lojas fl
              WHERE fl.estado <> 'ativa' AND (fl.estado_sha IS NULL OR fl.estado_sha !~ '^[0-9a-f]{40}$')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: há loja fora de ativa sem a release de referência (estado_sha de 40 hex) — a porta não teria como acordá-la; meça a caderneta e revise.';
  END IF;

  -- Porta, função do gatilho e gatilho: todos ausentes (primeira vez ou depois do rollback comum) ou todos idênticos (reaplicação).
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('frota_mudar_estado', 'frota_lojas_estado_so_pela_porta'))
     <> (CASE WHEN v_porta IS NULL THEN 0 ELSE 1 END) + (CASE WHEN v_gatilho_fn IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: frota_mudar_estado ou frota_lojas_estado_so_pela_porta existe com outra assinatura ou com sobrecarga — meça o banco e revise.';
  END IF;
  SELECT count(*) INTO v_gatilhos FROM pg_trigger t WHERE t.tgrelid = v_lojas AND t.tgname = 'frota_lojas_estado_so_pela_porta' AND NOT t.tgisinternal;
  v_presentes := (CASE WHEN v_porta IS NULL THEN 0 ELSE 1 END) + (CASE WHEN v_gatilho_fn IS NULL THEN 0 ELSE 1 END) + v_gatilhos;
  IF v_presentes NOT IN (0, 3) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: só parte da porta (frota_mudar_estado, a função do gatilho e o gatilho frota_lojas_estado_so_pela_porta) existe — estado desconhecido, meça o banco e revise.';
  END IF;
  IF v_presentes = 3 AND (
       NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_porta AND md5(replace(p.prosrc, E'\r', '')) = '887317817697251468a3ffb12b710e61'
            AND l.lanname = 'plpgsql' AND NOT p.prosecdef AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
            AND p.proowner = v_dono AND p.proconfig = ARRAY['search_path=""']::text[]
            AND pg_get_function_result(p.oid) = 'TABLE(id text, nome text, dominio_publico text, estado text, estado_desde timestamp with time zone, estado_sha text)')
       OR NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_gatilho_fn AND md5(replace(p.prosrc, E'\r', '')) = '58d85afbab0acb79eef70d03c304fb80'
            AND l.lanname = 'plpgsql' AND NOT p.prosecdef AND p.prorettype = 'trigger'::regtype
            AND p.proowner = v_dono AND p.proconfig = ARRAY['search_path=""']::text[])
       OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                   WHERE p.oid IN (v_porta, v_gatilho_fn) AND g.privilege_type = 'EXECUTE' AND g.grantee <> p.proowner)
       OR NOT EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = v_lojas AND t.tgname = 'frota_lojas_estado_so_pela_porta' AND NOT t.tgisinternal
            AND t.tgfoid = v_gatilho_fn AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL
            AND (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
                  WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])) = 'estado,estado_desde,estado_sha,project_ref')
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a porta, a função do gatilho ou o gatilho frota_lojas_estado_so_pela_porta já existem e não são os desta migration (corpo, atributos, dono, ACL, eventos ou colunas) — meça o banco e revise.';
  END IF;

  -- Histórico: ausente, ou com a forma exata desta migration (o rollback comum o preserva com as linhas).
  IF v_hist IS NOT NULL THEN
    SELECT s.oid INTO v_seq FROM pg_class s WHERE s.oid = to_regclass(pg_get_serial_sequence('public.frota_estado_historico', 'id'));
    IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || a.attidentity::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attnum)
          FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = v_hist AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'id:bigint:true:a:-,loja_id:text:true::-,project_ref:text:true::-,de:text:true::-,para:text:true::-,sha:text:true::-,motivo:text:true::-,quem:text:true::SESSION_USER,em:timestamp with time zone:true::now()'
       OR (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = v_hist)
       IS DISTINCT FROM 'frota_estado_historico_estados_check=CHECK (((de = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])) AND (para = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])) AND (de <> para))) | frota_estado_historico_motivo_check=CHECK (((btrim(motivo) <> ''''::text) AND (char_length(motivo) <= 200))) | frota_estado_historico_pkey=PRIMARY KEY (id) | frota_estado_historico_sha_check=CHECK ((sha ~ ''^[0-9a-f]{40}$''::text))'
       OR NOT (SELECT c.relrowsecurity AND c.relkind = 'r' AND c.relowner = v_dono FROM pg_class c WHERE c.oid = v_hist)
       OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = v_hist)
       OR v_seq IS NULL
       OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) g
                   WHERE c.oid IN (v_hist, v_seq) AND g.grantee <> c.relowner)
       OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_hist AND a.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_estado_historico já existe com outra forma (colunas, CHECKs, chave, RLS, política ou privilégio na tabela ou na sequência) — meça o banco e revise.';
    END IF;
  ELSIF v_presentes = 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a porta e o gatilho existem mas public.frota_estado_historico não — estado desconhecido, meça o banco e revise.';
  END IF;

  -- Fotografia do que esta migration não pode mudar: frota_lojas (colunas, CHECKs, dono, ACL) e as duas portas da caderneta.
  PERFORM set_config('ikcous.porta1470_base', (
    SELECT jsonb_build_object(
      'lojas', (SELECT to_jsonb(c) - 'reltuples' - 'relpages' - 'relallvisible' - 'relhastriggers' FROM pg_class c WHERE c.oid = v_lojas),
      'colunas', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = v_lojas AND a.attnum > 0),
      'checks', (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = v_lojas),
      'portas', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.proname) FROM pg_proc p
                  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado'))))::text, true);
END $preflight_20261470000000$;

CREATE TABLE IF NOT EXISTS public.frota_estado_historico (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loja_id text NOT NULL,
  project_ref text NOT NULL,
  de text NOT NULL,
  para text NOT NULL,
  sha text NOT NULL,
  motivo text NOT NULL,
  quem text NOT NULL DEFAULT session_user,
  em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT frota_estado_historico_estados_check CHECK (
    de IN ('ativa', 'adormecida', 'encerrada') AND para IN ('ativa', 'adormecida', 'encerrada') AND de <> para
  ),
  CONSTRAINT frota_estado_historico_sha_check CHECK (sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT frota_estado_historico_motivo_check CHECK (btrim(motivo) <> '' AND char_length(motivo) <= 200)
);

-- O ALTER DEFAULT PRIVILEGES do schema public (ver o cabeçalho da 20261141) daria tudo a anon, authenticated e service_role na tabela,
-- na sequência do id e nas funções: os REVOKE fecham. Revogar o já revogado é no-op.
ALTER TABLE public.frota_estado_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.frota_estado_historico FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.frota_estado_historico_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- O gatilho: IKCOUS e Savy nunca saem de ativa; estado, estado_desde e estado_sha só mudam pela porta.
CREATE OR REPLACE FUNCTION public.frota_lojas_estado_so_pela_porta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Os refs de scripts/frota/politica.json lojasQueNuncaDormem (IKCOUS e Savy): nem a porta as tira de ativa.
  IF NEW.project_ref IN ('cafkrminfnokvgjqtkle', 'gnjsrucsmjkajijrakzr') AND NEW.estado IS DISTINCT FROM 'ativa' THEN
    RAISE EXCEPTION 'FROTA_ESTADO_LOJA_QUE_NUNCA_DORME: a loja % (ref %) nunca sai de ativa (scripts/frota/politica.json lojasQueNuncaDormem).', NEW.id, NEW.project_ref;
  END IF;
  IF COALESCE(current_setting('ikcous.frota_estado_pela_porta', true), '') = 'sim' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado IS DISTINCT FROM 'ativa' THEN
      RAISE EXCEPTION 'FROTA_ESTADO_SO_PELA_PORTA: a loja % nasce ativa; para mudar o estado use public.frota_mudar_estado (scripts/frota/estado-da-loja.mjs).', NEW.id;
    END IF;
  ELSIF NEW.estado IS DISTINCT FROM OLD.estado
     OR NEW.estado_desde IS DISTINCT FROM OLD.estado_desde
     OR NEW.estado_sha IS DISTINCT FROM OLD.estado_sha THEN
    RAISE EXCEPTION 'FROTA_ESTADO_SO_PELA_PORTA: o estado da loja % só muda por public.frota_mudar_estado (scripts/frota/estado-da-loja.mjs).', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

-- A porta: confere tudo, tranca a linha, troca só o estado e deixa o rastro.
CREATE OR REPLACE FUNCTION public.frota_mudar_estado(
  p_id text,
  p_ref text,
  p_de text,
  p_para text,
  p_sha text,
  p_base text,
  p_motivo text,
  p_confirmacao text,
  p_valido_ate timestamptz
)
RETURNS TABLE (
  id text,
  nome text,
  dominio_publico text,
  estado text,
  estado_desde timestamptz,
  estado_sha text
)
LANGUAGE plpgsql
SECURITY INVOKER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_atual text;
  v_sha_atual text;
BEGIN
  IF p_valido_ate IS NULL OR clock_timestamp() > p_valido_ate THEN
    RAISE EXCEPTION 'FROTA_ESTADO_INSTRUCAO_VENCIDA: a instrução valia até % — gere outra com scripts/frota/estado-da-loja.mjs.', p_valido_ate;
  END IF;
  IF p_valido_ate > clock_timestamp() + interval '1 hour' THEN
    RAISE EXCEPTION 'FROTA_ESTADO_VALIDADE_LONGA: a instrução vale até %, mais de 1 hora a partir de agora — gere outra com scripts/frota/estado-da-loja.mjs.', p_valido_ate;
  END IF;
  IF p_para IS NULL OR p_para NOT IN ('ativa', 'adormecida', 'encerrada') THEN
    RAISE EXCEPTION 'FROTA_ESTADO_DESCONHECIDO: o estado de destino % não é ativa, adormecida nem encerrada.', COALESCE(p_para, 'NULL');
  END IF;
  IF p_de IS NOT DISTINCT FROM p_para THEN
    RAISE EXCEPTION 'FROTA_ESTADO_SEM_MUDANCA: de e para são o mesmo estado (%).', p_para;
  END IF;
  IF p_sha IS NULL OR p_sha !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'FROTA_ESTADO_SHA_INVALIDO: o sha da release tem de ter 40 caracteres hexadecimais minúsculos.';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' OR char_length(p_motivo) > 200 THEN
    RAISE EXCEPTION 'FROTA_ESTADO_MOTIVO: o motivo é obrigatório e tem no máximo 200 caracteres.';
  END IF;
  IF p_para = 'encerrada' AND p_confirmacao IS DISTINCT FROM 'ENCERRAR ' || p_id THEN
    RAISE EXCEPTION 'FROTA_ESTADO_ENCERRAR_SEM_CONFIRMACAO: encerrar a loja % exige a confirmação ENCERRAR %.', p_id, p_id;
  END IF;

  -- id é a chave de frota_lojas: no máximo uma linha; o ref tem de ser o dela. FOR UPDATE: duas chamadas ao mesmo tempo esperam uma pela
  -- outra, e a segunda relê o estado já trocado (e cai na conferência de p_de logo abaixo).
  SELECT fl.estado, fl.estado_sha INTO v_atual, v_sha_atual
    FROM public.frota_lojas fl
   WHERE fl.id = p_id AND fl.project_ref = p_ref
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FROTA_ESTADO_LOJA_NAO_ENCONTRADA: nenhuma loja com id % e ref % na caderneta.', COALESCE(p_id, 'NULL'), COALESCE(p_ref, 'NULL');
  END IF;
  IF v_atual IS DISTINCT FROM p_de THEN
    RAISE EXCEPTION 'FROTA_ESTADO_DIVERGENTE: a loja % está %, não % — confira com scripts/frota/estado-da-loja.mjs --ver.', p_id, v_atual, COALESCE(p_de, 'NULL');
  END IF;
  IF v_atual = 'encerrada' AND p_confirmacao IS DISTINCT FROM 'REABRIR ' || p_id THEN
    RAISE EXCEPTION 'FROTA_ESTADO_REABRIR_SEM_CONFIRMACAO: tirar a loja % de encerrada exige a confirmação REABRIR %.', p_id, p_id;
  END IF;
  IF p_para = 'ativa' AND (p_base IS NULL OR v_sha_atual IS DISTINCT FROM p_base) THEN
    RAISE EXCEPTION 'FROTA_ESTADO_BASE_DIVERGENTE: a loja % saiu do ar na release %, não na % — confira a prontidão com a base certa antes de acordar.', p_id, COALESCE(v_sha_atual, 'NULL'), COALESCE(p_base, 'NULL');
  END IF;

  -- A variável vale só durante o UPDATE (o gatilho a lê) e é desligada logo depois, na mesma transação.
  PERFORM set_config('ikcous.frota_estado_pela_porta', 'sim', true);
  RETURN QUERY
    WITH mudou AS (
      UPDATE public.frota_lojas fl
         SET estado = p_para, estado_desde = now(), estado_sha = p_sha
       WHERE fl.id = p_id AND fl.project_ref = p_ref
      RETURNING fl.id, fl.nome, fl.dominio_publico, fl.estado, fl.estado_desde, fl.estado_sha
    )
    SELECT m.id, m.nome, m.dominio_publico, m.estado, m.estado_desde, m.estado_sha FROM mudou m;
  PERFORM set_config('ikcous.frota_estado_pela_porta', '', true);

  INSERT INTO public.frota_estado_historico (loja_id, project_ref, de, para, sha, motivo)
  VALUES (p_id, p_ref, p_de, p_para, p_sha, p_motivo);
END;
$$;

REVOKE ALL ON FUNCTION public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.frota_lojas_estado_so_pela_porta() FROM PUBLIC, anon, authenticated, service_role;

-- CREATE OR REPLACE TRIGGER (PostgreSQL 14+): reaplicar não duplica; o pré-voo já garantiu que, se existe, é este.
CREATE OR REPLACE TRIGGER frota_lojas_estado_so_pela_porta
  BEFORE INSERT OR UPDATE OF estado, estado_desde, estado_sha, project_ref ON public.frota_lojas
  FOR EACH ROW EXECUTE FUNCTION public.frota_lojas_estado_so_pela_porta();

DO $posvoo_20261470000000$
DECLARE
  v_lojas oid := to_regclass('public.frota_lojas');
  v_hist oid := to_regclass('public.frota_estado_historico');
  v_porta oid := to_regprocedure('public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)');
  v_gatilho_fn oid := to_regprocedure('public.frota_lojas_estado_so_pela_porta()');
  v_seq oid := to_regclass(pg_get_serial_sequence('public.frota_estado_historico', 'id'));
  v_dono oid := (SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.frota_lojas'));
BEGIN
  IF v_hist IS NULL OR v_porta IS NULL OR v_gatilho_fn IS NULL OR v_seq IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261470000000: a tabela do histórico, a sequência dela, a porta ou a função do gatilho está ausente';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_porta AND md5(replace(p.prosrc, E'\r', '')) = '887317817697251468a3ffb12b710e61'
          AND l.lanname = 'plpgsql' AND NOT p.prosecdef AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
          AND p.proowner = v_dono AND p.proconfig = ARRAY['search_path=""']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_id text, p_ref text, p_de text, p_para text, p_sha text, p_base text, p_motivo text, p_confirmacao text, p_valido_ate timestamp with time zone'
          AND pg_get_function_result(p.oid) = 'TABLE(id text, nome text, dominio_publico text, estado text, estado_desde timestamp with time zone, estado_sha text)') THEN
    RAISE EXCEPTION 'POSVOO_20261470000000: corpo, atributos ou dono de frota_mudar_estado não são os desta migration';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_gatilho_fn AND md5(replace(p.prosrc, E'\r', '')) = '58d85afbab0acb79eef70d03c304fb80'
          AND l.lanname = 'plpgsql' AND NOT p.prosecdef AND p.prorettype = 'trigger'::regtype
          AND p.proowner = v_dono AND p.proconfig = ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'POSVOO_20261470000000: corpo, atributos ou dono de frota_lojas_estado_so_pela_porta não são os desta migration';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('frota_mudar_estado', 'frota_lojas_estado_so_pela_porta')) <> 2 THEN
    RAISE EXCEPTION 'POSVOO_20261470000000: frota_mudar_estado ou frota_lojas_estado_so_pela_porta ficou com sobrecarga';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid IN (v_porta, v_gatilho_fn) AND g.privilege_type = 'EXECUTE' AND g.grantee <> p.proowner)
     OR has_function_privilege('anon', v_porta, 'EXECUTE')
     OR has_function_privilege('authenticated', v_porta, 'EXECUTE')
     OR has_function_privilege('service_role', v_porta, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261470000000: alguém além do dono executa a porta ou a função do gatilho';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = v_lojas AND t.tgname = 'frota_lojas_estado_so_pela_porta' AND NOT t.tgisinternal
         AND t.tgfoid = v_gatilho_fn AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL
         AND (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
               WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])) = 'estado,estado_desde,estado_sha,project_ref') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261470000000: o gatilho frota_lojas_estado_so_pela_porta não é BEFORE INSERT OR UPDATE OF estado, estado_desde, estado_sha, project_ref por linha, habilitado';
  END IF;
  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || a.attidentity::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = v_hist AND a.attnum > 0 AND NOT a.attisdropped)
     IS DISTINCT FROM 'id:bigint:true:a:-,loja_id:text:true::-,project_ref:text:true::-,de:text:true::-,para:text:true::-,sha:text:true::-,motivo:text:true::-,quem:text:true::SESSION_USER,em:timestamp with time zone:true::now()'
     OR (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = v_hist)
     IS DISTINCT FROM 'frota_estado_historico_estados_check=CHECK (((de = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])) AND (para = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])) AND (de <> para))) | frota_estado_historico_motivo_check=CHECK (((btrim(motivo) <> ''''::text) AND (char_length(motivo) <= 200))) | frota_estado_historico_pkey=PRIMARY KEY (id) | frota_estado_historico_sha_check=CHECK ((sha ~ ''^[0-9a-f]{40}$''::text))' THEN
    RAISE EXCEPTION 'POSVOO_20261470000000: frota_estado_historico não tem as colunas ou os CHECKs desta migration';
  END IF;
  IF NOT (SELECT c.relrowsecurity AND c.relowner = v_dono FROM pg_class c WHERE c.oid = v_hist)
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = v_hist)
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) g
                 WHERE c.oid IN (v_hist, v_seq) AND g.grantee <> c.relowner)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_hist AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'POSVOO_20261470000000: frota_estado_historico não está fechada (RLS ligada, nenhuma política, privilégio só do dono na tabela e na sequência)';
  END IF;
  IF (SELECT jsonb_build_object(
        'lojas', (SELECT to_jsonb(c) - 'reltuples' - 'relpages' - 'relallvisible' - 'relhastriggers' FROM pg_class c WHERE c.oid = v_lojas),
        'colunas', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = v_lojas AND a.attnum > 0),
        'checks', (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = v_lojas),
        'portas', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.proname) FROM pg_proc p
                    WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado'))))
     IS DISTINCT FROM current_setting('ikcous.porta1470_base')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261470000000: frota_lojas (colunas, CHECKs, dono, ACL) ou as portas da caderneta mudaram';
  END IF;
END $posvoo_20261470000000$;

-- Objetos novos no schema public: recarrega o schema cache do PostgREST (nenhum papel da API os alcança). Idempotente.
NOTIFY pgrst, 'reload schema';

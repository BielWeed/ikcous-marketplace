-- ============================================================================
-- Migration 20261396100000 — a pergunta do produto nasce com a data de agora
-- (abuso de ordem na vitrine por quem só tem a chave pública + uma conta; caçada de segurança de 27/10/2026,
-- relatório 11-B, achado 4)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- `public.questions.created_at` tem DEFAULT, mas o cliente pode mandar o valor que quiser: a `questions_insert_policy`
-- só confere `user_id = auth.uid()`, e nenhum gatilho olha a data. A vitrine ordena as perguntas por `created_at`
-- decrescente (visitante pela `vw_questions_public`, logado pela tabela), e a pergunta aparece na hora, sem
-- moderação. Uma conta comum que grava `created_at = 2099-01-01` fixa a própria pergunta em 1º lugar na página do
-- produto, acima de todas as novas, até a lojista apagá-la. O app grava só 3 colunas (product_id, user_id,
-- question; src/hooks/useQuestions.ts `addQuestion`), então nada legítimo manda a data.
--
-- 2. O QUE MUDA (só objeto NOVO, nada existente é alterado)
--
--   * função NOVA `public.pergunta_nasce_com_a_data_de_agora()` (RETURNS trigger, SECURITY DEFINER,
--     `search_path = public`);
--   * gatilho NOVO `tr_pergunta_nasce_com_a_data_de_agora`, BEFORE INSERT, FOR EACH ROW, em `public.questions`.
--
-- O gatilho NÃO recusa nada: quando quem grava é um cliente (papel de API `anon`/`authenticated`) que NÃO é
-- administrador da loja, ele troca no rascunho da linha `created_at := now()`. A pergunta entra normalmente
-- (mesma linha, mesmo texto), só com a data do servidor. É o mesmo desenho da `avaliacao_nasce_sem_a_resposta_da_loja`
-- (20261224000000), que fechou este defeito nas avaliações e deixou as perguntas de fora.
--
-- QUEM GRAVA SEM SER TROCADO (o mesmo critério da 20261224000000):
--   * administrador da loja: `public.rls_admin_atual()` (papel de AGORA em auth.users E profiles; service_role e
--     postgres também passam por ele);
--   * sessão DIRETA no banco (sem API): o parâmetro `role` da sessão vale 'none' (o PostgREST sempre faz SET ROLE
--     para anon/authenticated/service_role), ou seja, migration, seed e script de prova gravam a data como vier.
-- Qualquer outro papel tem a data trocada (a regra não lista os papéis de cliente, lista só as exceções).
--
-- 3. DADOS EXISTENTES
--
-- NENHUMA linha é lida, reescrita ou apagada pelo apply: o gatilho só age em INSERT novo. Pergunta já gravada com
-- data forjada continua como está (apagá-la é decisão da lojista). Medição, só leitura (esperado 0; qualquer
-- coisa acima é pergunta com data no futuro, que está fixada no topo):
--   SELECT count(*) FROM public.questions WHERE created_at > now() + interval '1 minute';
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: `questions.created_at` não for timestamptz; `public.rls_admin_atual()` não existir (aplique a
-- 20261197000000 antes) ou não devolver boolean; existir mais de uma função com o nome novo, ou uma com outro corpo
-- (md5 de `replace(prosrc, E'\r', '')`); ou o gatilho de nome novo existir fora de `questions` ou diferente do
-- desenhado (outra função, outro momento/evento, WHEN, UPDATE OF, argumentos). Estados aceitos: nada do que esta
-- migration cria existe (aplica) ou tudo existe como desenhado (reaplicar é no-op).
--
-- 5. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- `CREATE OR REPLACE FUNCTION` + `CREATE OR REPLACE TRIGGER` (sem DROP): rodar duas vezes deixa o mesmo estado.
-- Sem BEGIN/COMMIT de nível superior (regra da casa): o aplicador dá a transação; pré-voo, criação e conferência
-- caem juntos ou não caem. CREATE TRIGGER pega `SHARE ROW EXCLUSIVE` em `questions`: com `lock_timeout = 5s` uma
-- loja em uso falha limpo em vez de travar quem pergunta — repetir depois. A ACL da função é FECHADA (REVOKE de
-- PUBLIC, anon, authenticated e service_role: o gatilho dispara sem EXECUTE de quem grava); isto vale só para o
-- objeto novo desta migration, nenhum GRANT/REVOKE existente muda.
--
-- 6. ORDEM E ROLLBACK
--
-- Depois da 20261197000000 (`rls_admin_atual`). Nenhum front e nenhuma edge function mudam: banco antes ou depois do
-- front dá no mesmo. ROLLBACK MANUAL: rollback-manual-20261396100000_a_pergunta_nasce_com_a_data_de_agora.sql tira
-- o gatilho e a função (os dois são novos; não há corpo anterior a restaurar). Perguntas criadas enquanto o gatilho
-- existiu ficam como foram gravadas.
--
-- 7. FICHA DE VERIFICAÇÃO: consultas 113a (depois) / 113b (antes).
--   PROVA VIVA: tests/banco/a-pergunta-nasce-com-a-data-de-agora-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261396100000$
DECLARE
  v_fn CONSTANT text := 'public.pergunta_nasce_com_a_data_de_agora()';
  v_oid oid := to_regprocedure('public.pergunta_nasce_com_a_data_de_agora()');
  v_hash text;
  v_gat record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = to_regclass('public.questions') AND a.attname = 'created_at'
                    AND a.atttypid = 'timestamptz'::regtype AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.questions.created_at (timestamptz) não existe — meça a loja e revise antes de aplicar.';
  END IF;

  -- A exceção do administrador usa a porta das políticas (20261197).
  IF to_regprocedure('public.rls_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.rls_admin_atual() não existe — aplique a 20261197000000 antes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.rls_admin_atual()') AND p.prorettype = 'boolean'::regtype) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.rls_admin_atual() não devolve boolean.';
  END IF;

  -- A função nova: ausente, ou exatamente a desta migration.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'pergunta_nasce_com_a_data_de_agora') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: pergunta_nasce_com_a_data_de_agora tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '1cbc49981db4f1d76e4cf1048914c088' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % já existe com corpo desconhecido (hash %) — ninguém revisou essa redefinição; capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'pergunta_nasce_com_a_data_de_agora') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: pergunta_nasce_com_a_data_de_agora existe em public com outra assinatura — revise antes de aplicar.';
  END IF;

  -- O gatilho novo: ausente, ou exatamente o desenhado (BEFORE INSERT, por linha, sem WHEN/UPDATE OF/argumentos).
  FOR v_gat IN
    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs, t.tgattr::text AS attr, t.tgisinternal
      FROM pg_trigger t
     WHERE t.tgname = 'tr_pergunta_nasce_com_a_data_de_agora'
  LOOP
    IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.questions')
       OR v_gat.tgfoid IS DISTINCT FROM v_oid
       OR v_gat.tgtype <> 7
       OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.attr <> '' OR v_gat.tgisinternal THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho chamado tr_pergunta_nasce_com_a_data_de_agora que NÃO é o desenhado aqui (outra tabela, outra função, outro momento/evento, WHEN, UPDATE OF ou argumentos) — revise antes de aplicar.';
    END IF;
  END LOOP;
END $preflight_20261396100000$;

CREATE OR REPLACE FUNCTION public.pergunta_nasce_com_a_data_de_agora()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- A pergunta nova nasce com a data do SERVIDOR: a vitrine ordena por created_at e uma data futura mandada pelo
    -- cliente fixaria a pergunta no topo. Só o administrador (rls_admin_atual: papel de AGORA no banco, e
    -- service_role/postgres) e a sessão direta no banco (o `role` da sessão é 'none': o PostgREST sempre faz
    -- SET ROLE) gravam a data como vier. Qualquer outro papel tem a data trocada: a regra não lista os papéis de
    -- cliente, lista só as exceções (falha fechada). Não recusa: a pergunta entra, só com a data de agora.
    IF COALESCE(NULLIF(current_setting('role', true), ''), 'none') <> 'none'
       AND NOT public.rls_admin_atual() THEN
        NEW.created_at := now();
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.pergunta_nasce_com_a_data_de_agora() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER tr_pergunta_nasce_com_a_data_de_agora
BEFORE INSERT ON public.questions
FOR EACH ROW EXECUTE FUNCTION public.pergunta_nasce_com_a_data_de_agora();

-- CONFERÊNCIA no instante do apply: aborta se a função ou o gatilho não ficaram como desenhados.
DO $conferencia_20261396100000$
DECLARE
  v_fn CONSTANT text := 'public.pergunta_nasce_com_a_data_de_agora()';
  v_oid oid := to_regprocedure('public.pergunta_nasce_com_a_data_de_agora()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261396100000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'pergunta_nasce_com_a_data_de_agora') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261396100000: pergunta_nasce_com_a_data_de_agora ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '1cbc49981db4f1d76e4cf1048914c088' THEN
    RAISE EXCEPTION 'conferencia 20261396100000: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.prorettype = 'trigger'::regtype
          AND p.pronargs = 0
          AND p.proconfig = ARRAY['search_path=public']::text[]
     ) THEN
    RAISE EXCEPTION 'conferencia 20261396100000: atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, retorno ou argumentos)', v_fn;
  END IF;
  -- Função de gatilho FECHADA a todos os papéis de fora.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261396100000: % alcancavel por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261396100000: anon, authenticated ou service_role executa %', v_fn;
  END IF;
  -- O gatilho: um só, em public.questions, BEFORE INSERT por linha, ligado (origin), apontando para a função.
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'tr_pergunta_nasce_com_a_data_de_agora') <> 1
     OR NOT EXISTS (
          SELECT 1 FROM pg_trigger t
           WHERE t.tgname = 'tr_pergunta_nasce_com_a_data_de_agora'
             AND t.tgrelid = to_regclass('public.questions')
             AND t.tgfoid = v_oid
             AND t.tgtype = 7
             AND t.tgenabled = 'O'
             AND t.tgqual IS NULL
             AND t.tgnargs = 0
             AND t.tgattr::text = ''
             AND NOT t.tgisinternal
        ) THEN
    RAISE EXCEPTION 'conferencia 20261396100000: o gatilho tr_pergunta_nasce_com_a_data_de_agora não ficou como desenhado (um só, em public.questions, BEFORE INSERT por linha, ligado, sem WHEN)';
  END IF;
END $conferencia_20261396100000$;

-- ============================================================================
-- Migration 20261224000000 — a avaliação nasce sem a resposta da loja
-- (permissão / dado público; achado da caçada Opus de 14/10/2026, banco local descartável)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO
--
-- Qualquer cliente LOGADA cria a própria avaliação já com `merchant_reply` ("Resposta Oficial da Loja"),
-- `merchant_reply_at`, `helpful` (ex.: 9999) e `created_at` (ex.: 2030) preenchidos, por chamada direta à API
-- (o app manda só 5 colunas, `src/hooks/useReviews.ts` `addReview`; o banco aceitava as outras). A policy de
-- INSERT `reviews_insert_policy` só confere autora = próprio usuário, `verified = false`, `status = 'pendente'`
-- e `enable_reviews`; o único gatilho da tabela (`tr_avaliacao_nasce_verificada`) é AFTER INSERT e só mexe em
-- `verified`. Efeito: o painel mostra o texto falso com o selo da loja e esconde o botão "Responder"; o sino do
-- lojista não acende (ele conta só avaliações SEM resposta); e, se o lojista aprovar, o texto falso aparece
-- público (`vw_reviews_public`) com a voz da loja, com 9999 "úteis" e no topo por data futura.
--
-- 2. O QUE MUDA (só objeto NOVO, nada existente é alterado)
--
--   * função NOVA `public.avaliacao_nasce_sem_a_resposta_da_loja()` (RETURNS trigger, SECURITY DEFINER,
--     `search_path = public`);
--   * gatilho NOVO `tr_avaliacao_nasce_sem_a_resposta_da_loja`, BEFORE INSERT, FOR EACH ROW, em `public.reviews`.
--
-- O gatilho NÃO recusa nada: quando quem grava é um cliente (papel de API `anon`/`authenticated`) que NÃO é
-- administrador da loja, ele LIMPA no rascunho da linha o que só o servidor pode definir:
--     merchant_reply := NULL, merchant_reply_at := NULL, helpful := 0, created_at := now().
-- A avaliação entra normalmente (a mesma linha, o mesmo `status = 'pendente'`), só sem o que foi forjado.
--
-- QUEM GRAVA SEM SER LIMPO (decisão registrada, provada em tests/banco/avaliacao-nasce-sem-resposta-da-loja-viva.cjs):
--   * administrador da loja: `public.rls_admin_atual()` (o MESMO critério das portas do painel desde a
--     20261197/20261199: papel de AGORA em auth.users E profiles, e service_role/postgres);
--   * service_role e postgres: caem no item acima (rotina de servidor, edge function com a chave de serviço);
--   * sessão DIRETA no banco (sem passar pela API): o parâmetro `role` da sessão vale 'none'. O PostgREST
--     SEMPRE faz SET ROLE para anon/authenticated/service_role, então quem está em 'none' tem a credencial do
--     banco (migration, seed, script de prova) e não é cliente. Sem esta exceção um script de seed que grava
--     `merchant_reply` direto perderia a resposta em silêncio.
-- Qualquer outro papel é LIMPO (a regra falha fechada): o gatilho não lista os papéis de cliente, lista só as
-- exceções. Uma função SECURITY DEFINER chamada por cliente continua com `role` = authenticated, então uma RPC
-- futura que insira avaliação a pedido de cliente também é limpa.
--
-- `reply_review_atomic` (a resposta do lojista) faz UPDATE, não INSERT: não passa por este gatilho e segue
-- gravando `merchant_reply`/`merchant_reply_at` como antes. O gatilho `tr_avaliacao_nasce_verificada` (AFTER
-- INSERT, `verified`) também não muda e roda DEPOIS deste.
--
-- 3. AS OUTRAS COLUNAS DE `reviews` (medido; nada além das quatro acima foi forjável e sem uso do cliente)
--
--   id            o cliente pode escolher o uuid; sem efeito (chave nova, `gen_random_uuid()` é o padrão): NOTA.
--   product_id    FK para produtos; o cliente escolhe o produto a avaliar (é o uso legítimo).
--   user_id       a policy exige = auth.uid().
--   rating        CHECK 1..5.
--   comment       texto livre da cliente (é o uso legítimo).
--   verified      a policy exige false; o selo vem do gatilho AFTER INSERT pela compra.
--   status        a policy exige 'pendente'.
--   merchant_reply, merchant_reply_at, helpful, created_at   FORJÁVEIS e sem uso do cliente: tratadas aqui.
-- Não existem colunas `moderated_*` nem `likes` na tabela. UPDATE por cliente não existe (só `is_admin()`).
--
-- 4. DADOS EXISTENTES
--
-- NENHUMA linha é lida, reescrita ou apagada pelo apply: o gatilho só age em INSERT NOVO. Uma avaliação
-- forjada ANTES do apply continua como está (inclusive com a voz da loja, se alguém aprovou). A medição está
-- na consulta de leitura `scripts/publicacao/consultas/27m-medir-avaliacao-forjada.sql`; limpar o que ela
-- achar é decisão do dono, com a lista na mão (não é automática: uma resposta legítima do lojista, feita por
-- UPDATE direto no banco, é indistinguível de uma forjada sem o rastro do log).
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: `reviews` não tiver as quatro colunas com os tipos conhecidos; `public.rls_admin_atual()` não
-- existir (aplique a 20261197 antes); existir mais de uma função com o nome novo, ou uma que não tenha o corpo
-- (md5 de `replace(prosrc, E'\r', '')`) desta migration; o gatilho de nome novo existir fora de `reviews`, ou
-- em `reviews` mas diferente do desenhado (outra função, outro momento/evento, com WHEN, com UPDATE OF, com
-- argumentos); ou o gatilho irmão `tr_avaliacao_nasce_verificada` (AFTER INSERT) não existir. Estados aceitos:
-- (a) nada do que esta migration cria existe (aplica); (b) tudo existe como desenhado (reaplicar é no-op:
-- mesmo corpo, mesmo gatilho). Qualquer outro estado ABORTA.
--
-- 6. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- `CREATE OR REPLACE FUNCTION` + `CREATE OR REPLACE TRIGGER` (sem DROP): rodar duas vezes deixa o mesmo
-- estado. Sem BEGIN/COMMIT de nível superior (regra da casa; `db-prove-rollback.cjs` recusa): quem abre a
-- transação é o aplicador (`aplicar-migrations.yml`/`db-apply.cjs`); o pré-voo, a criação e a conferência final
-- caem juntos ou não caem. ATENÇÃO — CREATE TRIGGER pega `SHARE ROW EXCLUSIVE` em `reviews`: espera qualquer
-- transação que esteja gravando avaliação naquele instante terminar (e as gravações que chegarem depois dele
-- ficam na fila por instantes). Uma avaliação já em voo quando o gatilho nasce NÃO é limpa (nasceu antes).
-- A ACL da função é fechada (REVOKE de PUBLIC, anon, authenticated, service_role): gatilho não precisa de
-- EXECUTE de quem grava (o Postgres confere EXECUTE só ao CRIAR o gatilho), e a lista L8 ("função nova não
-- nasce aberta") não ganha entrada.
--
-- 7. QUEM QUEBRA
--
-- Ninguém no app: `addReview` manda 5 colunas e continua entrando igual (`created_at` agora vem de `now()` do
-- servidor, o mesmo valor do DEFAULT da coluna com o fuso UTC do Supabase). Nenhuma edge function grava
-- avaliação. Quem passaria a perder dado: só quem grava avaliação pela API com resposta/útil/data de propósito
-- — exatamente o defeito.
--
-- 8. ORDEM E ROLLBACK
--
-- Exige a 20261197000000 (`rls_admin_atual`) e a 20261030000000 (`tr_avaliacao_nasce_verificada`) já
-- aplicadas. Nenhum front e nenhuma edge function mudam: banco antes ou depois do front dá no mesmo.
-- ROLLBACK MANUAL: rollback-manual-20261224000000_a_avaliacao_nasce_sem_a_resposta_da_loja.sql remove o
-- gatilho e a função (os dois eram novos); nada a restaurar. Avaliações criadas enquanto o gatilho existiu
-- ficam como foram gravadas (limpas).
--
-- PROVA VIVA: tests/banco/avaliacao-nasce-sem-resposta-da-loja-viva.cjs (comportamento por papel, mutantes,
-- pré-voo, conferência, idempotência, rollback, concorrência).
-- ============================================================================

DO $preflight_20261224$
DECLARE
  v_fn CONSTANT text := 'public.avaliacao_nasce_sem_a_resposta_da_loja()';
  v_oid oid := to_regprocedure('public.avaliacao_nasce_sem_a_resposta_da_loja()');
  v_hash text;
  v_gat record;
BEGIN
  -- As quatro colunas que o gatilho reescreve: têm de existir com os tipos de sempre.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.reviews') AND NOT a.attisdropped
         AND ((a.attname = 'merchant_reply'    AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'merchant_reply_at' AND a.atttypid = 'timestamptz'::regtype)
           OR (a.attname = 'helpful'           AND a.atttypid = 'integer'::regtype)
           OR (a.attname = 'created_at'        AND a.atttypid = 'timestamptz'::regtype))) <> 4 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.reviews não tem merchant_reply (text), merchant_reply_at (timestamptz), helpful (integer) e created_at (timestamptz) — meça a loja e revise antes de aplicar.';
  END IF;

  -- A exceção do administrador usa a porta das políticas (20261197).
  IF to_regprocedure('public.rls_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.rls_admin_atual() não existe — aplique a 20261197000000 antes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.rls_admin_atual()') AND p.prorettype = 'boolean'::regtype) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.rls_admin_atual() não devolve boolean.';
  END IF;

  -- O gatilho irmão (o selo pela compra) tem de estar de pé: esta migration roda ANTES dele no mesmo INSERT.
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.reviews') AND t.tgname = 'tr_avaliacao_nasce_verificada'
          AND NOT t.tgisinternal AND t.tgtype = 5
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho tr_avaliacao_nasce_verificada (AFTER INSERT em public.reviews, 20261030000000) não existe como esperado — aplique a 20261030000000 antes.';
  END IF;

  -- A função nova: ausente, ou exatamente a desta migration.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_nasce_sem_a_resposta_da_loja') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_nasce_sem_a_resposta_da_loja tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '2c2d607c4009de72d10d1a7d154a642f' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % já existe com corpo desconhecido (hash %) — ninguém revisou essa redefinição; capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_nasce_sem_a_resposta_da_loja') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_nasce_sem_a_resposta_da_loja existe em public com outra assinatura — revise antes de aplicar.';
  END IF;

  -- O gatilho novo: ausente, ou exatamente o desenhado (BEFORE INSERT, por linha, sem WHEN/UPDATE OF/argumentos).
  FOR v_gat IN
    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs, t.tgattr::text AS attr, t.tgisinternal
      FROM pg_trigger t
     WHERE t.tgname = 'tr_avaliacao_nasce_sem_a_resposta_da_loja'
  LOOP
    IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.reviews')
       OR v_gat.tgfoid IS DISTINCT FROM v_oid
       OR v_gat.tgtype <> 7
       OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.attr <> '' OR v_gat.tgisinternal THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho chamado tr_avaliacao_nasce_sem_a_resposta_da_loja que NÃO é o desenhado aqui (outra tabela, outra função, outro momento/evento, WHEN, UPDATE OF ou argumentos) — revise antes de aplicar.';
    END IF;
  END LOOP;
END $preflight_20261224$;

CREATE OR REPLACE FUNCTION public.avaliacao_nasce_sem_a_resposta_da_loja()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- A avaliação nova nasce SEM o que só o servidor define: a resposta da loja, a data dela, o contador de
    -- "úteis" e a data de criação. Só o administrador (rls_admin_atual: papel de AGORA no banco, e
    -- service_role/postgres) e a sessão direta no banco (o `role` da sessão é 'none': o PostgREST sempre faz
    -- SET ROLE) gravam esses campos como vierem. Qualquer outro papel é LIMPO: a regra não lista os papéis de
    -- cliente, lista só as exceções (falha fechada). Não recusa: a avaliação entra, sem o que foi forjado.
    IF COALESCE(NULLIF(current_setting('role', true), ''), 'none') <> 'none'
       AND NOT public.rls_admin_atual() THEN
        NEW.merchant_reply := NULL;
        NEW.merchant_reply_at := NULL;
        NEW.helpful := 0;
        NEW.created_at := now();
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.avaliacao_nasce_sem_a_resposta_da_loja() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER tr_avaliacao_nasce_sem_a_resposta_da_loja
BEFORE INSERT ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.avaliacao_nasce_sem_a_resposta_da_loja();

-- CONFERÊNCIA no instante do apply: aborta se a função ou o gatilho não ficaram como desenhados.
DO $conferencia_20261224$
DECLARE
  v_fn CONSTANT text := 'public.avaliacao_nasce_sem_a_resposta_da_loja()';
  v_oid oid := to_regprocedure('public.avaliacao_nasce_sem_a_resposta_da_loja()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261224: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_nasce_sem_a_resposta_da_loja') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261224: avaliacao_nasce_sem_a_resposta_da_loja ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '2c2d607c4009de72d10d1a7d154a642f' THEN
    RAISE EXCEPTION 'conferencia 20261224: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'conferencia 20261224: atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, retorno ou argumentos)', v_fn;
  END IF;
  -- Função de gatilho FECHADA a todos os papéis de fora (a lista L8 não ganha entrada).
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261224: % alcancavel por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261224: anon, authenticated ou service_role executa %', v_fn;
  END IF;
  -- O gatilho: um só, em public.reviews, BEFORE INSERT por linha, ligado (origin), apontando para a função.
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'tr_avaliacao_nasce_sem_a_resposta_da_loja') <> 1
     OR NOT EXISTS (
          SELECT 1 FROM pg_trigger t
           WHERE t.tgname = 'tr_avaliacao_nasce_sem_a_resposta_da_loja'
             AND t.tgrelid = to_regclass('public.reviews')
             AND t.tgfoid = v_oid
             AND t.tgtype = 7
             AND t.tgenabled = 'O'
             AND t.tgqual IS NULL
             AND t.tgnargs = 0
             AND t.tgattr::text = ''
             AND NOT t.tgisinternal
        ) THEN
    RAISE EXCEPTION 'conferencia 20261224: o gatilho tr_avaliacao_nasce_sem_a_resposta_da_loja não ficou como desenhado (um só, em public.reviews, BEFORE INSERT por linha, ligado, sem WHEN)';
  END IF;
END $conferencia_20261224$;

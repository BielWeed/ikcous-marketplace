-- ============================================================================
-- Migration 20261221000000 — a média de avaliações e o voto "útil" fecham para
-- o visitante sem login (menor privilégio; ordem do dono, 14/10/2026, decisões 1 e 2
-- da lista de portas toleradas do L8)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- Duas funções de `public` ainda são executáveis pelo visitante sem login (anon),
-- sem que o visitante dependa delas:
--   * `get_reviews_metrics(p_search text, p_rating integer)` — média e contagens
--     das avaliações. Só o painel de avaliações a usa (`useReviews.ts`, dentro da
--     lista paginada de `getAllReviews`, atrás do `AdminAreaGate`); nenhuma tela do
--     visitante a chama.
--   * `increment_helpful(review_id uuid)` — o voto "útil". O front já barra o
--     visitante antes de chamar (`if (!user)`) e o corpo recusa `auth.uid()` nulo
--     ("Acesso negado: usuário não autenticado."), então o visitante só recebia a
--     recusa. A porta aberta só serve a abuso.
-- Ambas constavam como `tolerada` em `tests/banco/portas-do-visitante-permitidas.json`
-- (prova L8): "fechar é migration à parte". É esta. Depois dela a lista L8 diz
-- `logado` para `increment_helpful` (o corpo faz a guarda) e continua `tolerada`,
-- agora só com authenticated, para `get_reviews_metrics` (o corpo ainda não checa
-- admin; ver seção 8).
--
-- 2. O QUE MUDA
--
-- Para cada uma das duas: `REVOKE EXECUTE ... FROM PUBLIC, anon` e
-- `GRANT EXECUTE ... TO authenticated` (o logado continua chamando). SÓ ACL: nenhum
-- corpo é trocado, nenhuma tabela ou linha é lida ou escrita, nenhum DROP. O estado
-- de antes (medido no efêmero com as 152 migrations e coerente com a lista L8 das
-- duas lojas) é PUBLIC sem nada; anon, authenticated, service_role e o dono
-- (postgres) com EXECUTE. service_role e o dono não mudam.
--
-- 3. QUEM QUEBRA
--
-- Só quem chamasse uma das duas SEM login: a chamada passa a ser recusada pelo
-- banco (permissão negada). O levantamento de chamadores (14/10/2026) achou
-- `get_reviews_metrics` só no ramo "não-admin" de `getAllReviews` (painel logado) e
-- `increment_helpful` só em `markHelpful` (barrado por `if (!user)`). Nenhuma view,
-- política ou gatilho do banco as chama (as duas só aparecem em definição, ACL e
-- prova); e mesmo uma função SECURITY DEFINER que as chamasse rodaria com o dono,
-- que continua com EXECUTE.
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha de `reviews`, `review_votes` ou qualquer tabela é lida, reescrita
-- ou apagada. Votos já gravados e avaliações continuam como estão. Só a ACL de duas
-- funções muda.
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: alguma das duas funções não existir, ou se a ACL de alguma não for
-- EXATAMENTE uma das duas conhecidas — a de antes (PUBLIC não, anon sim,
-- authenticated sim, service_role sim: `20261090500000`,
-- `db-prove-grants-convergem.cjs`, lista L8) ou a de depois (PUBLIC não, anon não,
-- authenticated sim, service_role sim, o que torna reaplicar idempotente). ACL
-- diferente (PUBLIC com EXECUTE, authenticated ou service_role sem) é loja que
-- ninguém mediu: o apply para (lado seguro) em vez de subir ou descer privilégio às
-- cegas. O corpo não é conferido porque a migration não o toca e fechar é o sentido
-- seguro do corte.
--
-- 6. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Só REVOKE e GRANT: reaplicar deixa o mesmo estado (o GRANT a authenticated, que
-- já tem, não muda nada). Sem BEGIN/COMMIT de nível superior (regra da casa,
-- AGENTS.md; `db-prove-rollback.cjs` recusa): quem abre a transação é o aplicador
-- (`aplicar-migrations.yml`/`db-apply.cjs`); o pré-voo, os dois REVOKE/GRANT e a
-- conferência final caem juntos ou não caem. As duas funções entram no MESMO
-- arquivo: ou as duas fecham ou nenhuma. Um REVOKE que não revoga (grantor
-- diferente) só emite WARNING: a conferência final transforma isso em erro e o
-- apply inteiro volta.
--
-- 7. ORDEM E ROLLBACK
--
-- Banco antes ou depois do front: nenhum front muda (o app novo e o antigo só
-- chamam as duas com login). Nenhuma edge function muda. ROLLBACK MANUAL:
-- rollback-manual-20261221000000_a_media_de_avaliacoes_e_o_voto_util_fecham_para_o_visitante.sql
-- devolve o EXECUTE a anon e authenticated com um GRANT (o conjunto de privilégios
-- por papel volta ao de antes; a ordem das entradas dentro do array de ACL pode
-- mudar) — e com ele volta a porta aberta ao visitante.
--
-- ATENÇÃO — `rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql`
-- faz `GRANT EXECUTE ... TO PUBLIC` nestas duas funções; rodado DEPOIS desta
-- migration reabre as duas para TODOS, inclusive o visitante. Não rode.
--
-- 8. O QUE ESTA MIGRATION NÃO FAZ (registro para o dono)
--
-- O corpo de `get_reviews_metrics` (SECURITY DEFINER) não checa se quem chama é
-- admin e não filtra por status da avaliação: qualquer conta LOGADA lê média e
-- contagens de TODAS as avaliações (pendentes incluídas) e o `p_search` faz ILIKE em
-- perfis públicos e produtos. Isto é decisão separada — o escopo aqui é só ACL.
--
-- PROVA VIVA: tests/banco/portas-do-visitante-so-as-permitidas-viva.cjs (a lista
-- passa a dizer `logado` e o banco tem de concordar) e
-- tests/banco/avaliacoes-fechadas-ao-visitante-viva.cjs (comportamento: anon
-- recusado, authenticated chama, service_role intacto, rollback idêntico, idempotência).
-- ============================================================================

DO $preflight_20261221$
DECLARE
  v_fn text;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_servico boolean;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_reviews_metrics(text,integer)',
    'public.increment_helpful(uuid)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
    END IF;

    -- PUBLIC medido por aclexplode, grantee = 0 (has_function_privilege não tem o pseudo-papel).
    v_public := EXISTS (SELECT 1 FROM pg_proc p
                          CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                         WHERE p.oid = to_regprocedure(v_fn) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
    v_anon := has_function_privilege('anon', v_fn, 'EXECUTE');
    v_auth := has_function_privilege('authenticated', v_fn, 'EXECUTE');
    v_servico := has_function_privilege('service_role', v_fn, 'EXECUTE');
    IF NOT (
         (NOT v_public AND v_anon AND v_auth AND v_servico)
      OR (NOT v_public AND NOT v_anon AND v_auth AND v_servico)
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a de antes nem a de depois do corte (PUBLIC=%, anon=%, authenticated=%, service_role=%) — meça a loja e revise antes de aplicar.', v_fn, v_public, v_anon, v_auth, v_servico;
    END IF;
  END LOOP;
END $preflight_20261221$;

REVOKE EXECUTE ON FUNCTION public.get_reviews_metrics(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reviews_metrics(text, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_helpful(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_helpful(uuid) TO authenticated;

-- CONFERÊNCIA no instante do apply: aborta se PUBLIC ou anon ainda alcançam qualquer
-- das duas por qualquer caminho, se authenticated ou service_role não executam.
DO $conferencia_20261221$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_reviews_metrics(text,integer)',
    'public.increment_helpful(uuid)'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                WHERE p.oid = to_regprocedure(v_fn) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
      RAISE EXCEPTION 'conferencia 20261221: % ainda alcancavel por PUBLIC', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261221: anon ainda executa %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261221: authenticated perdeu EXECUTE em %', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261221: service_role perdeu EXECUTE em %', v_fn;
    END IF;
  END LOOP;
END $conferencia_20261221$;

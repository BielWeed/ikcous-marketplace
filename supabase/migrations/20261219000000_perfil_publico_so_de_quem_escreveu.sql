-- ============================================================================
-- Migration 20261219000000 — a lista de perfis públicos só aparece para quem
-- está logado, e só com quem escreveu algo na vitrine
-- (auditoria de segurança de 12/10/2026, lote L2, terceira de três)
-- ============================================================================
--
-- NÃO ADITIVA — RESTRINGE PERMISSÃO (RLS). Pelo precedente da casa
-- (20261111000000), mudança que restringe leitura vai ao dono com o SQL
-- mostrado antes do apply.
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- `public_profiles` (id, nome, foto, capa e data de cadastro de cada conta,
-- copiados de `profiles` pelo gatilho `sync_public_profile`) tinha uma única
-- política, `public_profiles_select_policy`, `FOR SELECT USING (true)` para
-- PUBLIC: qualquer pessoa, logada ou não, listava todas as contas da loja. O
-- app só precisa do nome e da foto de quem escreveu uma avaliação publicada ou
-- uma pergunta (para mostrar o autor), da própria conta, e de todas para o
-- admin.
--
-- 2. O QUE MUDA
--
-- A política é recriada com o mesmo nome, `FOR SELECT TO authenticated`:
--   * a própria conta (`public_profiles.id = auth.uid()`);
--   * o admin atual (`rls_admin_atual()`, a mesma regra das políticas da
--     20261202000000: papel atual em profiles E em auth.users);
--   * quem tem avaliação publicada (`reviews.status = 'publicada'`);
--   * quem tem pergunta.
-- O visitante sem login não tem ramo nenhum: recebe zero linhas, sem erro (a
-- política é só de authenticated, então `rls_admin_atual()`, que o anon não
-- executa, nunca é avaliada para ele). O nome e a foto do autor continuam
-- chegando ao visitante pelas views da vitrine (`vw_reviews_public`,
-- `vw_questions_public`), que rodam como o dono da tabela e não passam pela
-- política. As permissões de tabela não mudam.
--
-- Quem lê, e o que acontece (medido no código em 12/10/2026):
--   * vitrine sem login (views acima, `get_reviews_metrics`): igual;
--   * página do produto logado (embed do autor em reviews/questions): igual —
--     toda linha de avaliação ou pergunta que o logado vê tem autor visível;
--   * busca por nome no painel de avaliações/perguntas (não admin): passa a
--     achar só autores, que são os únicos com linhas na lista;
--   * perfil de outra pessoa (só logado): abre o de quem escreveu; o de quem
--     não escreveu nada mostra "perfil não encontrado";
--   * painel do push (admin): igual, pelo ramo do admin;
--   * gatilho de sincronização e funções SECURITY DEFINER: igual (dono).
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita: só a política muda.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se `rls_admin_atual()` não for a da 20261197000000 ou se
-- authenticated não a executar (toda leitura logada daria erro), se as colunas
-- que a política lê não existirem, se a RLS de `public_profiles` estiver
-- desligada, ou se as políticas da tabela não forem exatamente a vigente
-- (`USING (true)` para PUBLIC) ou a que esta migration deixa. Expressões
-- comparadas deparseadas com search_path = pg_catalog.
--
-- 5. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- `DROP POLICY IF EXISTS` + `CREATE POLICY` com a mesma definição: reaplicar
-- deixa o mesmo estado. Sem BEGIN/COMMIT de nível superior (regra da casa): a
-- política nunca fica ausente para outra sessão (DROP e CREATE na mesma
-- transação do aplicador).
--
-- 6. ORDEM E ROLLBACK
--
-- Nenhum front nem edge function muda (o front já lê o autor pelas views sem
-- login). ROLLBACK MANUAL:
-- rollback-manual-20261219000000_perfil_publico_so_de_quem_escreveu.sql
-- devolve a política vigente (`FOR SELECT USING (true)`, papel PUBLIC).
--
-- PROVA VIVA: tests/banco/portas-do-banco-viva.cjs e
-- tests/banco/portas-do-banco-portao-viva.cjs (rpc-ci).
-- ============================================================================

DO $preflight_20261219$
DECLARE
  v_hash text;
  v_caminho text;
  v_total integer;
  v_nome text;
  v_qual text;
  v_check text;
  v_cmd text;
  v_perm boolean;
  v_roles text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.rls_admin_atual()');
  IF v_hash IS DISTINCT FROM 'ccb7a56e835b8181795fffb7bee97305' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.rls_admin_atual() (hash %) não é a da 20261197000000.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.rls_admin_atual()', 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: authenticated não executa public.rls_admin_atual() — toda leitura logada de public_profiles daria erro.';
  END IF;

  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attnum > 0 AND NOT a.attisdropped
         AND ((a.attrelid = to_regclass('public.reviews') AND a.attname IN ('user_id', 'status'))
           OR (a.attrelid = to_regclass('public.questions') AND a.attname = 'user_id')
           OR (a.attrelid = to_regclass('public.public_profiles') AND a.attname = 'id'))) <> 4 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam colunas que a política lê (reviews.user_id, reviews.status, questions.user_id, public_profiles.id).';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.public_profiles')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.public_profiles está sem RLS.';
  END IF;

  SELECT count(*) INTO v_total FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass;
  IF v_total <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.public_profiles tem % políticas (esperado 1) — revise antes de aplicar.', v_total;
  END IF;

  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT p.polname, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid),
         p.polcmd::text, p.polpermissive,
         array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
                                 FROM unnest(p.polroles) AS x ORDER BY 1), ',')
    INTO v_nome, v_qual, v_check, v_cmd, v_perm, v_roles
    FROM pg_policy p
   WHERE p.polrelid = 'public.public_profiles'::regclass;
  PERFORM set_config('search_path', v_caminho, true);

  IF v_nome IS DISTINCT FROM 'public_profiles_select_policy'
     OR v_cmd IS DISTINCT FROM 'r'
     OR v_perm IS DISTINCT FROM true
     OR v_check IS NOT NULL
     OR NOT (
          (v_roles = 'public' AND v_qual = 'true')
       OR (v_roles = 'authenticated' AND v_qual = E'((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (EXISTS ( SELECT 1\n   FROM public.reviews r\n  WHERE ((r.user_id = public_profiles.id) AND (r.status = ''publicada''::text)))) OR (EXISTS ( SELECT 1\n   FROM public.questions q\n  WHERE (q.user_id = public_profiles.id))))')
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: política % em public_profiles (comando %, papéis %, USING %) não é a vigente antes desta migration nem a que ela deixa — revise antes de aplicar.', COALESCE(v_nome, '-'), COALESCE(v_cmd, '-'), COALESCE(v_roles, '-'), COALESCE(v_qual, 'nulo');
  END IF;
END $preflight_20261219$;

DROP POLICY IF EXISTS public_profiles_select_policy ON public.public_profiles;
CREATE POLICY public_profiles_select_policy ON public.public_profiles
  FOR SELECT TO authenticated
  USING (
    public_profiles.id = (SELECT auth.uid())
    OR (SELECT public.rls_admin_atual())
    OR EXISTS (SELECT 1 FROM public.reviews r
                WHERE r.user_id = public_profiles.id AND r.status = 'publicada')
    OR EXISTS (SELECT 1 FROM public.questions q
                WHERE q.user_id = public_profiles.id)
  );

-- CONFERÊNCIA no instante do apply: uma política só, de SELECT, só para
-- authenticated, com a expressão desta migration; nenhuma para PUBLIC/anon.
DO $conferencia_20261219$
DECLARE
  v_caminho text;
  v_total integer;
  v_qual text;
  v_roles text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.public_profiles'::regclass) THEN
    RAISE EXCEPTION 'conferencia 20261219: RLS desligada em public_profiles';
  END IF;
  SELECT count(*) INTO v_total FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass;
  IF v_total <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261219: public_profiles tem % politicas (esperado 1)', v_total;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polrelid = 'public.public_profiles'::regclass
                AND (0::oid = ANY (p.polroles) OR to_regrole('anon') = ANY (p.polroles))) THEN
    RAISE EXCEPTION 'conferencia 20261219: politica de public_profiles alcanca PUBLIC ou anon';
  END IF;

  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT pg_get_expr(p.polqual, p.polrelid),
         array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
                                 FROM unnest(p.polroles) AS x ORDER BY 1), ',')
    INTO v_qual, v_roles
    FROM pg_policy p
   WHERE p.polrelid = 'public.public_profiles'::regclass
     AND p.polname = 'public_profiles_select_policy'
     AND p.polcmd = 'r' AND p.polpermissive AND p.polwithcheck IS NULL;
  PERFORM set_config('search_path', v_caminho, true);

  IF v_roles IS DISTINCT FROM 'authenticated' OR v_qual IS DISTINCT FROM E'((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (EXISTS ( SELECT 1\n   FROM public.reviews r\n  WHERE ((r.user_id = public_profiles.id) AND (r.status = ''publicada''::text)))) OR (EXISTS ( SELECT 1\n   FROM public.questions q\n  WHERE (q.user_id = public_profiles.id))))' THEN
    RAISE EXCEPTION 'conferencia 20261219: public_profiles_select_policy nao e a desta migration (papeis %, USING %)', COALESCE(v_roles, '-'), COALESCE(v_qual, 'nulo');
  END IF;
END $conferencia_20261219$;

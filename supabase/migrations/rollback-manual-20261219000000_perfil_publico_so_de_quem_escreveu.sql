-- ============================================================================
-- Rollback manual — a lista de perfis públicos só aparece para quem está
-- logado, e só com quem escreveu algo na vitrine (20261219000000)
-- ============================================================================
-- Devolve a política vigente antes da migration (baseline 20260806000000,
-- medida nas duas lojas pela consulta 22m em 12/10/2026: uma política só,
-- SELECT, permissiva, papel PUBLIC, `USING (true)`):
--   CREATE POLICY public_profiles_select_policy ON public.public_profiles
--     FOR SELECT USING (true);
-- Com ela, qualquer pessoa (logada ou não) volta a listar todos os perfis
-- públicos.
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261219$` recusa com
-- `B1_BASELINE_DIVERGENT` — ANTES de qualquer escrita — se `public_profiles`
-- não tiver exatamente uma política, ou se ela não for a que a 20261219000000
-- deixou nem a vigente de antes (rodar duas vezes deixa o mesmo estado).
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma
-- transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261219$
DECLARE
  v_caminho text;
  v_total integer;
  v_nome text;
  v_qual text;
  v_check text;
  v_cmd text;
  v_perm boolean;
  v_roles text;
BEGIN
  SELECT count(*) INTO v_total FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass;
  IF v_total <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.public_profiles tem % políticas (esperado 1) — revise antes de reverter.', v_total;
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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: política % em public_profiles (comando %, papéis %, USING %) não é a que a 20261219000000 deixou — revise antes de reverter.', COALESCE(v_nome, '-'), COALESCE(v_cmd, '-'), COALESCE(v_roles, '-'), COALESCE(v_qual, 'nulo');
  END IF;
END $preflight_rollback_20261219$;

DROP POLICY IF EXISTS public_profiles_select_policy ON public.public_profiles;
CREATE POLICY public_profiles_select_policy ON public.public_profiles FOR SELECT USING (true);

DO $conferencia_rollback_20261219$
BEGIN
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy p
                     WHERE p.polrelid = 'public.public_profiles'::regclass
                       AND p.polname = 'public_profiles_select_policy'
                       AND p.polcmd = 'r' AND p.polpermissive
                       AND p.polroles = ARRAY[0::oid]
                       AND pg_get_expr(p.polqual, p.polrelid) = 'true'
                       AND p.polwithcheck IS NULL) THEN
    RAISE EXCEPTION 'conferencia rollback 20261219: public_profiles_select_policy nao voltou a ser USING (true) para PUBLIC';
  END IF;
END $conferencia_rollback_20261219$;

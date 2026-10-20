-- ============================================================================
-- Rollback manual — a foto do perfil tem teto de tamanho e duas portas do
-- painel deixam de atender o visitante sem login (20261218000000)
-- ============================================================================
-- Devolve o estado medido nas duas lojas (IKCOUS e Savy, consulta 22m de
-- 12/10/2026) antes da migration:
--   * apaga o gatilho `tr_perfil_recusa_imagem_grande` de `profiles` e a função
--     `perfil_recusa_imagem_grande()` (a foto e a capa voltam a não ter teto);
--   * `get_segmented_push_count(text, numeric, integer)`: EXECUTE de volta a
--     PUBLIC e anon (authenticated e service_role já têm; o corpo nunca mudou);
--   * `vw_produtos_admin`: SELECT e REFERENCES de volta a anon (só isso: a
--     escrita do anon foi tirada pela 20261090000000 e não volta).
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261218$` recusa com
-- `B1_BASELINE_DIVERGENT` — ANTES de qualquer escrita — se o corpo de
-- `get_segmented_push_count` não for o vigente, ou se a função de gatilho
-- existir com um corpo que não é o da 20261218000000 (redefinição posterior).
-- Rodar duas vezes deixa o mesmo estado (DROP IF EXISTS e GRANT).
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma
-- transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261218$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.get_segmented_push_count(text,numeric,integer)');
  IF v_hash IS DISTINCT FROM 'e5f6b76afd6ec75df32f168d9942e209' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.get_segmented_push_count(text,numeric,integer) (hash %) não é o vigente — revise antes de reverter.', COALESCE(v_hash, 'ausente');
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.perfil_recusa_imagem_grande()');
  IF v_hash IS NOT NULL AND v_hash <> '57552d1ca161fb4176e28ab63c2932f8' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.perfil_recusa_imagem_grande() (hash %) não é a que a 20261218000000 deixou — revise antes de reverter.', v_hash;
  END IF;
END $preflight_rollback_20261218$;

DROP TRIGGER IF EXISTS tr_perfil_recusa_imagem_grande ON public.profiles;
DROP FUNCTION IF EXISTS public.perfil_recusa_imagem_grande();

GRANT EXECUTE ON FUNCTION public.get_segmented_push_count(text, numeric, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_segmented_push_count(text, numeric, integer) TO anon;

GRANT SELECT, REFERENCES ON TABLE public.vw_produtos_admin TO anon;

DO $conferencia_rollback_20261218$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'tr_perfil_recusa_imagem_grande')
     OR to_regprocedure('public.perfil_recusa_imagem_grande()') IS NOT NULL THEN
    RAISE EXCEPTION 'conferencia rollback 20261218: o gatilho ou a funcao do teto da imagem continua no banco';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                  WHERE p.oid = to_regprocedure('public.get_segmented_push_count(text,numeric,integer)')
                    AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR NOT has_function_privilege('anon', 'public.get_segmented_push_count(text,numeric,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261218: o EXECUTE de PUBLIC/anon na contagem do push nao voltou';
  END IF;
  IF NOT has_table_privilege('anon', 'public.vw_produtos_admin', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.vw_produtos_admin', 'REFERENCES') THEN
    RAISE EXCEPTION 'conferencia rollback 20261218: o SELECT de anon na vw_produtos_admin nao voltou';
  END IF;
END $conferencia_rollback_20261218$;

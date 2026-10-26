-- ============================================================================
-- Migration 20261391100000 — ninguém grava evento de análise pela API
-- (superfície sem uso; caçada de segurança de 26/10/2026, item C)
-- ============================================================================
--
-- ⚠️ NÃO ADITIVA — RESTRINGE PERMISSÃO e tem um DROP POLICY (não é função recriada). Pela carta branca
-- de 07/09 só migration ADITIVA aplica sem o dono: ESTA PARA NELE, com o SQL abaixo mostrado. Não apaga
-- tabela, coluna nem linha: os eventos que já existem ficam onde estão.
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- `public.analytics_events` aceita INSERT de qualquer conta logada (`authenticated` tem GRANT INSERT e a
-- `analytics_events_insert_policy` da 20261112000000 só exige user_id = auth.uid()), com `metadata` jsonb
-- e `event_type` sem teto de tamanho: uma conta criada de graça enche a tabela em laço. E NINGUÉM do app
-- grava ali — medido de novo em 26/10/2026 neste lote:
--   * src/ e supabase/functions/: nenhum `.from("analytics_events")` nem INSERT (só os tipos gerados);
--   * supabase/migrations/: nenhuma função (SECURITY DEFINER ou não) insere em analytics_events — as
--     únicas leituras são as políticas, a 20261178 (que já diz "o app não grava analytics_events hoje")
--     e o roteiro de privacidade (UPDATE … SET user_id = NULL, rodado como postgres/service_role).
-- Uma porta de escrita aberta que nenhum caminho usa é só superfície.
--
-- 2. O QUE MUDA
--
--   * REVOKE INSERT ON public.analytics_events FROM authenticated (anon já não tinha desde a
--     20261112000000). service_role e postgres seguem gravando (o dono da tabela e o servidor).
--   * DROP POLICY analytics_events_insert_policy — sem o GRANT ela não servia a ninguém; uma política
--     de INSERT parada é convite a alguém devolver o GRANT achando que "a RLS protege".
-- O SELECT do admin (analytics_events_select_policy, 20261340000000) não muda. Os GRANTs residuais de
-- UPDATE/DELETE/TRUNCATE/… de anon e authenticated (privilégio padrão do schema) ficam como estão: a RLS
-- já os nega (nenhuma política de UPDATE/DELETE) — fora do escopo, registrado na 20261112000000.
--
-- 3. DADOS EXISTENTES: nenhuma linha é lida, reescrita ou apagada.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- A tabela tem de existir com RLS ligada. A política, se existir, tem de ser EXATAMENTE a da
-- 20261112000000 (INSERT, PERMISSIVE, só authenticated, WITH CHECK auth.uid() = user_id); se já não
-- existir, `authenticated` também não pode ter INSERT (estado desta migration = reaplicar é no-op).
-- Nenhuma OUTRA política de INSERT/ALL pode existir na tabela (alguém a usa; medir antes). E nenhuma
-- função do schema public pode conter INSERT em analytics_events (alguém passou a gravar; não revogar
-- por cima — medir).
--
-- 5. IDEMPOTÊNCIA E TRANSAÇÃO: REVOKE de privilégio ausente e DROP POLICY IF EXISTS são no-op; rodar
-- duas vezes deixa o mesmo estado. Sem BEGIN/COMMIT de nível superior (regra da casa).
--
-- 6. ROLLBACK MANUAL: rollback-manual-20261391100000_ninguem_grava_evento_de_analise_pela_api.sql
-- recria a política da 20261112000000 exatamente e devolve o GRANT INSERT ao authenticated.
--
-- 7. FICHA DE VERIFICAÇÃO: consultas 99a (depois) / 99b (antes).
--   PROVA VIVA: tests/banco/ninguem-grava-evento-de-analise-pela-api-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261391100000$
DECLARE
  v_tab regclass := to_regclass('public.analytics_events');
  v_pol record;
BEGIN
  IF v_tab IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.analytics_events não existe.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_tab AND relkind = 'r' AND relrowsecurity) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.analytics_events sem RLS ligada — meça a loja e revise.';
  END IF;
  SELECT p.polcmd, p.polpermissive, p.polroles, p.polqual,
         regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '[[:space:]]', '', 'g') AS chk
    INTO v_pol
    FROM pg_policy p WHERE p.polrelid = v_tab AND p.polname = 'analytics_events_insert_policy';
  IF FOUND THEN
    IF v_pol.polcmd <> 'a' OR NOT v_pol.polpermissive OR v_pol.polroles <> ARRAY['authenticated'::regrole::oid]
       OR v_pol.polqual IS NOT NULL OR v_pol.chk IS DISTINCT FROM '((SELECTauth.uid()ASuid)=user_id)' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: analytics_events_insert_policy não é a da 20261112000000 — capture-a e revise.';
    END IF;
  ELSIF has_table_privilege('authenticated', v_tab, 'INSERT') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a política já não existe mas authenticated ainda tem INSERT — estado desconhecido; revise.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polrelid = v_tab AND p.polcmd IN ('a', '*')
                AND p.polname <> 'analytics_events_insert_policy') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: há outra política de INSERT/ALL em analytics_events — alguém grava ali; meça antes de revogar.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?"?analytics_events') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: uma função de public grava em analytics_events — não revogar por cima; meça e revise.';
  END IF;
END $preflight_20261391100000$;

REVOKE INSERT ON public.analytics_events FROM authenticated;
DROP POLICY IF EXISTS analytics_events_insert_policy ON public.analytics_events;

DO $conferencia_20261391100000$
BEGIN
  IF has_table_privilege('authenticated', 'public.analytics_events', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.analytics_events', 'INSERT')
     OR has_table_privilege('anon', 'public.analytics_events', 'INSERT')
     OR has_any_column_privilege('anon', 'public.analytics_events', 'INSERT') THEN
    RAISE EXCEPTION 'conferencia 20261391100000: anon ou authenticated ainda grava em analytics_events';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polrelid = 'public.analytics_events'::regclass AND p.polcmd IN ('a', '*')) THEN
    RAISE EXCEPTION 'conferencia 20261391100000: sobrou política de INSERT/ALL em analytics_events';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = 'public.analytics_events'::regclass
                    AND p.polname = 'analytics_events_select_policy' AND p.polcmd = 'r') THEN
    RAISE EXCEPTION 'conferencia 20261391100000: a leitura do admin (analytics_events_select_policy) sumiu';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.analytics_events', 'INSERT') THEN
    RAISE EXCEPTION 'conferencia 20261391100000: service_role perdeu INSERT em analytics_events';
  END IF;
END $conferencia_20261391100000$;

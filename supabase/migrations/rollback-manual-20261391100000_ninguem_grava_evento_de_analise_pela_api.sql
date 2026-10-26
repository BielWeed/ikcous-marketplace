-- ============================================================================
-- Rollback manual — ninguém grava evento de análise pela API (20261391100000)
-- ============================================================================
-- Recria `analytics_events_insert_policy` exatamente como a
-- 20261112000000_analytics_events_para_de_aceitar_gravacao_anonima.sql a deixou:
--   FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id)
-- e devolve o GRANT INSERT ON public.analytics_events ao `authenticated` (o privilégio padrão do schema
-- que a migration tirou; o ACL da tabela volta a ser o de antes, conferido pela prova viva).
--
-- ⚠️ EFEITO: reabre a porta de escrita — qualquer conta logada volta a gravar eventos sem limite de
-- tamanho. Só executar se algum caminho do app passar a precisar gravar ali (e aí o certo é teto de
-- tamanho, não esta porta aberta).
--
-- DADOS: nenhum. A migration não apagou nem reescreveu evento algum.
--
-- PRÉ-VOO: recusa com B1_BASELINE_DIVERGENT, ANTES de qualquer escrita, se a política ainda existir ou
-- se authenticated já tiver INSERT (nada a desfazer, ou outro estado no ar).
--
-- Executar via psql -1 -f (nunca pelo db-apply). Sem BEGIN/COMMIT de nível superior neste arquivo.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261391100000$
BEGIN
  IF to_regclass('public.analytics_events') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.analytics_events não existe.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polrelid = 'public.analytics_events'::regclass AND p.polname = 'analytics_events_insert_policy')
     OR has_table_privilege('authenticated', 'public.analytics_events', 'INSERT') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: analytics_events não está no estado que a 20261391100000 deixou (a política existe ou authenticated grava) — nada a desfazer; revise antes de reverter.';
  END IF;
END $preflight_rollback_20261391100000$;

GRANT INSERT ON public.analytics_events TO authenticated;

CREATE POLICY analytics_events_insert_policy ON public.analytics_events
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DO $conferencia_rollback_20261391100000$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.analytics_events', 'INSERT') THEN
    RAISE EXCEPTION 'conferencia do rollback 20261391100000: authenticated não voltou a ter INSERT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = 'public.analytics_events'::regclass AND p.polname = 'analytics_events_insert_policy'
                    AND p.polcmd = 'a' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid]
                    AND regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '[[:space:]]', '', 'g')
                        = '((SELECTauth.uid()ASuid)=user_id)') THEN
    RAISE EXCEPTION 'conferencia do rollback 20261391100000: analytics_events_insert_policy não voltou igual à da 20261112000000';
  END IF;
END $conferencia_rollback_20261391100000$;

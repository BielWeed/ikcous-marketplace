-- ROLLBACK MANUAL da 20261112000000_analytics_events_para_de_aceitar_gravacao_anonima.sql
--
-- Corpo VIVO byte a byte, medido em 08/09/2026 com `pg_get_expr(polwithcheck,
-- polrelid)` + `polroles::regrole[]` e `information_schema.role_table_grants`
-- contra os DOIS bancos (principal e o clone Savy — idênticos neste ponto):
--
--   analytics_events_insert_policy roles={-} (PUBLIC, sem TO)
--     WITH CHECK: (((( SELECT auth.uid() AS uid) IS NULL) AND (user_id IS NULL))
--                  OR (( SELECT auth.uid() AS uid) = user_id))
--   GRANT INSERT ON public.analytics_events TO anon  (estava concedido)
--
-- ⚠️ EFEITO COLATERAL HONESTO: este rollback REABRE o furo do I-4 — `anon`
-- volta a gravar em `analytics_events` sem limite e sem login. Só executar
-- se a migration estiver causando dano comprovado.

DROP POLICY IF EXISTS analytics_events_insert_policy ON public.analytics_events;

CREATE POLICY analytics_events_insert_policy ON public.analytics_events
  FOR INSERT
  WITH CHECK (
    ((SELECT auth.uid()) IS NULL AND user_id IS NULL)
    OR (SELECT auth.uid()) = user_id
  );

GRANT INSERT ON public.analytics_events TO anon;

-- ============================================================================
-- ROLLBACK MANUAL — 20261072000000 (RPC registrar_estorno_manual)
-- ============================================================================
-- Desfaz a migration: a função deixa de existir e o botão "Já estornei" do
-- painel volta a falhar (o balde "Devolver agora" volta a depender do
-- webhook — que ninguém jamais observou chegar; ver o achado L-2 do laudo).
-- ============================================================================

DROP FUNCTION IF EXISTS public.registrar_estorno_manual(uuid);

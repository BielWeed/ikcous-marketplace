-- Issue #120 (AUTH-030) — fecha a enumeracao de e-mails cadastrados.
--
-- check_user_confirmation_status(p_email text) e' SECURITY DEFINER, consulta
-- auth.users por e-mail e devolve {exists, confirmed}. O GRANT de origem
-- (20260628100000_add_user_confirmation_check.sql:30-31) liberou EXECUTE
-- para anon E authenticated, sem rate limit: um visitante jogando uma lista
-- de e-mails no endpoint REST descobria quem tem conta e quem confirmou. Uma
-- revogacao anterior (_arquivadas/20260708120000_..._rls_and_rpc_hardening.
-- sql:438) foi desfeita pelo GRANT de :486 do mesmo arquivo — nunca chegou a
-- valer em producao.
--
-- Unico chamador no repositorio, medido com grep em src/ e supabase/ em
-- 12/08/2026: src/contexts/AuthContext.tsx, resetPassword. Este mesmo diff
-- troca essa chamada por supabase.auth.resetPasswordForEmail direto (que por
-- design do Supabase Auth nao confirma nem nega a existencia da conta) —
-- revogar aqui sem aquele ajuste deixaria a tela de recuperar senha quebrada
-- com erro de permissao.
--
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

REVOKE EXECUTE ON FUNCTION public.check_user_confirmation_status(text)
  FROM anon, authenticated, PUBLIC;

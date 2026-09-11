-- ============================================================================
-- Rollback manual — o perfil público lê avaliações e perguntas pela
-- vitrine do autor (20261130000000)
-- ============================================================================
-- Reverter PRIMEIRO o front que chama `perfil_publico_avaliacoes`/
-- `perfil_publico_perguntas`; só depois executar este arquivo — na ordem
-- contrária, o visitante sem sessão volta a ver "—" na vitrine do autor na
-- hora, porque o front antigo não tem outro caminho de leitura para quem
-- não está logado. Executar sob transação externa (db-apply ou psql -1).
-- Remove só as duas RPCs criadas por esta migration e seus grants;
-- `reviews`, `questions`, `answers`, `produtos` e as views públicas não são
-- tocadas. `IF EXISTS` permite repetir este rollback sem erro caso as
-- funções já tenham sido removidas.
-- ============================================================================

DROP FUNCTION IF EXISTS public.perfil_publico_avaliacoes(uuid);
DROP FUNCTION IF EXISTS public.perfil_publico_perguntas(uuid);

-- ============================================================================
-- Rollback manual — a caderneta da frota (20261141000000)
-- ============================================================================
-- Reverter PRIMEIRO o porteiro (T3, `resolverConexao`/`middleware.ts`) e
-- `frota-estado.cjs` (que passam a depender desta caderneta); só depois
-- executar este arquivo. Na ordem contrária, o porteiro cai no caminho (b)
-- do brief (ambiente do próprio projeto Vercel, sem consultar a caderneta —
-- funciona igual, só não sabe mais listar a frota inteira) e o
-- `frota-estado.cjs` responde `CADASTRO NAO MEDIDO` em vez de listar as
-- lojas. Executar sob transação externa (db-apply ou psql -1).
--
-- Remove só o que esta migration criou: `resolver_loja`, `frota_lojas`,
-- `frota_segredo`. Nenhuma outra tabela é tocada. `IF EXISTS` em todos os
-- três `DROP` permite repetir este rollback sem erro caso já tenham sido
-- removidos. A função é derrubada ANTES das tabelas (nenhuma dependência
-- rígida de fato — `RETURNS TABLE` não gera dependência de `pg_depend`
-- contra as tabelas nomeadas dentro do corpo — mas a ordem evita qualquer
-- erro de objeto pendente).
--
-- DADOS: se `frota_lojas`/`frota_segredo` já tiverem sido semeadas pela hub
-- (fora desta migration), este rollback APAGA essas linhas junto com a
-- tabela — não há como derrubar a tabela e preservar o dado. Confirmar que
-- não há outra loja/segredo de produção precisando sobreviver antes de
-- rodar isto de verdade.
-- ============================================================================

DROP FUNCTION IF EXISTS public.resolver_loja(text, text);
DROP TABLE IF EXISTS public.frota_segredo;
DROP TABLE IF EXISTS public.frota_lojas;

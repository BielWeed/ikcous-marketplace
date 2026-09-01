-- ============================================================================
-- ROLLBACK MANUAL — 20261070000000 (grants de coluna de produtos)
-- ============================================================================
-- ATENÇÃO: este rollback REABRE o vazamento da margem em loja clonada
-- (anon/authenticated voltam a poder ler `produtos.custo` pela porta REST).
-- Só executar se a migration causar dano comprovado, e reaplicar a migration
-- assim que o dano for tratado.
--
-- Estado restaurado: os grants PADRÃO de projeto Supabase novo (SELECT de
-- TABELA para anon e authenticated).
-- ============================================================================

GRANT SELECT ON public.produtos TO anon;
GRANT SELECT ON public.produtos TO authenticated;

-- O REVOKE de escrita não existiu nesta migration; nada mais a desfazer.
-- Conferência do rollback (deve voltar tudo true):
--   SELECT has_column_privilege('anon','public.produtos','custo','SELECT');
--   SELECT has_column_privilege('authenticated','public.produtos','custo','SELECT');

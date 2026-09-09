-- ============================================================================
-- Rollback manual — reordenar banners numa transação só (issue #499)
-- ============================================================================
-- Reverter PRIMEIRO o front que chama reorder_banners_atomic; só depois
-- remover a função. Executar sob transação externa (db-apply ou psql -1).
-- Remove somente a nova RPC e seus grants; swap_banner_order permanece.
-- Não altera banners nem desfaz trocas concluídas. IF EXISTS permite
-- repetir este rollback sem erro caso a função já tenha sido removida.
-- ============================================================================

DROP FUNCTION IF EXISTS public.reorder_banners_atomic(text, uuid, uuid);

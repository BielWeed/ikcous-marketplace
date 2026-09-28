-- ============================================================================
-- Rollback manual — O contador duplicado do cupom morre (20261188000000)
-- ============================================================================
-- Recria a coluna como era no baseline (baseline:3892). Os valores voltam 0
-- — a migration só apagou quando TODAS as linhas eram 0, então nada se perde.
-- SEM BEGIN/COMMIT (regra da casa).

ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS used_count integer DEFAULT 0;

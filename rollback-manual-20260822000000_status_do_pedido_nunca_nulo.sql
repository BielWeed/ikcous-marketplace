-- Rollback de: 20260822000000_status_do_pedido_nunca_nulo.sql
--
-- Desfaz o NOT NULL e o DEFAULT. NAO desfaz o backfill (`UPDATE ... SET
-- status = 'pending' WHERE status IS NULL`): a migration original nao grava
-- em nenhum lugar de onde `pending` veio, entao nao ha como distinguir, apos
-- o fato, uma linha que era NULA daquelas que ja nasceram 'pending'. Reverter
-- o backfill devolveria pedidos validos ao estado quebrado que esta migration
-- existe para eliminar — por isso ele fica de fora deste rollback.

ALTER TABLE public.marketplace_orders
  ALTER COLUMN status DROP NOT NULL;

ALTER TABLE public.marketplace_orders
  ALTER COLUMN status DROP DEFAULT;

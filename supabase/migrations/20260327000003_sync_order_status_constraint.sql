-- 20260327_sync_order_status_constraint.sql
-- Goal: Update marketplace_orders_status_check to support 'pending' status
-- Reference: create_marketplace_order_v21 and frontend expect 'pending'

BEGIN;

-- 1. Remover a restrição antiga que está causando erro 23514
ALTER TABLE public.marketplace_orders 
DROP CONSTRAINT IF EXISTS marketplace_orders_status_check;

-- 2. Adicionar a nova restrição atualizada com os status corretos
ALTER TABLE public.marketplace_orders 
ADD CONSTRAINT marketplace_orders_status_check 
CHECK (status IN ('pending', 'processing', 'shipping', 'delivered', 'cancelled', 'new'));

-- 3. Garantir consistência: atualizar pedidos antigos 'new' para 'pending'
-- Isso garante que o dashboard administrativo (que filtra por pending) veja pedidos novos legados.
UPDATE public.marketplace_orders 
SET status = 'pending' 
WHERE status = 'new';

COMMIT;

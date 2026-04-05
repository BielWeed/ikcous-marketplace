-- 20260327_fix_order_address_fk.sql
-- Goal: Add foreign key constraint to enable automatic joins in Supabase

BEGIN;

-- 1. Ensure any invalid address_id in marketplace_orders is set to NULL to prevent FK violation during constraint creation
UPDATE public.marketplace_orders
SET address_id = NULL
WHERE address_id IS NOT NULL 
AND NOT EXISTS (SELECT 1 FROM public.user_addresses WHERE id = marketplace_orders.address_id);

-- 2. Add the foreign key constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_marketplace_orders_address' 
        AND table_name = 'marketplace_orders'
    ) THEN
        ALTER TABLE public.marketplace_orders
        ADD CONSTRAINT fk_marketplace_orders_address
        FOREIGN KEY (address_id) 
        REFERENCES public.user_addresses(id)
        ON DELETE SET NULL;
    END IF;
END $$;

COMMIT;

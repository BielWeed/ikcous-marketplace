-- Add created_by column to marketplace_order_history to support atomic status updates
ALTER TABLE public.marketplace_order_history 
ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

-- Update existing records if possible (optional but good practice)
-- UPDATE public.marketplace_order_history SET created_by = ... WHERE created_by IS NULL;

-- Ensure RLS is updated if needed (it already matches is_admin or owner)
-- Actually, the RLS in 20260314_harden_admin_rpcs_and_history_rls.sql uses order ownership
-- so adding the column doesn't break RLS, but it's good to have it for auditing.

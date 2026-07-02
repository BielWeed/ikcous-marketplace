-- Migration: fix_cart_items_unique_constraint
-- Fix for cart_items unique constraint to prevent duplicates when variant_id is NULL
-- Update existing NULLs to empty string
UPDATE public.cart_items SET variant_id = '' WHERE variant_id IS NULL;

-- Modify column to have a default empty string and be NOT NULL
ALTER TABLE public.cart_items 
    ALTER COLUMN variant_id SET DEFAULT '',
    ALTER COLUMN variant_id SET NOT NULL;

-- The existing UNIQUE(user_id, product_id, variant_id) will now work as intended 
-- since '' is a distinct value and not NULL.

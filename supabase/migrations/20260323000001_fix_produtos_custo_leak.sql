-- app_mkt/supabase/migrations/20260323_fix_produtos_custo_leak.sql
-- Fix: Remove broad RLS policy exposing 'custo' column and implement security definer view
-- Revised to avoid 42P16 error by using DROP VIEW CASCADE and including all public columns.

BEGIN;

-------------------------------------------------------------------------------
-- 1. Database Cleanup
-------------------------------------------------------------------------------

-- Drop the view first to avoid dependency/compatibility issues
-- We use CASCADE to handle any dependent objects (like other views or functions)
DROP VIEW IF EXISTS public.vw_produtos_public CASCADE;

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Public view active products" ON public.produtos;
DROP POLICY IF EXISTS "Produtos are viewable by everyone" ON public.produtos;

-- Ensure RLS is enabled
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- 2. Security Definer Logic
-------------------------------------------------------------------------------

-- Create a helper function that runs as the owner (postgres)
-- This allows access to the base table regardless of the requester's RLS.
CREATE OR REPLACE FUNCTION public.get_active_products_internal()
RETURNS SETOF public.produtos
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    -- Return only non-deleted, active products
    -- The owner (postgres) bypasses RLS
    SELECT * FROM public.produtos 
    WHERE ativo = true 
    AND (deleted_at IS NULL);
$$;

-- Revoke execute from public first for safety, then grant to selected roles
REVOKE EXECUTE ON FUNCTION public.get_active_products_internal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_products_internal() TO anon, authenticated, service_role;

-------------------------------------------------------------------------------
-- 3. Hardened View
-------------------------------------------------------------------------------

-- Re-create the public view using the secure internal function.
-- We EXPLICITLY list all public columns, EXCLUDING 'custo' if it exists.
-- If 'custo' is NOT in the table, this will still work and future-proof it.
CREATE OR REPLACE VIEW public.vw_produtos_public AS
SELECT 
    id,
    nome,
    descricao,
    preco_venda,
    preco_original,
    estoque,
    imagem_url,
    imagem_urls,
    categoria,
    ativo,
    data_cadastro,
    tags,
    meta_title,
    meta_description,
    is_bestseller,
    frete_gratis,
    sold,
    rating,
    review_count,
    calculated_points
FROM public.get_active_products_internal();

-- Ensure permissions on the view
GRANT SELECT ON public.vw_produtos_public TO anon, authenticated;

-------------------------------------------------------------------------------
-- 4. Final Table Restrictions
-------------------------------------------------------------------------------

-- Block direct SELECT on 'produtos' table for anon/authenticated
REVOKE SELECT ON public.produtos FROM anon, authenticated;

-- Ensure Admins can still see everything directly on the table
DROP POLICY IF EXISTS "Admins full access on products" ON public.produtos;
CREATE POLICY "Admins full access on products" 
ON public.produtos 
FOR ALL 
TO authenticated
USING (public.is_admin());

COMMIT;

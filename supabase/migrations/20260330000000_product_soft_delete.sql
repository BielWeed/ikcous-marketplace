-- Migration: Implement Soft Delete for Products
-- Objective: Prevent hard deletion of products to maintain historical order integrity.

BEGIN;

-- 1. Add deleted_at column
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Update the public view to exclude soft-deleted products
DROP VIEW IF EXISTS public.vw_produtos_public;
CREATE VIEW public.vw_produtos_public AS
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
    calculated_points
FROM public.produtos
WHERE ativo = true AND deleted_at IS NULL;

-- 3. Update RLS for non-admins to exclude soft-deleted items
-- (Non-admins usually use the view, but if they access the table directly...)
DROP POLICY IF EXISTS "Produtos are viewable by everyone" ON public.produtos;
CREATE POLICY "Produtos are viewable by everyone" ON public.produtos
FOR SELECT USING (deleted_at IS NULL OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

COMMIT;

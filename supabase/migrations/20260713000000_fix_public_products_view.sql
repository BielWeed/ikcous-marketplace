-- Migration: Fix Public Products View (vw_produtos_public)
-- Date: 2026-07-13
-- Version: 20260713000000
-- Goal: Remove security_invoker to allow anonymous SELECT without exposing 'custo' column, and include missing columns for shipping calculations and reviews.

BEGIN;

DROP VIEW IF EXISTS public.vw_produtos_public CASCADE;

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
    calculated_points,
    codigo,
    ultima_atualizacao,
    rating,
    review_count,
    peso_kg,
    largura_cm,
    altura_cm,
    comprimento_cm
FROM public.produtos
WHERE ((ativo = true) AND (deleted_at IS null));

GRANT SELECT ON public.vw_produtos_public TO anon, authenticated, service_role;

COMMIT;

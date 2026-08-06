-- Migration: Add ultima_atualizacao to public.vw_produtos_public view
-- Objective: Ensure public view exposes product-level ultima_atualizacao for catch-up synchronization.

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
    ultima_atualizacao
FROM public.produtos
WHERE ativo = true AND deleted_at IS null;

GRANT SELECT ON public.vw_produtos_public TO anon, authenticated;

COMMIT;

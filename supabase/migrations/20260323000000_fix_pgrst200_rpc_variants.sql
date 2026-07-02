-- app_mkt/supabase/migrations/20260323_fix_pgrst200_rpc_variants.sql
-- Fix: Resumes resource embedding for views by using a dedicated RPC.

BEGIN;

-- Create the RPC function to get products with their variants in a single JSON call
-- This bypasses the PostgREST "Could not find a relationship" (PGRST200) error.
CREATE OR REPLACE FUNCTION public.get_products_with_variants()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        jsonb_build_object(
            'id', p.id,
            'nome', p.nome,
            'descricao', p.descricao,
            'preco_venda', p.preco_venda,
            'preco_original', p.preco_original,
            'imagem_url', p.imagem_url,
            'imagem_urls', p.imagem_urls,
            'categoria', p.categoria,
            'estoque', p.estoque,
            'sold', p.sold,
            'ativo', p.ativo,
            'is_bestseller', p.is_bestseller,
            'frete_gratis', p.frete_gratis,
            'data_cadastro', p.data_cadastro,
            'tags', p.tags,
            'meta_title', p.meta_title,
            'meta_description', p.meta_description,
            'rating', p.rating,
            'review_count', p.review_count,
            'calculated_points', p.calculated_points,
            'product_variants', COALESCE(
                (SELECT jsonb_agg(v) 
                 FROM (
                     SELECT 
                        id, 
                        product_id, 
                        sku, 
                        name, 
                        value, 
                        stock_increment, 
                        price_override, 
                        active 
                     FROM public.product_variants 
                     WHERE product_id = p.id AND active = true
                     ORDER BY name ASC
                 ) v
                ), '[]'::jsonb
            )
        )
    FROM public.vw_produtos_public p
    ORDER BY p.data_cadastro DESC;
END;
$$;

-- Grant execution permissions
REVOKE EXECUTE ON FUNCTION public.get_products_with_variants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_products_with_variants() TO anon, authenticated, service_role;

COMMIT;

-- Solo-Ninja Security Hardening v24
-- Objective: Fix financial leak (custo) and harden PII access (profiles/addresses)

BEGIN;

-- 1. Create a secure view for public product consumption (EXCLUDING 'custo')
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
    sold
FROM public.produtos
WHERE ativo = true;

-- Grant access to the view
GRANT SELECT ON public.vw_produtos_public TO anon, authenticated;

-- 2. Harden 'profiles' RLS to prevent PII exposure (email, phone, etc)
-- Only Admins can see all profiles. Users can only see their own COMPLETE profile.
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Profiles viewable by self or admin"
ON public.profiles
FOR SELECT
USING (
    auth.uid() = id 
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- 3. Harden 'user_addresses' RLS (BOLA check)
DROP POLICY IF EXISTS "Users can view own addresses" ON public.user_addresses;
CREATE POLICY "Users can view own addresses" 
ON public.user_addresses FOR SELECT 
USING (auth.uid() = user_id OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

COMMIT;

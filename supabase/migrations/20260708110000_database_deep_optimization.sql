-- Migration: Deep Database Optimization and Hardening
-- Date: 2026-07-08
-- Version: 20260708110000

BEGIN;

-- ============================================================================
-- 1. RECREATE FOREIGN KEY INDEXES (Performance)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id
ON public.analytics_events (user_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_order_history_created_by
ON public.marketplace_order_history (created_by);

CREATE INDEX IF NOT EXISTS idx_marketplace_order_history_order_id
ON public.marketplace_order_history (order_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_order_items_variant_id
ON public.marketplace_order_items (variant_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_address_id
ON public.marketplace_orders (address_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_coupon_id
ON public.marketplace_orders (coupon_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
ON public.push_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id
ON public.user_addresses (user_id);


-- ============================================================================
-- 2. OPTIMIZE RLS POLICIES (wrapping auth functions in SELECT)
-- ============================================================================

-- Table: public.store_shipping_credentials
DROP POLICY IF EXISTS "Admins have full access to shipping credentials" ON public.store_shipping_credentials;
CREATE POLICY "Admins have full access to shipping credentials" ON public.store_shipping_credentials
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

-- Table: public.shipping_calculation_logs
DROP POLICY IF EXISTS "Admins have full access to shipping calculation logs" ON public.shipping_calculation_logs;
CREATE POLICY "Admins have full access to shipping calculation logs" ON public.shipping_calculation_logs
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

-- Table: public.banners
DROP POLICY IF EXISTS banners_select_policy ON public.banners;
CREATE POLICY banners_select_policy ON public.banners
FOR SELECT TO public USING (
    active = true
    OR ((SELECT auth.role()) = 'authenticated' AND public.is_admin())
);

-- Table: public.coupons
DROP POLICY IF EXISTS coupons_select_policy ON public.coupons;
CREATE POLICY coupons_select_policy ON public.coupons
FOR SELECT TO public USING (
    active = true
    OR ((SELECT auth.role()) = 'authenticated' AND public.is_admin())
);

-- Table: public.produtos
DROP POLICY IF EXISTS produtos_select_policy ON public.produtos;
CREATE POLICY produtos_select_policy ON public.produtos
FOR SELECT TO public USING (
    ativo = true
    OR ((SELECT auth.role()) = 'authenticated' AND public.is_admin())
);

-- Table: public.questions
DROP POLICY IF EXISTS questions_insert_policy ON public.questions;
CREATE POLICY questions_insert_policy ON public.questions
FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT null);

-- Table: public.reviews
DROP POLICY IF EXISTS reviews_insert_policy ON public.reviews;
CREATE POLICY reviews_insert_policy ON public.reviews
FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT null);

-- Table: public.marketplace_orders
DROP POLICY IF EXISTS marketplace_orders_select_policy ON public.marketplace_orders;
CREATE POLICY marketplace_orders_select_policy ON public.marketplace_orders
FOR SELECT TO authenticated USING (
    ((SELECT auth.uid()) = user_id) OR public.is_admin()
);


-- ============================================================================
-- 3. RECREATE VIEWS WITH security_invoker = on (Security)
-- ============================================================================

-- View: public.vw_questions_with_answers_count
DROP VIEW IF EXISTS public.vw_questions_with_answers_count CASCADE;
CREATE OR REPLACE VIEW public.vw_questions_with_answers_count WITH (
    security_invoker = on
) AS
SELECT
    q.id,
    q.product_id,
    q.user_id,
    q.question,
    q.created_at,
    COALESCE((
        SELECT (COUNT(*))::integer AS count
        FROM public.answers AS a
        WHERE (a.question_id = q.id)
    ), 0) AS answers_count
FROM public.questions AS q;

-- View: public.vw_produtos_public
DROP VIEW IF EXISTS public.vw_produtos_public CASCADE;
CREATE OR REPLACE VIEW public.vw_produtos_public WITH (security_invoker = on) AS
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
WHERE ((ativo = true) AND (deleted_at IS null));

-- View: public.v_store_config
DROP VIEW IF EXISTS public.v_store_config CASCADE;
CREATE OR REPLACE VIEW public.v_store_config WITH (security_invoker = on) AS
SELECT
    id,
    free_shipping_min,
    shipping_fee,
    whatsapp_number,
    share_text,
    business_hours,
    enable_reviews,
    enable_coupons,
    primary_color,
    theme_mode,
    logo_url,
    real_time_sales_alerts,
    push_marketing_enabled,
    min_app_version,
    origin_cep,
    shipping_provider,
    enabled_shipping_methods,
    created_at,
    updated_at
FROM public.store_config
WHERE (id = 1);

-- View: public.sales_overview
DROP VIEW IF EXISTS public.sales_overview CASCADE;
CREATE OR REPLACE VIEW public.sales_overview WITH (security_invoker = on) AS
SELECT
    DATE_TRUNC('day'::text, created_at) AS sales_day,
    COUNT(id) AS total_orders,
    SUM(total) AS gross_revenue,
    AVG(total) AS average_ticket,
    SUM(
        CASE
            WHEN (status = 'completed'::text) THEN total
            ELSE (0)::numeric
        END
    ) AS net_revenue
FROM public.marketplace_orders
GROUP BY (DATE_TRUNC('day'::text, created_at))
ORDER BY (DATE_TRUNC('day'::text, created_at)) DESC;

-- Restore view grants
GRANT SELECT ON public.vw_questions_with_answers_count TO anon,
authenticated,
service_role;
GRANT SELECT ON public.vw_produtos_public TO anon, authenticated, service_role;
GRANT SELECT ON public.v_store_config TO anon, authenticated, service_role;
GRANT SELECT ON public.sales_overview TO authenticated, service_role;


-- ============================================================================
-- 4. CONVERT public_profiles VIEW TO PHYSICAL TABLE AND SYNC TRIGGER (Perf & Security)
-- ============================================================================

-- Drop the existing view
DROP VIEW IF EXISTS public.public_profiles CASCADE;

-- Create the physical table
CREATE TABLE IF NOT EXISTS public.public_profiles (
    id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
    full_name text,
    avatar_url text,
    created_at timestamp with time zone,
    cover_url text
);

-- Enable RLS
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access
DROP POLICY IF EXISTS public_profiles_select_policy ON public.public_profiles;
CREATE POLICY public_profiles_select_policy ON public.public_profiles
FOR SELECT TO public USING (true);

-- Create sync trigger function
CREATE OR REPLACE FUNCTION public.handle_public_profile_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.public_profiles (id, full_name, avatar_url, created_at, cover_url)
        VALUES (NEW.id, NEW.full_name, NEW.avatar_url, NEW.created_at, NEW.cover_url)
        ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            avatar_url = EXCLUDED.avatar_url,
            cover_url = EXCLUDED.cover_url;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.public_profiles (id, full_name, avatar_url, created_at, cover_url)
        VALUES (NEW.id, NEW.full_name, NEW.avatar_url, NEW.created_at, NEW.cover_url)
        ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            avatar_url = EXCLUDED.avatar_url,
            cover_url = EXCLUDED.cover_url;
    ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM public.public_profiles WHERE id = OLD.id;
    END IF;
    RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS sync_public_profile ON public.profiles;
CREATE TRIGGER sync_public_profile
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.handle_public_profile_sync();

-- Backfill existing profiles
INSERT INTO public.public_profiles (
    id, full_name, avatar_url, created_at, cover_url
)
SELECT
    id,
    full_name,
    avatar_url,
    created_at,
    cover_url
FROM public.profiles
ON CONFLICT (id) DO UPDATE SET
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    cover_url = excluded.cover_url;

-- Grant permissions to public_profiles table
GRANT SELECT ON public.public_profiles TO anon, authenticated, service_role;


-- ============================================================================
-- 5. HARDENING AND CLEANUP
-- ============================================================================

-- Update search_path for handle_updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Drop the unused test function
DROP FUNCTION IF EXISTS public.test_lang();

COMMIT;

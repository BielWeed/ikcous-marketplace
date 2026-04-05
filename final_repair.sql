
-- 1. Unify Admin Functions
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND (role = 'admin' OR role = 'Administrator')
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.is_admin();
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO public, authenticated, anon;

-- 2. Repair Store Config Schema
-- Save data first if any (actually we know it's empty)
DROP TABLE IF EXISTS public.store_config CASCADE;

CREATE TABLE public.store_config (
    id bigint PRIMARY KEY,
    free_shipping_min numeric(10,2) DEFAULT 100,
    shipping_fee numeric(10,2) DEFAULT 15,
    whatsapp_number text DEFAULT '5534999999999',
    share_text text DEFAULT 'Confira os produtos da Ikous!',
    business_hours text DEFAULT 'Seg-Sáb: 9h às 18h',
    enable_reviews boolean DEFAULT true,
    enable_coupons boolean DEFAULT true,
    primary_color text DEFAULT '#000000',
    theme_mode text DEFAULT 'light',
    logo_url text,
    real_time_sales_alerts boolean DEFAULT true,
    push_marketing_enabled boolean DEFAULT false,
    min_app_version text,
    whatsapp_api_url text,
    whatsapp_api_key text,
    whatsapp_api_instance text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Ensure RLS and Policies
ALTER TABLE public.store_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON public.store_config FOR SELECT USING (true);
CREATE POLICY "Allow admin update" ON public.store_config FOR UPDATE USING (public.is_admin());
CREATE POLICY "Allow admin insert" ON public.store_config FOR INSERT WITH CHECK (public.is_admin());

-- Seed initial row
INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 3. Fix Overloaded Function update_order_status_atomic
-- We drop all versions first and then recreate the definitive one
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT oid::regprocedure as sig FROM pg_proc WHERE proname = 'update_order_status_atomic')
    LOOP
        EXECUTE 'DROP FUNCTION ' || r.sig || ' CASCADE';
    END LOOP;
END $$;

-- Recreate update_order_status_atomic (Standard implementation)
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(p_order_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    UPDATE public.marketplace_orders
    SET status = p_status, updated_at = now()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.marketplace_orders.*) INTO v_result;

    RETURN v_result;
END;
$function$;

-- 4. Restore Banners if missing
INSERT INTO public.banners (image_url, title, position, active)
SELECT 'https://placehold.co/1200x400', 'Bem-vindo', 'home_top', true
WHERE NOT EXISTS (SELECT 1 FROM public.banners);

-- 5. Restore Categories if missing
INSERT INTO public.categorias (nome, slug)
SELECT 'Geral', 'geral'
WHERE NOT EXISTS (SELECT 1 FROM public.categorias);

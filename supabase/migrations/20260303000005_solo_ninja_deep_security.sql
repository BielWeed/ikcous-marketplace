-- Security Hardening Patch v2 - Solo Ninja
-- Date: 2026-03-03
-- Objective: Fix critical BOLA/IDOR in orders and enforce strict RLS

-- 1. Orders (marketplace_orders)
-- The previous policy allowed users to UPDATE and DELETE their own orders (bypass constraints).
DROP POLICY IF EXISTS "Admins full access, users see own orders" ON public.marketplace_orders;

CREATE POLICY "Users can SELECT their own orders" 
ON public.marketplace_orders FOR SELECT 
USING (auth.uid() = user_id);

-- Admins retain all control
CREATE POLICY "Admins have ALL access to orders" 
ON public.marketplace_orders FOR ALL 
USING (public.is_admin());

-- 2. Order Items
DROP POLICY IF EXISTS "Admins full access, users see through orders" ON public.marketplace_order_items;

CREATE POLICY "Users can SELECT their own order items" 
ON public.marketplace_order_items FOR SELECT 
USING (exists (select 1 from public.marketplace_orders where id = order_id and user_id = auth.uid()));

CREATE POLICY "Admins have ALL access to order items" 
ON public.marketplace_order_items FOR ALL 
USING (public.is_admin());

-- 3. User Addresses Protection
-- Ensure RLS is enabled and strictly scoped to users managing their own records.
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "Admins can manage all addresses" ON public.user_addresses;

CREATE POLICY "Users can manage their own addresses" 
ON public.user_addresses FOR ALL 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can manage all addresses" 
ON public.user_addresses FOR ALL 
USING (public.is_admin());

-- 4. Store Config Protection
-- Hardening upsert_store_config to ensure only admins can modify store configurations
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
RETURNS void AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso Negado: Apenas administradores podem alterar as configuracoes.';
    END IF;

    INSERT INTO public.store_config (
        id, free_shipping_min, shipping_fee, whatsapp_number, share_text, business_hours, 
        enable_reviews, enable_coupons, popup_delay, primary_color, logo_url, theme_mode, 
        real_time_sales_alerts, push_marketing_enabled, min_app_version
    )
    VALUES (
        1,
        (config_json->>'free_shipping_min')::numeric,
        (config_json->>'shipping_fee')::numeric,
        config_json->>'whatsapp_number',
        config_json->>'share_text',
        config_json->>'business_hours',
        (config_json->>'enable_reviews')::boolean,
        (config_json->>'enable_coupons')::boolean,
        (config_json->>'popup_delay')::integer,
        config_json->>'primary_color',
        config_json->>'logo_url',
        config_json->>'theme_mode',
        (config_json->>'real_time_sales_alerts')::boolean,
        (config_json->>'push_marketing_enabled')::boolean,
        config_json->>'min_app_version'
    )
    ON CONFLICT (id) DO UPDATE SET
        free_shipping_min = COALESCE((config_json->>'free_shipping_min')::numeric, store_config.free_shipping_min),
        shipping_fee = COALESCE((config_json->>'shipping_fee')::numeric, store_config.shipping_fee),
        whatsapp_number = COALESCE(config_json->>'whatsapp_number', store_config.whatsapp_number),
        share_text = COALESCE(config_json->>'share_text', store_config.share_text),
        business_hours = COALESCE(config_json->>'business_hours', store_config.business_hours),
        enable_reviews = COALESCE((config_json->>'enable_reviews')::boolean, store_config.enable_reviews),
        enable_coupons = COALESCE((config_json->>'enable_coupons')::boolean, store_config.enable_coupons),
        popup_delay = COALESCE((config_json->>'popup_delay')::integer, store_config.popup_delay),
        primary_color = COALESCE(config_json->>'primary_color', store_config.primary_color),
        logo_url = COALESCE(config_json->>'logo_url', store_config.logo_url),
        theme_mode = COALESCE(config_json->>'theme_mode', store_config.theme_mode),
        real_time_sales_alerts = COALESCE((config_json->>'real_time_sales_alerts')::boolean, store_config.real_time_sales_alerts),
        push_marketing_enabled = COALESCE((config_json->>'push_marketing_enabled')::boolean, store_config.push_marketing_enabled),
        min_app_version = COALESCE(config_json->>'min_app_version', store_config.min_app_version),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

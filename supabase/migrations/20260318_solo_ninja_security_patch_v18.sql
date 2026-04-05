-- ==============================================================================
-- 🥷 SOLO-NINJA SECURITY PATCH v18 - DEFINITIVE HARDENING
-- ==============================================================================
-- Target: Critical RPCs and Table Policies (BOLA, PII, Privilege Escalation)

BEGIN;

-- 1. HARDEN ADMIN RPCs (PII & Strategy Protection)
-- Add explicit is_admin() checks to prevent data leaks.

CREATE OR REPLACE FUNCTION public.get_customer_intelligence()
 RETURNS TABLE(customer_id uuid, customer_name text, total_spent numeric, order_count bigint, last_order_at timestamp with time zone, ltv_score numeric, is_push_subscribed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: Privilégios de administrador necessários.';
    END IF;

    RETURN QUERY
    SELECT 
        p.id as customer_id,
        p.full_name as customer_name,
        COALESCE(SUM(o.total_amount), 0)::numeric as total_spent,
        COUNT(o.id) as order_count,
        MAX(o.created_at) as last_order_at,
        (COALESCE(SUM(o.total_amount), 0) * 0.7 + COUNT(o.id) * 0.3)::numeric as ltv_score,
        EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = p.id) as is_push_subscribed
    FROM public.profiles p
    LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
    GROUP BY p.id, p.full_name
    ORDER BY ltv_score DESC
    LIMIT 20;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_health()
 RETURNS TABLE(product_id uuid, product_name text, current_stock integer, sales_last_30d bigint, days_remaining numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    RETURN QUERY
    WITH product_sales AS (
        SELECT oi.product_id, SUM(oi.quantity) as total_qty
        FROM public.marketplace_order_items oi
        JOIN public.marketplace_orders o ON o.id = oi.order_id
        WHERE o.created_at >= NOW() - INTERVAL '30 days' AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY oi.product_id
    )
    SELECT 
        p.id as product_id,
        p.nome as product_name,
        p.estoque as current_stock,
        COALESCE(ps.total_qty, 0) as sales_last_30d,
        CASE WHEN ps.total_qty IS NULL OR ps.total_qty = 0 THEN 999 ELSE (p.estoque::NUMERIC / (ps.total_qty::NUMERIC / 30.0)) END as days_remaining
    FROM public.produtos p
    LEFT JOIN product_sales ps ON ps.product_id = p.id
    WHERE p.estoque < 20 OR (ps.total_qty > 0 AND (p.estoque::NUMERIC / (ps.total_qty::NUMERIC / 30.0)) < 7)
    ORDER BY days_remaining ASC;
END;
$$;

-- 2. FIX BOLA: update_order_status_atomic
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL::text, p_silent boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
BEGIN
    -- SECURITY CHECK: Admin or Order Owner only
    SELECT status, user_id INTO v_old_status, v_user_id FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
    
    IF v_old_status IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF v_user_id != v_caller_id AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: BOLA detectada.';
    END IF;

    -- Update Order
    UPDATE public.marketplace_orders 
    SET status = p_new_status, updated_at = NOW() 
    WHERE id = p_order_id;

    -- Log History
    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, v_old_status, p_new_status, p_notes, v_caller_id);
END;
$$;

-- 3. FIX PRIVILEGE ESCALATION: upsert_store_config
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- SECURITY: Admin Check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;

  INSERT INTO public.store_config (
    id, free_shipping_min, shipping_fee, whatsapp_number, share_text, 
    business_hours, enable_reviews, enable_coupons, primary_color, 
    theme_mode, logo_url, real_time_sales_alerts, push_marketing_enabled, 
    min_app_version
  )
  VALUES (
    1,
    COALESCE((config_json->>'free_shipping_min')::numeric, 100),
    COALESCE((config_json->>'shipping_fee')::numeric, 15),
    COALESCE(config_json->>'whatsapp_number', '5534999999999'),
    COALESCE(config_json->>'share_text', 'Confira os produtos!'),
    COALESCE(config_json->>'business_hours', 'Seg-Sáb: 9h às 18h'),
    COALESCE((config_json->>'enable_reviews')::boolean, true),
    COALESCE((config_json->>'enable_coupons')::boolean, true),
    COALESCE(config_json->>'primary_color', '#000000'),
    COALESCE(config_json->>'theme_mode', 'light'),
    config_json->>'logo_url',
    COALESCE((config_json->>'real_time_sales_alerts')::boolean, true),
    COALESCE((config_json->>'push_marketing_enabled')::boolean, false),
    config_json->>'min_app_version'
  )
  ON CONFLICT (id) DO UPDATE SET
    free_shipping_min = EXCLUDED.free_shipping_min,
    shipping_fee = EXCLUDED.shipping_fee,
    whatsapp_number = EXCLUDED.whatsapp_number,
    share_text = EXCLUDED.share_text,
    business_hours = EXCLUDED.business_hours,
    enable_reviews = EXCLUDED.enable_reviews,
    enable_coupons = EXCLUDED.enable_coupons,
    primary_color = EXCLUDED.primary_color,
    theme_mode = EXCLUDED.theme_mode,
    logo_url = EXCLUDED.logo_url,
    real_time_sales_alerts = EXCLUDED.real_time_sales_alerts,
    push_marketing_enabled = EXCLUDED.push_marketing_enabled,
    min_app_version = EXCLUDED.min_app_version,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

-- 4. HARDEN ANSWERS (Public Protection)
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Only admins can manage answers" ON public.answers;
DROP POLICY IF EXISTS "Authenticated users can answer" ON public.answers;

CREATE POLICY "Admins manage answers"
ON public.answers
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 5. RPC swap_banner_order protection
CREATE OR REPLACE FUNCTION public.swap_banner_order(banner_id_1 uuid, banner_id_2 uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
    order_1 INTEGER;
    order_2 INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    SELECT "order" INTO order_1 FROM public.banners WHERE id = banner_id_1;
    SELECT "order" INTO order_2 FROM public.banners WHERE id = banner_id_2;

    IF order_1 IS NULL OR order_2 IS NULL THEN
        RAISE EXCEPTION 'Banner não encontrado.';
    END IF;

    UPDATE public.banners SET "order" = order_2 WHERE id = banner_id_1;
    UPDATE public.banners SET "order" = order_1 WHERE id = banner_id_2;
END;
$$;

-- 6. RPC get_coupon_stats protection
CREATE OR REPLACE FUNCTION public.get_coupon_stats()
 RETURNS TABLE(total_coupons bigint, active_coupons bigint, total_uses bigint, avg_discount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        COUNT(*) FILTER (WHERE active = true)::BIGINT,
        SUM(usage_count)::BIGINT,
        AVG(value)::NUMERIC
    FROM public.coupons;
END;
$$;

COMMIT;

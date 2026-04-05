-- Phase 11: Patch Remaining RPCs (Coupons, Banners, Reviews)
-- Secures RPCs that were lacking auth or admin checks.

BEGIN;

-- 1. get_coupon_stats (Admin Only)
CREATE OR REPLACE FUNCTION public.get_coupon_stats()
RETURNS TABLE (
    total_coupons BIGINT,
    active_coupons BIGINT,
    total_uses BIGINT,
    avg_discount NUMERIC
) AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        COUNT(*) FILTER (WHERE active = true)::BIGINT,
        SUM(usage_count)::BIGINT,
        AVG(value)::NUMERIC
    FROM public.coupons;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. swap_banner_order (Admin Only)
CREATE OR REPLACE FUNCTION public.swap_banner_order(banner_id_1 UUID, banner_id_2 UUID)
RETURNS void AS $$
DECLARE
    order_1 INTEGER;
    order_2 INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    SELECT "order" INTO order_1 FROM public.banners WHERE id = banner_id_1;
    SELECT "order" INTO order_2 FROM public.banners WHERE id = banner_id_2;

    UPDATE public.banners SET "order" = order_2 WHERE id = banner_id_1;
    UPDATE public.banners SET "order" = order_1 WHERE id = banner_id_2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. increment_helpful (Authenticated User Only)
-- Checks if user is authenticated before incrementing the helpful count.
CREATE OR REPLACE FUNCTION public.increment_helpful(review_id UUID)
RETURNS void AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    UPDATE public.reviews 
    SET helpful = COALESCE(helpful, 0) + 1 
    WHERE id = review_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

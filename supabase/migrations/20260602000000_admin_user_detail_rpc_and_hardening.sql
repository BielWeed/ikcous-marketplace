-- Migration: consolidated secure RPC for admin user detail lookup
BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_user_detail(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile JSONB;
    v_orders JSONB;
    v_cart_items JSONB;
    v_addresses JSONB;
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Fetch profile info (join auth.users to get email)
    SELECT JSONB_BUILD_OBJECT(
        'id', p.id,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'whatsapp', p.whatsapp,
        'role', p.role,
        'created_at', p.created_at,
        'email', u.email
    ) INTO v_profile
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_user_id;

    -- 2. Fetch marketplace orders (including order items)
    SELECT COALESCE(JSONB_AGG(o_data), '[]'::JSONB) INTO v_orders
    FROM (
        SELECT 
            mo.*,
            COALESCE(
                (
                    SELECT JSONB_AGG(item) 
                    FROM public.marketplace_order_items item 
                    WHERE item.order_id = mo.id
                ), 
                '[]'::JSONB
            ) as items
        FROM public.marketplace_orders mo
        WHERE mo.user_id = p_user_id
        ORDER BY mo.created_at DESC
    ) o_data;

    -- 3. Fetch cart items
    SELECT COALESCE(JSONB_AGG(c), '[]'::JSONB) INTO v_cart_items
    FROM public.cart_items c
    WHERE c.user_id = p_user_id;

    -- 4. Fetch user addresses
    SELECT COALESCE(JSONB_AGG(a), '[]'::JSONB) INTO v_addresses
    FROM public.user_addresses a
    WHERE a.user_id = p_user_id;

    -- Return Consolidated Object
    RETURN JSONB_BUILD_OBJECT(
        'profile', v_profile,
        'orders', v_orders,
        'cart_items', v_cart_items,
        'addresses', v_addresses
    );
END;
$$;

COMMIT;

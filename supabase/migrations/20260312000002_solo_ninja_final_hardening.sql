-- 20260312_solo_ninja_final_hardening.sql
-- Solo-Ninja Security Protocol: Final Blindagem & PII Protection
-- Objective: Fix PII Leak in profiles, suppress notification spam, and harden WhatsApp search.

BEGIN;

-- 1. PROFILES: Fix PII Leak (Vulnerability #1)
-- Only allow sensitive data (email/phone) to be seen by the owner and admins.
-- We use a more restrictive policy and ensure and admin check.
DROP POLICY IF EXISTS "Public profile limited view" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by self or admin" ON public.profiles;

-- Allow general view of public info (name, avatar, etc)
-- Note: Sensitive info filtering must happen at the SELECT level, 
-- but RLS filters the entire row. We keep it focused on self or admin for maximum safety.
CREATE POLICY "Profiles visibility: self or admin" 
ON public.profiles 
FOR SELECT 
TO authenticated
USING (auth.uid() = id OR public.is_admin());

-- 2. NOTIFICAÇÕES: Anti-Spam (Vulnerability #2)
-- Remove any legacy policies that allow public insertion.
DROP POLICY IF EXISTS "System and authenticated users can insert notifications" ON public.notificacoes;
DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.notificacoes;
DROP POLICY IF EXISTS "Protected notification insertion" ON public.notificacoes;

-- Strictly allow insertion ONLY if it's for yourself or if you are admin (via system/trust)
CREATE POLICY "Final notification protection"
ON public.notificacoes
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = usuario_id OR public.is_admin()
);

-- 3. WHATSAPP SEARCH: High Entropy Hardening (Vulnerability #3)
-- Require a tracking code or order ID to increase entropy against PII scans.
CREATE OR REPLACE FUNCTION public.get_orders_by_whatsapp_v2(
    p_phone_number TEXT,
    p_email TEXT,
    p_order_fragment TEXT -- Last 4 chars of an order ID or tracking code
)
RETURNS SETOF public.marketplace_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- 1. Validate Core Identity
    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE (phone = p_phone_number OR raw_user_meta_data->>'whatsapp' = p_phone_number) 
      AND email = p_email;

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    -- 2. Validate Order Fragment (Proof of knowledge)
    -- This prevents someone with just phone+email from seeing all orders.
    IF NOT EXISTS (
        SELECT 1 FROM public.marketplace_orders 
        WHERE user_id = v_user_id 
        AND (id::text LIKE '%' || p_order_fragment OR tracking_code LIKE '%' || p_order_fragment)
    ) THEN
        RETURN;
    END IF;

    -- 3. Return orders
    RETURN QUERY 
    SELECT * FROM marketplace_orders 
    WHERE user_id = v_user_id
    ORDER BY created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v2(TEXT, TEXT, TEXT) TO anon, authenticated;

-- Old version cleanup
DROP FUNCTION IF EXISTS public.get_orders_by_whatsapp_hardened(TEXT, TEXT);

COMMIT;

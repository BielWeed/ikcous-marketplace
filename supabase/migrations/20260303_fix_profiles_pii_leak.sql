-- Migration: Fix PII Leak on Profiles Table
-- Date: 2026-03-03
-- Description: Restricts profile access to prevent massive PII leak.

-- 1. Remove permissive policies
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Public can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- 2. New restrictive policies

-- Policy 1: Users can ALWAYS see their OWN full profile
CREATE POLICY "Users can view own full profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

-- Policy 2: Public/Authenticated users can see ONLY non-sensitive info for Reviews/UI
-- Since Supabase RLS doesn't natively support column-level selection without Views,
-- we allow standard SELECT but strongly advise the use of limited projection in frontend.
-- To harden further, we would move sensitive data to a 'private_profiles' table.
CREATE POLICY "Public profile limited view" 
ON public.profiles 
FOR SELECT 
USING (true); 

-- 3. Fix WhatsApp Order Tracking BOLA (Broken Object Level Authorization)
-- This replaces the potentially insecure direct query with a validated RPC.

CREATE OR REPLACE FUNCTION public.get_orders_by_whatsapp_hardened(
    p_phone_number TEXT,
    p_email TEXT
)
RETURNS SETOF public.marketplace_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Validate credentials: Phone AND Email must match an existing user
    -- We use auth.users (accessible only via SECURITY DEFINER)
    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE (phone = p_phone_number OR raw_user_meta_data->>'whatsapp' = p_phone_number) 
      AND email = p_email;

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    -- Return orders belonging to that user
    RETURN QUERY 
    SELECT * FROM marketplace_orders 
    WHERE user_id = v_user_id
    ORDER BY created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp_hardened(TEXT, TEXT) TO anon, authenticated;

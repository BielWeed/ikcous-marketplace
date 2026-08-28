-- Migration: Add User Confirmation Check Function
-- Date: 2026-06-28
-- Description: Creates the check_user_confirmation_status RPC to check if an email exists and is confirmed.

CREATE OR REPLACE FUNCTION public.check_user_confirmation_status(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_confirmed boolean;
    v_exists boolean;
BEGIN
    SELECT 
        (email_confirmed_at IS NOT NULL),
        true
    INTO v_confirmed, v_exists
    FROM auth.users
    WHERE email = LOWER(TRIM(p_email))
    LIMIT 1;

    RETURN jsonb_build_object(
        'exists', COALESCE(v_exists, false),
        'confirmed', COALESCE(v_confirmed, false)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_user_confirmation_status(text) TO anon,
authenticated;

COMMENT ON FUNCTION public.check_user_confirmation_status(
    text
) IS 'Verifica se um e-mail existe na base de auth do Supabase e se já foi confirmado.';

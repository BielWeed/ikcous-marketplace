-- Migration: Add p_avatar_url to update_my_profile_secure RPC
-- Date: 2026-07-07

-- Drop old function signature
DROP FUNCTION IF EXISTS public.update_my_profile_secure(text, text);

-- Create new function signature with p_avatar_url
CREATE OR REPLACE FUNCTION public.update_my_profile_secure(
    p_full_name text DEFAULT NULL,
    p_whatsapp text DEFAULT NULL,
    p_avatar_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE profiles
    SET 
        full_name = COALESCE(p_full_name, full_name),
        whatsapp = COALESCE(p_whatsapp, whatsapp),
        avatar_url = CASE 
            WHEN p_avatar_url = 'REMOVE' THEN NULL 
            ELSE COALESCE(p_avatar_url, avatar_url) 
        END,
        updated_at = NOW()
    WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_my_profile_secure(
    text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.update_my_profile_secure(
    text, text, text
) IS 'Updates the profile of the authenticated user including avatar_url.';

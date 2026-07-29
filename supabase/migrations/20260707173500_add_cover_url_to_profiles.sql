-- Migration: Add cover_url to profiles and update RPCs
-- Date: 2026-07-07

-- 1. Add cover_url column if it doesn't exist
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cover_url text DEFAULT NULL;

-- 2. Drop existing functions to allow signature changes
DROP FUNCTION IF EXISTS public.get_my_complete_profile();
DROP FUNCTION IF EXISTS public.update_my_profile_secure(text, text, text);

-- 3. Recreate get_my_complete_profile() RPC with cover_url included
CREATE OR REPLACE FUNCTION public.get_my_complete_profile()
RETURNS TABLE (
    id uuid,
    full_name text,
    whatsapp text,
    role text,
    avatar_url text,
    created_at timestamptz,
    cover_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id, 
        p.full_name, 
        p.whatsapp, 
        p.role, 
        p.avatar_url, 
        p.created_at,
        p.cover_url
    FROM profiles p
    WHERE p.id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_complete_profile() TO anon,
authenticated;
COMMENT ON FUNCTION public.get_my_complete_profile() IS 'Returns the authenticated user''s profile, including the cover_url field.';

-- 4. Recreate update_my_profile_secure() RPC with cover_url option
CREATE OR REPLACE FUNCTION public.update_my_profile_secure(
    p_full_name text DEFAULT NULL,
    p_whatsapp text DEFAULT NULL,
    p_avatar_url text DEFAULT NULL,
    p_cover_url text DEFAULT NULL
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
        cover_url = CASE 
            WHEN p_cover_url = 'REMOVE' THEN NULL 
            ELSE COALESCE(p_cover_url, cover_url) 
        END,
        updated_at = NOW()
    WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_my_profile_secure(
    text, text, text, text
) TO authenticated;
COMMENT ON FUNCTION public.update_my_profile_secure(
    text, text, text, text
) IS 'Updates the profile of the authenticated user including avatar_url and cover_url.';

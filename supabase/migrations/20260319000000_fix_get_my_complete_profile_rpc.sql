-- Migration: Fix get_my_complete_profile RPC Error
-- Date: 2026-03-19
-- Description: Redefines the RPC to remove the non-existent loyalty_points column.

CREATE OR REPLACE FUNCTION public.get_my_complete_profile()
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    whatsapp TEXT,
    role TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ
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
        p.created_at
    FROM profiles p
    WHERE p.id = auth.uid();
END;
$$;

-- Ensure proper permissions
GRANT EXECUTE ON FUNCTION public.get_my_complete_profile() TO anon, authenticated;

-- Add a comment for documentation
COMMENT ON FUNCTION public.get_my_complete_profile() IS 'Returns the authenticated user''s profile. Removed loyalty_points as it is now dynamic.';

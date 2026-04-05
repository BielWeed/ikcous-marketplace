-- Simplified Fix
DROP FUNCTION IF EXISTS public.get_my_complete_profile();

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
    FROM public.profiles p
    WHERE p.id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_complete_profile() TO anon, authenticated, service_role;

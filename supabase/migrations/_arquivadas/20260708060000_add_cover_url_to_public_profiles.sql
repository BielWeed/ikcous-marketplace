-- Migration: Add cover_url to public_profiles view
-- Description: Updates the public_profiles view to include the cover_url column.

CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
    id,
    full_name,
    avatar_url,
    created_at,
    cover_url
FROM public.profiles;

-- Ensure permissions are granted
GRANT SELECT ON public.public_profiles TO anon, authenticated;

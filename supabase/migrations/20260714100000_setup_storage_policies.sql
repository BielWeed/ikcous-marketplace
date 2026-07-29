-- Migration: Setup storage policies for products, produtos, and banners buckets.
-- This ensures authenticated administrators can upload, update, and delete files.

-- Enable Row Level Security (should already be enabled, but ensure it is)
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 1. DROP EXISTING POLICIES TO AVOID CONFLICTS
DROP POLICY IF EXISTS "Admin Insert Access (banners)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Insert Access (products)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Insert Access (produtos)" ON storage.objects;

DROP POLICY IF EXISTS "Admin Update Access (banners)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Update Access (products)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Update Access (produtos)" ON storage.objects;

DROP POLICY IF EXISTS "Admin Delete Access (banners)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Delete Access (products)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Delete Access (produtos)" ON storage.objects;

-- 2. CREATE INSERT POLICIES (Admins only)
CREATE POLICY "Admin Insert Access (banners)" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (
        bucket_id = 'banners' AND (SELECT public.is_admin())
    );

CREATE POLICY "Admin Insert Access (products)" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (
        bucket_id = 'products' AND (SELECT public.is_admin())
    );

CREATE POLICY "Admin Insert Access (produtos)" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (
        bucket_id = 'produtos' AND (SELECT public.is_admin())
    );

-- 3. CREATE UPDATE POLICIES (Admins only)
CREATE POLICY "Admin Update Access (banners)" ON storage.objects
    FOR UPDATE TO authenticated USING (
        bucket_id = 'banners' AND (SELECT public.is_admin())
    );

CREATE POLICY "Admin Update Access (products)" ON storage.objects
    FOR UPDATE TO authenticated USING (
        bucket_id = 'products' AND (SELECT public.is_admin())
    );

CREATE POLICY "Admin Update Access (produtos)" ON storage.objects
    FOR UPDATE TO authenticated USING (
        bucket_id = 'produtos' AND (SELECT public.is_admin())
    );

-- 4. CREATE DELETE POLICIES (Admins only)
CREATE POLICY "Admin Delete Access (banners)" ON storage.objects
    FOR DELETE TO authenticated USING (
        bucket_id = 'banners' AND (SELECT public.is_admin())
    );

CREATE POLICY "Admin Delete Access (products)" ON storage.objects
    FOR DELETE TO authenticated USING (
        bucket_id = 'products' AND (SELECT public.is_admin())
    );

CREATE POLICY "Admin Delete Access (produtos)" ON storage.objects
    FOR DELETE TO authenticated USING (
        bucket_id = 'produtos' AND (SELECT public.is_admin())
    );

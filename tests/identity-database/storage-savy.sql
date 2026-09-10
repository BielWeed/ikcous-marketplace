CREATE POLICY "Admin Delete Access (banners)" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'banners'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Delete Access (products)" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'products'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Insert Access (banners)" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'banners'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Insert Access (products)" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'products'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Update Access (banners)" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'banners'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Update Access (products)" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'products'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Leitura publica (banners)" ON storage.objects AS PERMISSIVE FOR SELECT TO anon,authenticated USING ((bucket_id = 'banners'::text));
CREATE POLICY "Leitura publica (products)" ON storage.objects AS PERMISSIVE FOR SELECT TO anon,authenticated USING ((bucket_id = 'products'::text));

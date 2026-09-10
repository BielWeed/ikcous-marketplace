CREATE POLICY "Admin Delete Access (banners)" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'banners'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Delete Access (products)" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'products'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Delete Access (produtos)" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'produtos'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "Admin Insert Access (banners)" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'banners'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Insert Access (products)" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'products'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Insert Access (produtos)" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'produtos'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "Admin Update Access (banners)" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'banners'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Update Access (products)" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'products'::text) AND ( SELECT is_admin() AS is_admin)));
CREATE POLICY "Admin Update Access (produtos)" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'produtos'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "Public Display" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'products'::text));
CREATE POLICY "Public Read Access" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'produtos'::text));
CREATE POLICY "Public Read Banners Bucket" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'banners'::text));

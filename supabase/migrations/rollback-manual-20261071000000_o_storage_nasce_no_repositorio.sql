-- ============================================================================
-- ROLLBACK MANUAL — 20261071000000 (storage nasce no repositório)
-- ============================================================================
-- Desfaz a migration: apaga as policies criadas e os buckets (SE estiverem
-- vazios — Postgres não apaga bucket com objetos; esvaziar antes).
--
-- ATENÇÃO: executar o rollback deixa o projeto provisionado só-migrations SEM
-- storage de novo (loja não sobe foto). Só executar em caso de dano
-- comprovado da migration.
--
-- Para restaurar TAMBÉM as policies largas que a migration derrubou no molde
-- (Estado anterior exato — NÃO recomendado: reabre escrita de banner para
-- qualquer usuário logado), recriá-las assim:
--   CREATE POLICY "Authenticated Upload Banners Bucket" ON storage.objects
--     FOR INSERT TO authenticated WITH CHECK (bucket_id = 'banners');
--   CREATE POLICY "Authenticated Update Banners Bucket" ON storage.objects
--     FOR UPDATE TO authenticated USING (bucket_id = 'banners');
--   CREATE POLICY "Authenticated Delete Banners Bucket" ON storage.objects
--     FOR DELETE TO authenticated USING (bucket_id = 'banners');
-- ============================================================================

DROP POLICY IF EXISTS "Admin Insert Access (banners)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Insert Access (products)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Update Access (banners)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Update Access (products)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Delete Access (banners)" ON storage.objects;
DROP POLICY IF EXISTS "Admin Delete Access (products)" ON storage.objects;

DELETE FROM storage.buckets WHERE id IN ('products', 'banners');
-- Se o bucket tiver objetos, o DELETE acima falha (FK de storage.objects);
-- esvaziar o bucket antes torna o rollback destrutivo — preferir NÃO rodar.

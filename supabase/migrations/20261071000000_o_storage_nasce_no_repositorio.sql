-- ============================================================================
-- Migration 20261071000000 — o STORAGE (buckets + policies) nasce no
-- repositório (laudo varredura profunda #2, achado I-2, 01/09/2026)
-- ============================================================================
--
-- O PROBLEMA: o baseline exclui o schema storage (20260806:58) e a ÚNICA
-- migration com policies de storage está ARQUIVADA (_arquivadas/20260714,
-- com aviso "não restaurar"). Um projeto novo provisionado só com as
-- migrations vivas nasce SEM bucket e SEM policy de storage:
--   * sem bucket -> o lojista não consegue subir UMA foto (loja sem vitrine
--     no dia 1, que aparece como "app quebrado", não como aviso);
--   * ou o operador improvisa à mão no dashboard -> loja com storage
--     artesanal, sem as travas admin-only.
--
-- O QUE ESTA MIGRATION FAZ (idempotente):
--   1. cria os buckets que o front usa (useProducts/useBanners: `products`,
--      `banners`), públicos como no molde (getPublicUrl serve por URL);
--   2. cria as NOVE policies admin-only de escrita (Insert/Update/Delete ×
--      bucket), no estilo da arquivada, guardadas por public.is_admin();
--   3. DERUBA as três policies LARGAS de banner do molde
--      ("Authenticated Upload/Delete/Update Banners Bucket" — qualquer
--      usuário LOGADO podia subir/apagar banner pela API, sem ser admin;
--      achado NOVO da inspeção de 01/09, registrado no recado da onda).
--      No clone novo os DROPs são no-op (nada para derrubar).
--
-- DELIBERADO FORA (e por quê):
--   * bucket legado `produtos` do molde: lixo histórico, sem consumidor no
--     front — clone não nasce com ele; faxina do molde é outro dia;
--   * policies SELECT de listagem do molde ("Public Display", "Public Read
--     Access", "Public Read Banners Bucket" TO authenticated): o front não
--     usa .list() (grep zero em src/), buckets públicos servem por URL —
--     clone nasce sem elas; as do molde ficam (inofensivas).
--
-- COMO PROVAR (ficha db-prove, padrão da casa — medição em conexão nova):
--   node scripts/db-prove-grants-e-storage-nascem.cjs
-- Provas de ROLLBACK: rollback-manual-20261071000000_*.sql versionado junto.
-- SEM BEGIN/COMMIT (regra da casa: o ROLLBACK da prova viraria no-op).
-- ============================================================================

-- 1. Buckets que o front usa, públicos como no molde --------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
    ('products', 'products', true),
    ('banners', 'banners', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Policies admin-only de escrita (o molde vivo, replicado) -----------------
-- INSERT ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin Insert Access (banners)" ON storage.objects;
CREATE POLICY "Admin Insert Access (banners)" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (
        bucket_id = 'banners' AND (SELECT public.is_admin())
    );

DROP POLICY IF EXISTS "Admin Insert Access (products)" ON storage.objects;
CREATE POLICY "Admin Insert Access (products)" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (
        bucket_id = 'products' AND (SELECT public.is_admin())
    );

-- UPDATE ----------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin Update Access (banners)" ON storage.objects;
CREATE POLICY "Admin Update Access (banners)" ON storage.objects
    FOR UPDATE TO authenticated USING (
        bucket_id = 'banners' AND (SELECT public.is_admin())
    );

DROP POLICY IF EXISTS "Admin Update Access (products)" ON storage.objects;
CREATE POLICY "Admin Update Access (products)" ON storage.objects
    FOR UPDATE TO authenticated USING (
        bucket_id = 'products' AND (SELECT public.is_admin())
    );

-- DELETE ----------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin Delete Access (banners)" ON storage.objects;
CREATE POLICY "Admin Delete Access (banners)" ON storage.objects
    FOR DELETE TO authenticated USING (
        bucket_id = 'banners' AND (SELECT public.is_admin())
    );

DROP POLICY IF EXISTS "Admin Delete Access (products)" ON storage.objects;
CREATE POLICY "Admin Delete Access (products)" ON storage.objects
    FOR DELETE TO authenticated USING (
        bucket_id = 'products' AND (SELECT public.is_admin())
    );

-- 3. As largas de banner morrem (qualquer logado escrevia sem ser admin) ------
DROP POLICY IF EXISTS "Authenticated Upload Banners Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Update Banners Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Delete Banners Bucket" ON storage.objects;

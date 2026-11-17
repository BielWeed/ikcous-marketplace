-- ANTES da 20261399999000. So catalogo, rol fechado de tres linhas.
-- A ausencia da coluna e necessaria antes de aplicar; nenhuma imagem e lida.
WITH itens(item, esperado, vivo) AS (
  SELECT 'banners: tabela comum com RLS ligada', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_class WHERE oid = to_regclass('public.banners')
      AND relkind = 'r' AND relrowsecurity
  ) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'banners: image_url text preservada', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.banners')
      AND attname = 'image_url' AND atttypid = 'text'::regtype
      AND attnum > 0 AND NOT attisdropped
  ) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'banners: desktop_image_url ainda ausente', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.banners')
      AND attname = 'desktop_image_url' AND attnum > 0 AND NOT attisdropped
  ) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

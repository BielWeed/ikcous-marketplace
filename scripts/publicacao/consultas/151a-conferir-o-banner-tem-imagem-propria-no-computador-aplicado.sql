-- DEPOIS da 20261399999000. So catalogo: nao le arte nem dado de cliente.
-- Rol fechado de tres linhas; coluna ausente ou com forma diferente reprova.
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
  SELECT 'banners: desktop_image_url text opcional, sem default nem privilegio proprio', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.banners')
      AND a.attname = 'desktop_image_url' AND a.atttypid = 'text'::regtype
      AND a.attnum > 0 AND NOT a.attisdropped AND NOT a.attnotnull
      AND a.attgenerated = '' AND a.attidentity = '' AND a.attacl IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)
      AND col_description(a.attrelid, a.attnum) = 'Imagem opcional para computador; NULL mantém image_url como reserva.'
  ) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

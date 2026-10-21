-- ANTES (base ou rollback com coluna preservada) da 20261300000000; SO LEITURA, somente catalogo, rol fechado de 4 linhas.
WITH itens(item, esperado, vivo) AS (
  SELECT 'categorias: RLS ativa e quatro policies originais', 'sim',
    CASE WHEN COALESCE((SELECT count(*) = 1 AND bool_and(relrowsecurity) FROM pg_class WHERE oid = to_regclass('public.categorias')), false) AND COALESCE((SELECT count(*) = 4 AND bool_and(polpermissive AND
    CASE polname
      WHEN 'categorias_select_policy' THEN polcmd = 'r' AND polroles = ARRAY[0::oid]
        AND pg_get_expr(polqual, polrelid) = 'true' AND polwithcheck IS NULL
      WHEN 'categorias_admin_insert_policy' THEN polcmd = 'a' AND polroles = ARRAY['authenticated'::regrole::oid]
        AND polqual IS NULL AND regexp_replace(replace(pg_get_expr(polwithcheck, polrelid), 'public.', ''), '[[:space:]]', '', 'g') = '(SELECTis_admin()ASis_admin)'
      WHEN 'categorias_admin_update_policy' THEN polcmd = 'w' AND polroles = ARRAY['authenticated'::regrole::oid]
        AND regexp_replace(replace(pg_get_expr(polqual, polrelid), 'public.', ''), '[[:space:]]', '', 'g') = '(SELECTis_admin()ASis_admin)'
        AND regexp_replace(replace(pg_get_expr(polwithcheck, polrelid), 'public.', ''), '[[:space:]]', '', 'g') = '(SELECTis_admin()ASis_admin)'
      WHEN 'categorias_admin_delete_policy' THEN polcmd = 'd' AND polroles = ARRAY['authenticated'::regrole::oid]
        AND regexp_replace(replace(pg_get_expr(polqual, polrelid), 'public.', ''), '[[:space:]]', '', 'g') = '(SELECTis_admin()ASis_admin)'
        AND polwithcheck IS NULL
      ELSE false
    END)
    FROM pg_policy WHERE polrelid = to_regclass('public.categorias')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'categorias: leitura publica e UPDATE authenticated por grant de tabela', 'sim',
    CASE WHEN COALESCE((SELECT has_table_privilege('anon', 'public.categorias', 'SELECT')
    AND has_table_privilege('authenticated', 'public.categorias', 'SELECT')
    AND has_table_privilege('authenticated', 'public.categorias', 'UPDATE')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'categorias.icone: ausente ou text nulavel preservada', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone' AND NOT attisdropped)
      OR COALESCE((SELECT count(*) = 1 AND bool_and(atttypid = 'text'::regtype AND atttypmod = -1 AND NOT attnotnull
      AND NOT atthasdef AND attidentity = '' AND attgenerated = '')
    FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone' AND NOT attisdropped), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'categorias_icone_check: ausente', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.categorias') AND conname = 'categorias_icone_check') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

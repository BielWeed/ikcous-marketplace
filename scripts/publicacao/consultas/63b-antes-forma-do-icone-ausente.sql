-- ANTES (base com a 20261300000000 e sem a 20261351000000, ou rollback dela); SO LEITURA, somente catalogo, rol fechado de 5 linhas.
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
  SELECT 'categorias.icone e categorias_icone_check: 14 chaves da 20261300000000 intactas', 'sim',
    CASE WHEN COALESCE((SELECT count(*) = 1 AND bool_and(atttypid = 'text'::regtype AND atttypmod = -1 AND NOT attnotnull
      AND NOT atthasdef AND attidentity = '' AND attgenerated = '')
    FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone' AND NOT attisdropped), false) AND COALESCE((SELECT count(*) = 1 AND bool_and(contype = 'c' AND convalidated AND
      pg_get_expr(conbin, conrelid) = '(icone = ANY (ARRAY[''todas''::text, ''cuidado''::text, ''brinquedo''::text, ''calcados''::text, ''moda''::text, ''casa''::text, ''tecnologia''::text, ''beleza''::text, ''esporte''::text, ''pet''::text, ''alimento''::text, ''papelaria''::text, ''ferramentas''::text, ''joias''::text]))')
    FROM pg_constraint WHERE conrelid = to_regclass('public.categorias') AND conname = 'categorias_icone_check'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'categorias.icone_forma: ausente', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone_forma' AND NOT attisdropped) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'categorias_icone_forma_check: ausente', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.categorias') AND conname = 'categorias_icone_forma_check') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

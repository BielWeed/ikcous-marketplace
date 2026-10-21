-- DEPOIS da 20261347000000; SO LEITURA, somente catalogo, rol fechado de 5 linhas. Nunca le codigo de barras de produto.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'codigo_barras: colunas e indices unicos por tabela', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) FROM pg_attribute a WHERE NOT a.attisdropped
       AND ((a.attrelid = to_regclass('public.produtos') AND a.attname = 'codigo_barras' AND a.atttypid = 'text'::regtype)
         OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'codigo_barras' AND a.atttypid = 'text'::regtype)
         OR (a.attrelid = to_regclass('public.produtos') AND a.attname = 'deleted_at' AND a.atttypid = 'timestamptz'::regtype))) = 3
    AND pg_get_indexdef(to_regclass('public.produtos_codigo_barras_unico')) = 'CREATE UNIQUE INDEX produtos_codigo_barras_unico ON public.produtos USING btree (codigo_barras) WHERE ((codigo_barras IS NOT NULL) AND (deleted_at IS NULL))'
    AND pg_get_indexdef(to_regclass('public.product_variants_codigo_barras_unico')) = 'CREATE UNIQUE INDEX product_variants_codigo_barras_unico ON public.product_variants USING btree (codigo_barras) WHERE (codigo_barras IS NOT NULL)'
    AND (SELECT count(*) FROM pg_index i WHERE i.indexrelid IN (to_regclass('public.produtos_codigo_barras_unico'), to_regclass('public.product_variants_codigo_barras_unico'))
       AND i.indisunique AND i.indisvalid AND i.indisready) = 2, false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'gatilhos: funcoes com corpo exato e atributos', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE ((p.oid = to_regprocedure('public.produto_codigo_barras_livre_de_variacao()') AND md5(replace(p.prosrc, chr(13), '')) = '9283210663c925108532b043c3e03107')
          OR (p.oid = to_regprocedure('public.variacao_codigo_barras_livre_de_produto()') AND md5(replace(p.prosrc, chr(13), '')) = 'af09872b76b0726f34359d06f1ab34b8'))
        AND p.prosecdef AND l.lanname = 'plpgsql' AND p.prorettype = 'trigger'::regtype AND p.pronargs = 0
        AND p.provolatile = 'v' AND NOT p.proretset AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]) = 2
    AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('produto_codigo_barras_livre_de_variacao', 'variacao_codigo_barras_livre_de_produto')) = 2, false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'gatilhos: funcoes sem EXECUTE para PUBLIC, anon, authenticated e service_role', 'sim', CASE WHEN
    to_regprocedure('public.produto_codigo_barras_livre_de_variacao()') IS NOT NULL
    AND to_regprocedure('public.variacao_codigo_barras_livre_de_produto()') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid IN (to_regprocedure('public.produto_codigo_barras_livre_de_variacao()'), to_regprocedure('public.variacao_codigo_barras_livre_de_produto()'))
        AND a.privilege_type = 'EXECUTE'
        AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))))
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'gatilhos: BEFORE INSERT OR UPDATE OF codigo_barras ligados nas duas tabelas', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) FROM pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 23 AND t.tgqual IS NULL AND t.tgnargs = 0
        AND ((t.tgname = 'tr_produto_codigo_barras_livre_de_variacao' AND t.tgrelid = to_regclass('public.produtos')
              AND t.tgfoid = to_regprocedure('public.produto_codigo_barras_livre_de_variacao()'))
          OR (t.tgname = 'tr_variacao_codigo_barras_livre_de_produto' AND t.tgrelid = to_regclass('public.product_variants')
              AND t.tgfoid = to_regprocedure('public.variacao_codigo_barras_livre_de_produto()')))
        AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a WHERE a.attrelid = t.tgrelid AND a.attname = 'codigo_barras' AND NOT a.attisdropped)) = 2, false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

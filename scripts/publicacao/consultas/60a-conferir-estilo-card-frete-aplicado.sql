-- 60a-conferir-estilo-card-frete-aplicado: DEPOIS da 20261310; exige campo, CHECK, view e corpo novos.
-- SO LEITURA: apenas catalogo, rol fechado de 5 linhas; nenhum dado de cliente.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS m,
         p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
           AND NOT p.proretset AND NOT p.proisstrict
           AND p.pronargs = 1 AND p.pronargdefaults = 0
           AND p.proconfig = ARRAY['search_path=public']::text[]
           AND pg_get_function_result(p.oid) = 'jsonb'
           AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'upsert_store_config') = 1 AS atributos_ok,
         NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND has_function_privilege('service_role', p.oid, 'EXECUTE') AS acl_ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.upsert_store_config(jsonb)')
), coluna AS (
  SELECT a.attnotnull AND a.atttypid = 'text'::regtype
         AND pg_get_expr(d.adbin, d.adrelid) = '''completo''::text' AS ok
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'free_shipping_card_style' AND NOT a.attisdropped
), restricao AS (
  SELECT count(*) = 1 AS ok FROM pg_constraint c
   WHERE c.conrelid = to_regclass('public.store_config') AND c.conname = 'store_config_free_shipping_card_style_check'
     AND c.contype = 'c' AND c.convalidated
     AND pg_get_constraintdef(c.oid) = 'CHECK ((free_shipping_card_style = ANY (ARRAY[''completo''::text, ''compacto''::text])))'
), vista AS (
  SELECT md5(string_agg(a.attname, ',' ORDER BY a.attnum)) AS m
    FROM pg_attribute a WHERE a.attrelid = to_regclass('public.v_store_config') AND a.attnum > 0 AND NOT a.attisdropped
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'upsert_store_config: corpo exato (md5)', 'aa4ed730ac6ad3d3c2644b4285ff39a9', COALESCE((SELECT m FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: assinatura, atributos e ACL preservados', 'sim',
    CASE WHEN COALESCE((SELECT atributos_ok AND acl_ok FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'store_config: estilo restrito e com padrao completo', 'sim',
    CASE WHEN COALESCE((SELECT ok FROM coluna), false) AND (SELECT ok FROM restricao) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'v_store_config: colunas na ordem e leitura publica preservada', 'sim',
    CASE WHEN (SELECT m FROM vista) IN ('b7ee2c31d91549a168a502de0ac4c5d2')
      AND 'security_invoker=on' = ANY((SELECT reloptions FROM pg_class WHERE oid = to_regclass('public.v_store_config'))::text[])
      AND has_table_privilege('anon', 'public.v_store_config', 'SELECT')
      AND has_table_privilege('authenticated', 'public.v_store_config', 'SELECT')
      AND has_table_privilege('service_role', 'public.v_store_config', 'SELECT')
      THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

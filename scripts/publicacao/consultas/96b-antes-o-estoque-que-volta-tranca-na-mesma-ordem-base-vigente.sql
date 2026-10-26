-- 96b-antes-o-estoque-que-volta-tranca-na-mesma-ordem-base-vigente: ANTES da 20261389100000 (ou depois do rollback-manual dela). SO LEITURA,
-- somente catalogo, rol fechado de 4 linhas. Nao le nenhuma linha. Prova que o corpo vivo de devolver_estoque ainda e' o da 20261175000000
-- (o unico que a migration aceita trocar), com os atributos de sempre, e que as tabelas e colunas que o bloco novo le existem.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proisstrict, p.proconfig,
         pg_get_function_result(p.oid) AS resultado
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'devolver_estoque'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'devolver_estoque: uma so, com o corpo VIGENTE da 20261175000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn) = 1
    AND EXISTS (SELECT 1 FROM fn WHERE h = '05f6f7e6ac7a2fa7793298110cf17e96') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'devolver_estoque: atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path=public, retorna integer, argumento p_order_id uuid) e EXECUTE de ninguem de aplicacao (anon, authenticated, PUBLIC)', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND NOT f.proisstrict AND f.resultado = 'integer'
        AND f.proconfig = ARRAY['search_path=public']::text[]
        AND pg_get_function_arguments(f.oid) = 'p_order_id uuid'
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = f.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM fn f WHERE f.oid = to_regprocedure('public.devolver_estoque(uuid)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'marketplace_order_items (order_id, product_id, variant_id), product_variants (id, product_id) e produtos (id) existem como uuid', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_attribute a
      WHERE NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
        AND ((a.attrelid = to_regclass('public.marketplace_order_items') AND a.attname IN ('order_id', 'product_id', 'variant_id'))
          OR (a.attrelid = to_regclass('public.product_variants') AND a.attname IN ('id', 'product_id'))
          OR (a.attrelid = to_regclass('public.produtos') AND a.attname = 'id'))) = 6 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

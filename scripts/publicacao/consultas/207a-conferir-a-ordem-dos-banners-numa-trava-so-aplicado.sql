-- 207a-conferir-a-ordem-dos-banners-numa-trava-so-aplicado: DEPOIS da 20261651000000. SO LEITURA, somente catalogo, rol fechado
-- de 5 linhas (o mesmo da 207b). Confirma que as RPCs NOVAS normalize_banners_atomic (md5 c221e4ba453f3f659574f03fcd1341e3: arruma
-- a pagina inteira sob a trava da pagina) e move_banner_atomic (md5 2da1c33deaceb650951a795b9d720eb7: acha o vizinho dentro do banco)
-- existem, uma de cada, com os atributos e a ACL da reorder_banners_atomic; que a reorder_banners_atomic antiga segue com o corpo da
-- 20261381000000 (o app velho em cache a chama); e a base que as duas usam. NAO le nenhum banner. Tudo true = aplicado; qualquer
-- false = PARE e leia a linha. Depois do rollback-manual, as linhas das duas funcoes reprovam (AUSENTE).
WITH fn AS (
  SELECT q.nome,
         (SELECT count(*) FROM pg_catalog.pg_proc x
           WHERE x.pronamespace = 'public'::regnamespace AND x.proname = q.nome) AS n,
         md5(replace(p.prosrc, chr(13), '')) AS h,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 'v' AND NOT p.proretset
           AND pg_get_function_result(p.oid) = q.retorno
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND has_function_privilege('service_role', p.oid, 'EXECUTE') AS atributos
  FROM (VALUES ('normalize_banners_atomic', 'public.normalize_banners_atomic(text,uuid,boolean)', 'integer'),
               ('move_banner_atomic', 'public.move_banner_atomic(text,uuid,text)', 'uuid')) AS q(nome, assinatura, retorno)
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(q.assinatura)
  LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
), reorder AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h
  FROM pg_catalog.pg_proc p
  WHERE p.oid = to_regprocedure('public.reorder_banners_atomic(text,uuid,uuid)')
), base AS (
  SELECT COALESCE((SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attname)
                     FROM pg_catalog.pg_attribute a
                    WHERE a.attrelid = to_regclass('public.banners') AND a.attnum > 0 AND NOT a.attisdropped
                      AND a.attname IN ('id', 'position', 'order')), 'ausente') AS forma,
         to_regprocedure('public.is_admin_atual()') IS NOT NULL AS admin_atual
), itens(item, esperado, vivo, ok) AS (
  SELECT 'normalize_banners_atomic: corpo exato (md5), arruma a pagina inteira sob a trava da pagina',
         'c221e4ba453f3f659574f03fcd1341e3',
         COALESCE((SELECT h FROM fn WHERE nome = 'normalize_banners_atomic'), 'AUSENTE'),
         COALESCE((SELECT n = 1 AND h = 'c221e4ba453f3f659574f03fcd1341e3' FROM fn WHERE nome = 'normalize_banners_atomic'), false)
  UNION ALL
  SELECT 'move_banner_atomic: corpo exato (md5), acha o vizinho dentro do banco sob a mesma trava',
         '2da1c33deaceb650951a795b9d720eb7',
         COALESCE((SELECT h FROM fn WHERE nome = 'move_banner_atomic'), 'AUSENTE'),
         COALESCE((SELECT n = 1 AND h = '2da1c33deaceb650951a795b9d720eb7' FROM fn WHERE nome = 'move_banner_atomic'), false)
  UNION ALL
  SELECT 'normalize_banners_atomic e move_banner_atomic: uma so cada, plpgsql SECURITY DEFINER VOLATILE, search_path=public, EXECUTE so de authenticated e service_role',
         'sim',
         CASE WHEN (SELECT bool_and(n = 0) FROM fn) THEN 'AUSENTE'
              WHEN (SELECT bool_and(n = 1 AND COALESCE(atributos, false)) FROM fn) THEN 'sim' ELSE 'nao' END,
         COALESCE((SELECT bool_and(n = 1 AND COALESCE(atributos, false)) FROM fn), false)
  UNION ALL
  SELECT 'reorder_banners_atomic: corpo da 20261381000000 (md5), a troca antiga segue para o app em cache',
         '8530188cb2fd69a7d3bf24add96eb339',
         COALESCE((SELECT h FROM reorder), 'AUSENTE'),
         COALESCE((SELECT h FROM reorder) = '8530188cb2fd69a7d3bf24add96eb339', false)
  UNION ALL
  SELECT 'banners e is_admin_atual: as colunas id, position e order e a trava de admin de agora existem',
         'id:uuid,order:integer,position:text e is_admin_atual',
         base.forma || CASE WHEN base.admin_atual THEN ' e is_admin_atual' ELSE ' sem is_admin_atual' END,
         base.forma = 'id:uuid,order:integer,position:text' AND base.admin_atual
  FROM base
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;

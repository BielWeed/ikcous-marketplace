-- ANTES da 20261341000000 (ou depois do seu rollback): o corpo vivo de get_orders_by_otp_v2 e o da 20261217000000 (leitura sem trava).
-- SO LEITURA, somente catalogo (pg_proc), rol fechado de 3 linhas. Nenhum pedido, codigo ou contador e lido.
-- O corpo e medido por md5(replace(prosrc, chr(13), '')): LF ou CRLF. Corpo estranho (inclusive o da 20261341000000 ou o da 20261342000000) reprova.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS m, p.prosrc
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_orders_by_otp_v2: corpo da 20261217000000 (base anterior, md5)', '53b5e632657b82206daa6aa992a50c0d',
    COALESCE((SELECT CASE WHEN f.m IN ('53b5e632657b82206daa6aa992a50c0d') THEN '53b5e632657b82206daa6aa992a50c0d' ELSE f.m END FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v2: assinatura, atributos e EXECUTE preservados', 'sim',
    CASE WHEN EXISTS (
      SELECT 1
        FROM pg_proc p
        JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)')
         AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
         AND p.proconfig = ARRAY['search_path=public']::text[]
         AND pg_get_function_result(p.oid) = 'jsonb'
         AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                          WHERE g.privilege_type = 'EXECUTE' AND g.grantee = 0)
         AND has_function_privilege('anon', p.oid, 'EXECUTE')
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    ) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

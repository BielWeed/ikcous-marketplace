-- ANTES da 20261620000000. Só catálogo; não chama a função nem lê dados de pedidos.
-- A base vigente é o corpo da 20261409000000; a prova aceita também a versão nova
-- para uma reaplicação idempotente.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f'
           AND p.provolatile = 'v' AND NOT p.proisstrict AND p.proretset
           AND pg_get_function_arguments(p.oid) =
               'start_date timestamp with time zone, end_date timestamp with time zone'
           AND pg_get_function_result(p.oid) =
               'TABLE(name text, value numeric, orders bigint, avg_ticket numeric)'
           AND (SELECT count(*) FROM pg_catalog.pg_proc q
                WHERE q.pronamespace = 'public'::regnamespace
                  AND q.proname = 'get_category_analytics') = 1 AS atributos
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.get_category_analytics(timestamp with time zone,timestamp with time zone)')
), itens(item, esperado, vivo, ok) AS (
  SELECT 'get_category_analytics: corpo exato (md5)',
         'd7e1e413ac805f598d8657992f43c706 ou a332d6b7c4ab58425c60343883d873d6',
         COALESCE(fn.h, 'AUSENTE'),
         COALESCE(fn.h IN ('d7e1e413ac805f598d8657992f43c706', 'a332d6b7c4ab58425c60343883d873d6'), false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN fn ON true
  UNION ALL
  SELECT 'get_category_analytics: assinatura e atributos conhecidos', 'sim',
         CASE WHEN fn.atributos THEN 'sim' ELSE 'nao' END,
         COALESCE(fn.atributos, false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN fn ON true
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;

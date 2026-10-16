-- 49a-conferir-lancamento-idempotente-aplicado: somente catalogo, 6 linhas fixas; nenhuma linha financeira e lida.
-- Exige o hash novo e a tabela privada.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, p.proowner,
    (p.prosecdef AND p.prokind = 'f' AND l.lanname = 'plpgsql'
      AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
      AND p.proconfig = ARRAY['search_path=public']::text[]
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND pg_get_function_arguments(p.oid) = 'p jsonb'
      AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
            AND q.proname = 'fin_lancamento_salvar') = 1
      AND to_regprocedure('public.is_admin()') IS NOT NULL
      AND to_regprocedure('public.is_admin_atual()') IS NOT NULL
      AND to_regprocedure('public.fin__hoje()') IS NOT NULL) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE g.grantee = 0 OR (g.grantee <> p.proowner AND
                         (g.grantee NOT IN ('authenticated'::regrole, 'service_role'::regrole) OR g.is_grantable)))) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.fin_lancamento_salvar(jsonb)')
), tb AS (
  SELECT c.oid,
    (c.relkind = 'r'
     AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
         = 'chave:uuid:true,conteudo_hash:text:true,ids:uuid[]:true,criado_em:timestamp with time zone:true'
     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = c.oid) = 1
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.oid AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (chave)')
     AND (SELECT count(*) FROM pg_attrdef WHERE adrelid = c.oid) = 1
     AND EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                  WHERE d.adrelid = c.oid AND a.attname = 'criado_em' AND pg_get_expr(d.adbin, d.adrelid) = 'now()')) AS forma,
    (c.relrowsecurity AND NOT c.relforcerowsecurity AND c.relowner = (SELECT proowner FROM fn)
     AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = c.oid)
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = c.oid AND NOT tgisinternal)
     AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee <> c.relowner)
     AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = c.oid AND attacl IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'fin_lancamento_tentativas')) AS privada
  FROM pg_class c WHERE c.oid = to_regclass('public.fin_lancamento_tentativas')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN COALESCE(((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_salvar: corpo conhecido (md5)', 'sim', CASE WHEN COALESCE(((SELECT h = '1356dbfc037a9202ef163ba598854891' FROM fn)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_salvar: atributos e dependencias de sempre', 'sim', CASE WHEN COALESCE(((SELECT atributos FROM fn)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_salvar: EXECUTE de authenticated e service_role, PUBLIC e anon sem', 'sim', CASE WHEN COALESCE(((SELECT acl FROM fn)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_tentativas: forma conhecida', 'sim', CASE WHEN COALESCE(((SELECT forma FROM tb)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_tentativas: so servidor, RLS e nenhuma politica', 'sim', CASE WHEN COALESCE(((SELECT privada FROM tb)), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

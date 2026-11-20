-- DEPOIS da 20261412000000. So catalogo: nao chama as funcoes nem le pedidos ou clientes.
WITH alvos(nome, assinatura, argumentos, retorno, config, definer, hash_esperado) AS (VALUES
  ('crm__vendas', 'public.crm__vendas(timestamptz)',
   'p_ate timestamp with time zone', 'TABLE(order_id uuid, total numeric, canal text, forma text, pago_em timestamp with time zone, dia date, chave text, user_id uuid, nome text, whatsapp text, email text)',
   ARRAY['search_path=public']::text[], false, '69e1f0af8874135e4a347266bebd2a63'),
  ('get_admin_customers_paged', 'public.get_admin_customers_paged(text,text,text,integer,integer)',
   'p_search text DEFAULT ''''::text, p_sort_field text DEFAULT ''created_at''::text, p_sort_direction text DEFAULT ''desc''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10', 'jsonb',
   ARRAY['search_path=public, extensions']::text[], true, 'bdac47c59600f44cf59ac6c74e44a55e'),
  ('get_admin_user_detail', 'public.get_admin_user_detail(uuid)',
   'p_user_id uuid', 'jsonb',
   ARRAY['search_path=public']::text[], true, '169d114f0fac4786b3ed5d4ff8385b4d')
), fn AS (
  SELECT a.*, md5(replace(p.prosrc, chr(13), '')) AS h,
    COALESCE(p.prokind = 'f' AND p.prosecdef = a.definer AND p.proconfig = a.config
     AND l.lanname = CASE WHEN a.definer THEN 'plpgsql' ELSE 'sql' END
     AND ((a.definer AND p.provolatile = 'v') OR (NOT a.definer AND p.provolatile = 's'))
     AND p.proretset = (NOT a.definer) AND NOT p.proisstrict
     AND pg_get_function_arguments(p.oid) = a.argumentos
     AND pg_get_function_result(p.oid) = a.retorno
     AND (SELECT count(*) FROM pg_catalog.pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = a.nome) = 1, false) AS atributos,
    COALESCE(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = a.definer
     AND (NOT a.definer OR has_function_privilege('service_role', p.oid, 'EXECUTE'))
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                     WHERE g.grantee = 0 AND g.privilege_type = 'EXECUTE'), false) AS acl
  FROM alvos a
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(a.assinatura)
  LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace)
         THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT nome || ': corpo exato (md5)', hash_esperado, COALESCE(h, 'AUSENTE') FROM fn
  UNION ALL
  SELECT nome || ': assinatura e atributos conhecidos', 'sim',
    CASE WHEN atributos THEN 'sim' ELSE 'nao' END FROM fn
  UNION ALL
  SELECT nome || CASE WHEN definer THEN ': EXECUTE permitido para authenticated e service_role, sem PUBLIC ou anon'
                      ELSE ': sem EXECUTE para PUBLIC, anon ou authenticated' END,
    'sim', CASE WHEN acl THEN 'sim' ELSE 'nao' END FROM fn
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

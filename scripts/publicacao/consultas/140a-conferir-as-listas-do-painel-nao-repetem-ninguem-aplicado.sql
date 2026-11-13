-- 140a-conferir-as-listas-do-painel-nao-repetem-ninguem-aplicado: DEPOIS da 20261399980000 (os corpos desta migration, md5 get_admin_products_paged 0f153b653338f6570da399493093cfae; get_admin_orders_paged b404a8397a6490c86fb192d85fd5b6c9; get_admin_orders_cancelados_recentes 80ec13f92e224b21d5308a063e88fb6e).
-- SO LEITURA, so catalogo; rol fechado de 10 linhas. Nao le nenhum produto, pedido nem cliente e nao chama nenhuma das tres funcoes.
-- Comportamento (paginas sem repetir nem esconder ninguem, controle com os corpos anteriores, mutantes) provado por
-- tests/banco/as-listas-do-painel-nao-repetem-ninguem-viva.cjs no CI.
WITH alvo(nome, assinatura, argumentos, hash_esperado) AS (VALUES
    ('get_admin_products_paged', 'public.get_admin_products_paged(text,text,text,text,integer,integer)', 'p_search text DEFAULT ''''::text, p_category text DEFAULT ''all''::text, p_status text DEFAULT ''all''::text, p_stock text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10', '0f153b653338f6570da399493093cfae'),
    ('get_admin_orders_paged', 'public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)', 'p_search text DEFAULT ''''::text, p_status text DEFAULT ''all''::text, p_start_date text DEFAULT ''''::text, p_end_date text DEFAULT ''''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_payment_status text DEFAULT ''all''::text, p_canal text DEFAULT ''all''::text', 'b404a8397a6490c86fb192d85fd5b6c9'),
    ('get_admin_orders_cancelados_recentes', 'public.get_admin_orders_cancelados_recentes(integer,integer,integer)', 'p_dias integer DEFAULT 90, p_page integer DEFAULT 0, p_page_size integer DEFAULT 200', '80ec13f92e224b21d5308a063e88fb6e')
), fn AS (
  SELECT a.nome, a.hash_esperado, md5(replace(p.prosrc, chr(13), '')) AS h,
    COALESCE(p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset
     AND pg_get_function_arguments(p.oid) = a.argumentos
     AND pg_get_function_result(p.oid) = 'jsonb'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = a.nome) = 1, false) AS atributos,
    COALESCE(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                     WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE'), false) AS acl
  FROM alvo a
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.assinatura)
  LEFT JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT f.nome || ': corpo exato (md5)', f.hash_esperado, COALESCE(f.h, 'AUSENTE') FROM fn f
  UNION ALL
  SELECT f.nome || ': assinatura e atributos conhecidos (plpgsql, SECURITY DEFINER, VOLATILE, search_path=public, extensions, uma so)', 'sim',
    CASE WHEN f.atributos THEN 'sim' ELSE 'nao' END FROM fn f
  UNION ALL
  SELECT f.nome || ': EXECUTE so authenticated e service_role (sem PUBLIC nem anon)', 'sim',
    CASE WHEN f.acl THEN 'sim' ELSE 'nao' END FROM fn f
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

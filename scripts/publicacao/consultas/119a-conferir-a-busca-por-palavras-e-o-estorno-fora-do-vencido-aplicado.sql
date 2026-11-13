-- 119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado: DEPOIS da 20261399200000 (a busca de produtos acha por palavras, md5 346063e900b8b7b63dfbeffe5070eedc) e da 20261399300000 (o estorno em andamento nao e conta vencida:
-- painel_inicio md5 8d58e15e7410afe0d254f37f38251df4, fin_resumo md5 a10e7f301eaf6b3edfac50bc87ff74bc).
-- SO LEITURA, so catalogo; rol fechado de 10 linhas. Nao le nenhum produto, pedido, lancamento nem cliente e nao chama nenhuma das tres funcoes.
WITH fn AS (
  SELECT 'busca' AS k, p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
     AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset AND p.proparallel = 'u' AND p.procost = 100
     AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_category text DEFAULT ''all''::text, p_status text DEFAULT ''all''::text, p_stock text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'
     AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'get_admin_products_paged') = 1) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.get_admin_products_paged(text,text,text,text,integer,integer)')
  UNION ALL
  SELECT 'painel', p.oid, md5(replace(p.prosrc, chr(13), '')),
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.proretset
     AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_arguments(p.oid) = ''
     AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'painel_inicio') = 1),
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.painel_inicio()')
  UNION ALL
  SELECT 'resumo', p.oid, md5(replace(p.prosrc, chr(13), '')),
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.proretset
     AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
     AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'fin_resumo') = 1),
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.fin_resumo(date,date)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_admin_products_paged: corpo exato (md5)', '346063e900b8b7b63dfbeffe5070eedc',
    -- A 20261399980000 (as listas do painel desempatam por id) sucede este corpo: so o desempate do ORDER BY e' novo. Aceita os dois corpos EXATOS; normaliza ao esperado.
    COALESCE((SELECT CASE WHEN h IN ('346063e900b8b7b63dfbeffe5070eedc', '0f153b653338f6570da399493093cfae') THEN '346063e900b8b7b63dfbeffe5070eedc' ELSE h END FROM fn WHERE k = 'busca'), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_products_paged: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE k = 'busca'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_admin_products_paged: EXECUTE authenticated e service_role, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE k = 'busca'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'painel_inicio: corpo exato (md5)', '8d58e15e7410afe0d254f37f38251df4',
    COALESCE((SELECT h FROM fn WHERE k = 'painel'), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE k = 'painel'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'painel_inicio: EXECUTE authenticated e service_role, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE k = 'painel'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_resumo: corpo exato (md5)', 'a10e7f301eaf6b3edfac50bc87ff74bc',
    COALESCE((SELECT h FROM fn WHERE k = 'resumo'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_resumo: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE k = 'resumo'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_resumo: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE k = 'resumo'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

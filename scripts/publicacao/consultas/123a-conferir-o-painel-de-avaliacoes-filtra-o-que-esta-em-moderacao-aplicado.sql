-- 123a-conferir-o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-aplicado: DEPOIS da 20261399700000.
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhuma avaliacao nem chama a get_admin_reviews_paged.
-- A prova POSITIVA do lote: so passa se a funcao existe com a assinatura NOVA (5 argumentos, o ultimo p_status text DEFAULT 'todas'), o corpo
-- desta migration, os atributos da funcao de antes e a ACL fechada - e se a assinatura antiga de 4 argumentos NAO existe mais (a linha dos
-- atributos exige UMA unica funcao com esse nome em public; uma sobrecarga velha ao lado da nova faria o PostgREST recusar a chamada, PGRST203).
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
     AND NOT p.proisstrict AND NOT p.proretset AND NOT p.proleakproof AND p.proparallel = 'u' AND p.procost = 100
     AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_rating text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT ''todas''::text'
     AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'get_admin_reviews_paged') = 1) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_admin_reviews_paged: corpo exato (md5)', 'af5d21345d167ca44dd327a93f949ea6',
    COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_reviews_paged: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_admin_reviews_paged: EXECUTE authenticated e service_role, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

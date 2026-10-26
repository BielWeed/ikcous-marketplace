-- 102a-conferir-a-busca-do-crm-acha-o-numero-com-mais-55-aplicado: DEPOIS da 20261392100000 (o desta migration, md5 39a2a6de59041e09b6f1e466a6782dca).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhum perfil, pedido nem cliente e nao chama a crm_clientes.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.proretset
     AND pg_get_function_arguments(p.oid) = 'p_segmento text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0'
     AND pg_get_function_result(p.oid) = 'jsonb'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'crm_clientes') = 1) AS atributos,
    (NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.crm_clientes(text,text,integer,integer)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'crm_clientes: corpo exato (md5)', '39a2a6de59041e09b6f1e466a6782dca',
    COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'crm_clientes: assinatura e atributos conhecidos (plpgsql, SECURITY DEFINER, STABLE, search_path=public, uma so)', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'crm_clientes: EXECUTE so authenticated e service_role (sem PUBLIC nem anon)', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

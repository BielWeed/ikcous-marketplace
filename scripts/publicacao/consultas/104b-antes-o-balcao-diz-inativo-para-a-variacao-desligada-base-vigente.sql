-- 104b-antes-o-balcao-diz-inativo-para-a-variacao-desligada-base-vigente: ANTES da 20261393100000 (o da 20261381000000, md5 e1b93114cd9deee7eda6801ef37ff1f9).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhum produto, variacao nem pedido e nao chama a buscar_por_codigo_barras.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.proretset
     AND pg_get_function_arguments(p.oid) = 'p_codigo text'
     AND pg_get_function_result(p.oid) = 'jsonb'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'buscar_por_codigo_barras') = 1) AS atributos,
    (NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.buscar_por_codigo_barras(text)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'buscar_por_codigo_barras: corpo exato (md5)', 'e1b93114cd9deee7eda6801ef37ff1f9',
    COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'buscar_por_codigo_barras: assinatura e atributos conhecidos (plpgsql, SECURITY DEFINER, STABLE, search_path=pg_catalog, pg_temp, uma so)', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'buscar_por_codigo_barras: EXECUTE so authenticated e service_role (sem PUBLIC nem anon)', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

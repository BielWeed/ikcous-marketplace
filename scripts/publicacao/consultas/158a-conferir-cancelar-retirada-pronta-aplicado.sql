-- Só catálogo, sem chamar RPC nem ler pedidos.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS corpo,
         p.oid, p.proowner, p.proacl,
         (l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef
          AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
          AND p.prorettype = 'jsonb'::regtype
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) =
            'p_order_id uuid, p_new_status text, p_notes text, p_ator uuid, p_ator_admin boolean, p_pela_edge boolean'
          AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
               AND q.proname = 'pedido__mudar_status') = 1
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
          )) AS atributos
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace)
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'pedido__mudar_status: corpo exato (md5)', 'fea4db42491c2e229a5ac8ee9484d909',
         CASE WHEN (SELECT corpo FROM fn) = '1c44358ad6c8d68b643a42b2ccdb6e96'
               AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
                     WHERE oid = to_regprocedure('public.pedido__mudar_status_com_etapa(uuid,text,text,uuid,boolean,boolean,text)')) = '85468e44910e8ebda435577587256f1f'
              THEN 'fea4db42491c2e229a5ac8ee9484d909'
              ELSE COALESCE((SELECT corpo FROM fn), 'AUSENTE') END
  UNION ALL
  SELECT 'pedido__mudar_status: assinatura, atributos e ACL interna', 'sim',
         CASE WHEN (SELECT atributos FROM fn) IS TRUE THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

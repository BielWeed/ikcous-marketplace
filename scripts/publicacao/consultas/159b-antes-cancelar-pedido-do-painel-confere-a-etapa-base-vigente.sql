-- Só catálogo. Não lê pedido, não trava dados e não chama RPC.
WITH esperadas(nome, assinatura, argumentos, autenticado, corpo) AS (
  VALUES
    ('pedido__mudar_status', 'public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)', 'p_order_id uuid, p_new_status text, p_notes text, p_ator uuid, p_ator_admin boolean, p_pela_edge boolean', false, '1c44358ad6c8d68b643a42b2ccdb6e96'),
    ('pedido__mudar_status_com_etapa', 'public.pedido__mudar_status_com_etapa(uuid,text,text,uuid,boolean,boolean,text)', 'p_order_id uuid, p_new_status text, p_notes text, p_ator uuid, p_ator_admin boolean, p_pela_edge boolean, p_status_esperado text', false, '85468e44910e8ebda435577587256f1f'),
    ('cancelar_pedido_do_painel', 'public.cancelar_pedido_do_painel(uuid,text,text)', 'p_order_id uuid, p_status_esperado text, p_notes text DEFAULT NULL::text', true, 'da2f542b28b878c41ed22de015310fa8')
), estado AS (
  SELECT e.nome, e.corpo, md5(replace(p.prosrc, chr(13), '')) AS vivo, p.oid,
         p.proowner, p.proacl,
         (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
           AND q.proname = e.nome) AS quantas,
         (l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef
          AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
          AND p.prorettype = 'jsonb'::regtype
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = e.argumentos
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.autenticado
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
          )) AS atributos
    FROM esperadas e
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.assinatura)
    LEFT JOIN pg_language l ON l.oid = p.prolang
),
itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace)
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT nome || ': corpo exato (md5)',
         CASE WHEN nome = 'pedido__mudar_status' THEN 'fea4db42491c2e229a5ac8ee9484d909' ELSE 'AUSENTE' END,
         COALESCE(vivo, 'AUSENTE')
    FROM estado
  UNION ALL
  SELECT nome || ': assinatura e ACL esperadas', 'sim',
         CASE WHEN CASE WHEN nome = 'pedido__mudar_status'
                       THEN quantas = 1 AND atributos IS TRUE ELSE quantas = 0 END
              THEN 'sim' ELSE 'nao' END
    FROM estado
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

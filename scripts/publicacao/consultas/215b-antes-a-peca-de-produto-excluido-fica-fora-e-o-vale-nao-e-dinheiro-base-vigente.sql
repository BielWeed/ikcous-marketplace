-- 215b-antes-a-peca-de-produto-excluido-fica-fora-e-o-vale-nao-e-dinheiro-base-vigente: ANTES da 20261659000000. SO LEITURA, somente catalogo,
-- rol fechado de 7 linhas (o mesmo da 215a). A base vigente e' o corpo da 20261657000000 de devolver_estoque (c98a1d49d63e0174f4bdd95dcffc54f4)
-- e de admin_devolucao_concluir (b55bf2488a1d5165afddaa4d103d3e18), o da 20261642000000 de resolver_peca_sem_tamanho
-- (cac3d04d9be77c7d4004003bb70561c5) e o da 20261399995000 de get_admin_analytics_v2 (4f8fb94f6cb0018e10d0ef71541f1cbf); aceita tambem os corpos
-- desta para uma reaplicacao idempotente. Confere as premissas do pre-voo: atributos e ACL de sempre e as colunas que a regra nova le.
-- NAO le nenhuma linha de pedido, devolucao, produto nem peca e NAO chama funcao nenhuma. Tudo true = pode aplicar; qualquer false =
-- PARE (o pre-voo da migration recusaria).
WITH fn AS (
  SELECT p.proname::text AS nome, md5(replace(p.prosrc, chr(13), '')) AS h, p.oid,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 'v' AND NOT p.proretset AND NOT p.proisstrict
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS comum
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('devolver_estoque', 'admin_devolucao_concluir', 'resolver_peca_sem_tamanho', 'get_admin_analytics_v2')
), atributos AS (
  SELECT count(*) = 4
         AND count(DISTINCT f.nome) = 4
         AND bool_and(f.comum)
         AND bool_and(CASE f.nome
               WHEN 'devolver_estoque' THEN pg_get_function_result(f.oid) = 'integer'
                 AND pg_get_function_arguments(f.oid) = 'p_order_id uuid'
                 AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
               WHEN 'admin_devolucao_concluir' THEN pg_get_function_result(f.oid) = 'jsonb'
                 AND pg_get_function_arguments(f.oid) = 'p_id uuid, p_resolucao text, p_itens jsonb, p_valor_reembolso numeric DEFAULT NULL::numeric, p_observacao text DEFAULT NULL::text'
                 AND has_function_privilege('authenticated', f.oid, 'EXECUTE')
                 AND has_function_privilege('service_role', f.oid, 'EXECUTE')
               WHEN 'resolver_peca_sem_tamanho' THEN pg_get_function_result(f.oid) = 'jsonb'
                 AND pg_get_function_arguments(f.oid) = 'p_peca_id uuid, p_variant_id uuid'
                 AND has_function_privilege('authenticated', f.oid, 'EXECUTE')
                 AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
               ELSE pg_get_function_result(f.oid) = 'json'
                 AND pg_get_function_arguments(f.oid) = 'p_limit_days integer DEFAULT 90'
                 AND has_function_privilege('authenticated', f.oid, 'EXECUTE')
                 AND has_function_privilege('service_role', f.oid, 'EXECUTE')
             END) AS certos
  FROM fn f
), colunas AS (
  SELECT count(*) = 4 AS certo
    FROM pg_catalog.pg_attribute a
   WHERE NOT a.attisdropped AND a.attnum > 0
     AND ((a.attrelid = to_regclass('public.produtos') AND a.attname IN ('id', 'deleted_at'))
       OR (a.attrelid = to_regclass('public.product_variants') AND a.attname IN ('id', 'product_id')))
), itens(item, esperado, vivo, ok) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END,
         EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace)
  UNION ALL
  SELECT 'devolver_estoque: corpo esperado (md5)', 'c98a1d49d63e0174f4bdd95dcffc54f4 ou e42582a472fd79ba987c11f161ad9a7a',
         COALESCE((SELECT h FROM fn WHERE nome = 'devolver_estoque' LIMIT 1), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'devolver_estoque' LIMIT 1) IN ('c98a1d49d63e0174f4bdd95dcffc54f4', 'e42582a472fd79ba987c11f161ad9a7a'), false)
  UNION ALL
  SELECT 'admin_devolucao_concluir: corpo esperado (md5)', 'b55bf2488a1d5165afddaa4d103d3e18 ou 9ec7a021b965b7abdc77bc4b2b900c35',
         COALESCE((SELECT h FROM fn WHERE nome = 'admin_devolucao_concluir' LIMIT 1), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'admin_devolucao_concluir' LIMIT 1) IN ('b55bf2488a1d5165afddaa4d103d3e18', '9ec7a021b965b7abdc77bc4b2b900c35'), false)
  UNION ALL
  SELECT 'resolver_peca_sem_tamanho: corpo esperado (md5)', 'cac3d04d9be77c7d4004003bb70561c5 ou 115378a67cd4f89b73129aeec4c46a7f',
         COALESCE((SELECT h FROM fn WHERE nome = 'resolver_peca_sem_tamanho' LIMIT 1), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'resolver_peca_sem_tamanho' LIMIT 1) IN ('cac3d04d9be77c7d4004003bb70561c5', '115378a67cd4f89b73129aeec4c46a7f'), false)
  UNION ALL
  SELECT 'get_admin_analytics_v2: corpo esperado (md5)', '4f8fb94f6cb0018e10d0ef71541f1cbf ou 1624212a7096b6f49a80370b30191a15',
         COALESCE((SELECT h FROM fn WHERE nome = 'get_admin_analytics_v2' LIMIT 1), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'get_admin_analytics_v2' LIMIT 1) IN ('4f8fb94f6cb0018e10d0ef71541f1cbf', '1624212a7096b6f49a80370b30191a15'), false)
  UNION ALL
  SELECT 'as quatro funcoes: uma so cada, plpgsql SECURITY DEFINER VOLATILE, search_path=public, assinatura e EXECUTE de sempre',
         'sim',
         CASE WHEN atributos.certos THEN 'sim' ELSE 'nao' END,
         COALESCE(atributos.certos, false)
  FROM atributos
  UNION ALL
  SELECT 'produtos (id, deleted_at) e product_variants (id, product_id): as colunas que a regra nova le',
         'sim',
         CASE WHEN colunas.certo THEN 'sim' ELSE 'nao' END,
         colunas.certo
  FROM colunas
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;

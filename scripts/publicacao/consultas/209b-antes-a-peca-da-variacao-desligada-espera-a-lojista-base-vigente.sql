-- 209b-antes-a-peca-da-variacao-desligada-espera-a-lojista-base-vigente: ANTES da 20261653000000. SO LEITURA, somente catalogo,
-- rol fechado de 5 linhas (o mesmo da 209a). A base vigente e' o corpo da 20261642000000 de devolver_estoque
-- (80b1a90baf10d1b4c59484772e4864c4) e o de admin_devolucao_concluir (1a548896acb8248f1b1771d765c92fcb); aceita tambem os corpos desta
-- para uma reaplicacao idempotente. Confere as premissas do pre-voo: atributos e ACL de sempre e o destino da peca que espera (a tabela
-- pecas_sem_tamanho e as RPCs da 20261642000000) no ar, e a leitura nova pecas_sem_tamanho_da_devolucao AUSENTE (ou a desta, md5
-- a5514b503791af689ba68dfda6b76b6e). NAO le nenhuma linha de pedido, devolucao, produto nem peca e NAO chama funcao nenhuma. Tudo true =
-- pode aplicar; qualquer false = PARE (o pre-voo da migration recusaria).
WITH fn AS (
  SELECT p.proname::text AS nome, md5(replace(p.prosrc, chr(13), '')) AS h, p.oid,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 'v' AND NOT p.proretset AND NOT p.proisstrict
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS comum
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('devolver_estoque', 'admin_devolucao_concluir')
), atributos AS (
  SELECT count(*) = 2
         AND bool_and(f.comum)
         AND bool_and(CASE f.nome
               WHEN 'devolver_estoque' THEN pg_get_function_result(f.oid) = 'integer'
                 AND pg_get_function_arguments(f.oid) = 'p_order_id uuid'
                 AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
               ELSE pg_get_function_result(f.oid) = 'jsonb'
                 AND pg_get_function_arguments(f.oid) = 'p_id uuid, p_resolucao text, p_itens jsonb, p_valor_reembolso numeric DEFAULT NULL::numeric, p_observacao text DEFAULT NULL::text'
                 AND has_function_privilege('authenticated', f.oid, 'EXECUTE')
                 AND has_function_privilege('service_role', f.oid, 'EXECUTE')
             END) AS certos
  FROM fn f
), destino AS (
  SELECT COALESCE((SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
                     FROM pg_catalog.pg_attribute a
                    WHERE a.attrelid = to_regclass('public.pecas_sem_tamanho') AND a.attnum > 0 AND NOT a.attisdropped)
                   = 'criada_em:timestamp with time zone:true,devolucao_item_id:uuid:false,id:uuid:true,order_id:uuid:false,order_item_id:uuid:false,origem:text:true,produto_id:uuid:true,resolucao:text:false,resolvida_em:timestamp with time zone:false,resolvida_por:uuid:false,variant_id:uuid:false', false)
         AND COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.pecas_sem_tamanho_pendentes(uuid)'))
                   = 'd6a9047fe26305d0c1446c284033245d', false)
         AND COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.resolver_peca_sem_tamanho(uuid,uuid)'))
                   = 'cac3d04d9be77c7d4004003bb70561c5', false) AS certo
), da AS (
  SELECT (SELECT count(*) FROM pg_catalog.pg_proc x
           WHERE x.pronamespace = 'public'::regnamespace AND x.proname = 'pecas_sem_tamanho_da_devolucao') AS n,
         md5(replace(p.prosrc, chr(13), '')) AS h,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 's' AND p.proretset AND NOT p.proisstrict
           AND pg_get_function_arguments(p.oid) = 'p_order_id uuid'
           AND pg_get_function_result(p.oid) = 'TABLE(devolucao_item_id uuid)'
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AS atributos
  FROM (SELECT to_regprocedure('public.pecas_sem_tamanho_da_devolucao(uuid)') AS oid) q
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = q.oid
  LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo, ok) AS (
  SELECT 'devolver_estoque: corpo esperado (md5)',
         '80b1a90baf10d1b4c59484772e4864c4 ou 2913f3178498938d0a79e3b47a1084d1',
         COALESCE((SELECT h FROM fn WHERE nome = 'devolver_estoque' LIMIT 1), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'devolver_estoque' LIMIT 1) IN ('80b1a90baf10d1b4c59484772e4864c4', '2913f3178498938d0a79e3b47a1084d1'), false)
  UNION ALL
  SELECT 'admin_devolucao_concluir: corpo esperado (md5)',
         '1a548896acb8248f1b1771d765c92fcb ou d146dc7aefb07a0bf580ed7265d9453e',
         COALESCE((SELECT h FROM fn WHERE nome = 'admin_devolucao_concluir' LIMIT 1), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'admin_devolucao_concluir' LIMIT 1) IN ('1a548896acb8248f1b1771d765c92fcb', 'd146dc7aefb07a0bf580ed7265d9453e'), false)
  UNION ALL
  SELECT 'devolver_estoque e admin_devolucao_concluir: uma so cada, plpgsql SECURITY DEFINER VOLATILE, search_path=public, devolver_estoque sem EXECUTE de aplicacao, admin_devolucao_concluir so de authenticated e service_role',
         'sim',
         CASE WHEN atributos.certos THEN 'sim' ELSE 'nao' END,
         COALESCE(atributos.certos, false)
  FROM atributos
  UNION ALL
  SELECT 'o destino da peca que espera: pecas_sem_tamanho e as RPCs da 20261642000000 no ar, com a forma e os corpos dela',
         'sim',
         CASE WHEN destino.certo THEN 'sim' ELSE 'nao' END,
         destino.certo
  FROM destino
  UNION ALL
  SELECT 'pecas_sem_tamanho_da_devolucao: corpo exato (md5), uma so, plpgsql SECURITY DEFINER STABLE, search_path=public, EXECUTE so de authenticated',
         'AUSENTE ou a5514b503791af689ba68dfda6b76b6e',
         COALESCE((SELECT h FROM da), 'AUSENTE')
           || CASE WHEN (SELECT n FROM da) > 1 THEN ' (sobrecarga)'
                   WHEN (SELECT h FROM da) IS NOT NULL AND NOT COALESCE((SELECT atributos FROM da), false) THEN ' (atributos ou ACL)'
                   ELSE '' END,
         COALESCE((SELECT n = 0 OR (n = 1 AND h = 'a5514b503791af689ba68dfda6b76b6e' AND COALESCE(atributos, false)) FROM da), false)
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;

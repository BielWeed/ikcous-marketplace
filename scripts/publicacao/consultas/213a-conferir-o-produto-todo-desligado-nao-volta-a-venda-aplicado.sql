-- 213a-conferir-o-produto-todo-desligado-nao-volta-a-venda-aplicado: DEPOIS da 20261657000000. SO LEITURA, somente catalogo, rol
-- fechado de 3 linhas (o mesmo da 213b). Confirma que devolver_estoque (md5 c98a1d49d63e0174f4bdd95dcffc54f4) e admin_devolucao_concluir
-- (md5 b55bf2488a1d5165afddaa4d103d3e18) tem o corpo desta migration (a peca da variacao desligada de um produto SEM nenhuma variacao
-- ligada fica na propria variacao e nao credita o pai) e os atributos e a ACL de sempre. NAO le nenhuma linha de pedido, devolucao,
-- produto nem peca e NAO chama funcao nenhuma. Tudo true = aplicado; qualquer false = PARE e leia a linha. Depois do rollback-manual as
-- linhas dos corpos reprovam (voltam os da 20261653000000).
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
), itens(item, esperado, vivo, ok) AS (
  SELECT 'devolver_estoque: corpo esperado (md5)', 'c98a1d49d63e0174f4bdd95dcffc54f4',
         COALESCE((SELECT h FROM fn WHERE nome = 'devolver_estoque' LIMIT 1), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'devolver_estoque' LIMIT 1) = 'c98a1d49d63e0174f4bdd95dcffc54f4', false)
  UNION ALL
  SELECT 'admin_devolucao_concluir: corpo esperado (md5)', 'b55bf2488a1d5165afddaa4d103d3e18',
         COALESCE((SELECT h FROM fn WHERE nome = 'admin_devolucao_concluir' LIMIT 1), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'admin_devolucao_concluir' LIMIT 1) = 'b55bf2488a1d5165afddaa4d103d3e18', false)
  UNION ALL
  SELECT 'devolver_estoque e admin_devolucao_concluir: uma so cada, plpgsql SECURITY DEFINER VOLATILE, search_path=public, devolver_estoque sem EXECUTE de aplicacao, admin_devolucao_concluir so de authenticated e service_role',
         'sim',
         CASE WHEN atributos.certos THEN 'sim' ELSE 'nao' END,
         COALESCE(atributos.certos, false)
  FROM atributos
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;

-- 190a-conferir-a-loja-grande-nao-trava-o-balcao-aplicado: DEPOIS da 20261530000000. SO LEITURA, somente catalogo, rol fechado de 6 linhas.
-- Nao le nenhuma linha (nem perfis, nem pedidos, nem produtos) e nao chama porta nenhuma: roda por papel sem privilegio de tabela.
-- Confere o ESTADO NOVO inteiro: a porta leve do balcao com o corpo desta migration (md5), os atributos e o EXECUTE so do authenticated;
-- os 2 indices validos com a definicao exata (pg_get_indexdef depois do USING: tipo, colunas, ordem, opclass e collation fora do padrao,
-- predicado e INCLUDE aparecem ali); e a get_admin_customers_paged INTACTA (a migration nao a toca: o mesmo corpo da 20261412000000).
WITH ix AS (
  SELECT v.nome, v.definicao,
         (SELECT substr(pg_get_indexdef(i.indexrelid), strpos(pg_get_indexdef(i.indexrelid), ' USING ') + 7)
            FROM pg_index i
           WHERE i.indexrelid = to_regclass(v.nome) AND i.indrelid = to_regclass(v.tabela)
             AND NOT i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
             AND i.indnatts = 2 AND i.indnkeyatts = 2 AND i.indpred IS NULL AND i.indexprs IS NULL) AS vivo
  FROM (VALUES
    ('public.idx_produtos_data_cadastro_id', 'public.produtos', 'btree (data_cadastro DESC, id)'),
    ('public.idx_order_history_status_criado', 'public.marketplace_order_history', 'btree (new_status, created_at DESC)')
  ) AS v(nome, tabela, definicao)
), fn AS (
  SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proretset, p.proisstrict,
         p.proconfig, pg_get_function_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS resultado,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS logado,
         has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('buscar_clientes_do_balcao', 'get_admin_customers_paged')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'buscar_clientes_do_balcao: uma so, com o corpo da 20261530000000 (md5), plpgsql, SECURITY DEFINER, STABLE, search_path public, extensions, (p_search text, p_limite integer) devolvendo jsonb', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'buscar_clientes_do_balcao') = 1
    AND COALESCE((SELECT bool_and(f.h = '953a50af8e8e14e8a271d9124364bbc0' AND f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 's'
        AND NOT f.proretset AND NOT f.proisstrict AND f.proconfig = ARRAY['search_path=public, extensions']::text[]
        AND f.args = 'p_search text, p_limite integer' AND f.resultado = 'jsonb')
       FROM fn f WHERE f.proname = 'buscar_clientes_do_balcao'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'buscar_clientes_do_balcao: EXECUTE so do authenticated (nada para PUBLIC, anon e service_role)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'buscar_clientes_do_balcao') = 1
    AND COALESCE((SELECT bool_and(f.logado AND NOT f.anon AND NOT f.servico AND NOT f.publico)
       FROM fn f WHERE f.proname = 'buscar_clientes_do_balcao'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'idx_produtos_data_cadastro_id: indice valido em produtos (data_cadastro DESC, id)', 'sim', CASE WHEN
    (SELECT vivo FROM ix WHERE nome = 'public.idx_produtos_data_cadastro_id') = 'btree (data_cadastro DESC, id)' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'idx_order_history_status_criado: indice valido em marketplace_order_history (new_status, created_at DESC)', 'sim', CASE WHEN
    (SELECT vivo FROM ix WHERE nome = 'public.idx_order_history_status_criado') = 'btree (new_status, created_at DESC)' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'get_admin_customers_paged: intacta (uma so, corpo da 20261412000000 (md5), SECURITY DEFINER, EXECUTE do authenticated e do service_role, nada para PUBLIC e anon)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'get_admin_customers_paged') = 1
    AND COALESCE((SELECT bool_and(f.h = 'bdac47c59600f44cf59ac6c74e44a55e' AND f.prosecdef
        AND f.proconfig = ARRAY['search_path=public, extensions']::text[] AND f.resultado = 'jsonb'
        AND f.logado AND f.servico AND NOT f.anon AND NOT f.publico)
       FROM fn f WHERE f.proname = 'get_admin_customers_paged'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

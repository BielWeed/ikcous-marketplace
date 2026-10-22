-- DEPOIS da 20261352000000; SO LEITURA, somente catalogo, rol fechado de 5 linhas. A funcao nova nao muda nenhum dado ao ser aplicada.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'salvar_produto_com_grade: uma so, com o corpo da 20261352000000 (md5)', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 1 AND bool_and(md5(replace(p.prosrc, E'\r', '')) = '09c2a4b5724acbe46fb2c2e758e96c8f')
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'salvar_produto_com_grade'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'salvar_produto_com_grade: atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path=public, jsonb)', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
        AND p.proconfig = ARRAY['search_path=public']::text[] AND p.prorettype = 'jsonb'::regtype AND p.pronargs = 5
        AND pg_get_function_arguments(p.oid) = 'p_produto_id uuid, p_base_atualizado_em timestamp with time zone, p_produto jsonb, p_variantes jsonb, p_apagar uuid[]')
       FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'salvar_produto_com_grade: EXECUTE so para authenticated e service_role (PUBLIC e anon nao)', 'sim', CASE WHEN COALESCE(
    (SELECT NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
       FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'gatilhos de versao: set_ultima_atualizacao em produtos e sync_produto_ultima_atualizacao em variacoes ligados', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 2 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'
        AND ((t.tgrelid = to_regclass('public.produtos') AND t.tgname = 'set_ultima_atualizacao')
          OR (t.tgrelid = to_regclass('public.product_variants') AND t.tgname = 'sync_produto_ultima_atualizacao'))), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

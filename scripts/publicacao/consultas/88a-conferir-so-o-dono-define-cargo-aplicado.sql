-- 88a-conferir-so-o-dono-define-cargo-aplicado: DEPOIS da 20261383000000. SO LEITURA, somente catalogo, rol fechado de 9 linhas.
-- Nao le nenhuma linha de profiles, auth.users, dono_da_loja ou cargo_log. NAO exige dono cadastrado: o cadastro do dono e um passo
-- manual posterior ao apply (INSERT INTO public.dono_da_loja ... no cabecalho da migration).
WITH fn AS (
  SELECT p.oid, p.proname, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proisstrict, p.proconfig,
         pg_get_function_result(p.oid) AS resultado
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('definir_cargo', 'papel_so_pelo_definir_cargo')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'definir_cargo: uma so, com o corpo da 20261383000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'definir_cargo') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'definir_cargo' AND h = '69258350cbaf598b1e0b8e0bf2f20211') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'definir_cargo: atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path fixo, jsonb, uuid e text)', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND NOT f.proisstrict AND f.resultado = 'jsonb'
        AND f.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
        AND pg_get_function_arguments(f.oid) = 'p_user_id uuid, p_cargo text')
       FROM fn f WHERE f.oid = to_regprocedure('public.definir_cargo(uuid,text)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'definir_cargo: EXECUTE so para authenticated (PUBLIC, anon e service_role nao)', 'sim', CASE WHEN COALESCE(
    (SELECT NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       FROM pg_proc p WHERE p.oid = to_regprocedure('public.definir_cargo(uuid,text)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'papel_so_pelo_definir_cargo: uma so, com o corpo da 20261383000000 (md5), gatilho plpgsql sem SECURITY DEFINER e sem EXECUTE para ninguem', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'papel_so_pelo_definir_cargo') = 1
    AND COALESCE((SELECT bool_and(f.h = '4db62affedb4d07d5ea9e26393fb938c' AND f.lanname = 'plpgsql' AND NOT f.prosecdef AND f.resultado = 'trigger'
        AND f.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = f.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM fn f WHERE f.proname = 'papel_so_pelo_definir_cargo'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'gatilho tr_papel_so_pelo_definir_cargo em profiles: BEFORE UPDATE por linha, ligado, e entre tr_ensure_role_protection e tr_prevent_role_change', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 1 AND bool_and(t.tgenabled = 'O' AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16 AND t.tgfoid = to_regprocedure('public.papel_so_pelo_definir_cargo()'))
       FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.profiles') AND t.tgname = 'tr_papel_so_pelo_definir_cargo' AND NOT t.tgisinternal), false)
    AND COALESCE((SELECT array_position(o, 'tr_ensure_role_protection') < array_position(o, 'tr_papel_so_pelo_definir_cargo')
                        AND array_position(o, 'tr_papel_so_pelo_definir_cargo') < array_position(o, 'tr_prevent_role_change')
       FROM (SELECT array_agg(t.tgname::text ORDER BY t.tgname COLLATE "C") AS o FROM pg_trigger t
              WHERE t.tgrelid = to_regclass('public.profiles') AND NOT t.tgisinternal
                AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16) x), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'dono_da_loja e cargo_log: tabelas comuns com RLS ligada sem FORCE, uma politica de SELECT (authenticated) cada', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 2 AND bool_and(c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
        AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) = 1
        AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd = 'r' AND p.polpermissive AND p.polwithcheck IS NULL
                      AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]::oid[]))
       FROM pg_class c WHERE c.oid IN (to_regclass('public.dono_da_loja'), to_regclass('public.cargo_log'))), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'dono_da_loja e cargo_log: so SELECT para authenticated e service_role; nenhuma escrita para ninguem de aplicacao; anon e PUBLIC nada', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 2 AND bool_and(has_table_privilege('authenticated', c.oid, 'SELECT') AND has_table_privilege('service_role', c.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0))
       FROM pg_class c WHERE c.oid IN (to_regclass('public.dono_da_loja'), to_regclass('public.cargo_log'))), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'dono_da_loja: no maximo uma linha por banco (chave primaria na coluna loja, CHECK loja) e user_id aponta para auth.users sem apagar em cascata', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.dono_da_loja') AND k.contype = 'p' AND pg_get_constraintdef(k.oid) = 'PRIMARY KEY (loja)')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.dono_da_loja') AND k.contype = 'c' AND pg_get_constraintdef(k.oid) = 'CHECK (loja)')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.dono_da_loja') AND k.contype = 'f'
                  AND k.confrelid = to_regclass('auth.users') AND k.confdeltype = 'r') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

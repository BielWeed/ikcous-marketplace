-- 180a-conferir-o-cadastro-fiscal-aplicado: DEPOIS da 20261440000000. SO LEITURA, somente catalogo, rol fechado de 9 linhas.
-- Nao le nenhuma linha de fiscal_cadastro, fiscal_cadastro_log, dono_da_loja, profiles ou auth.users. NAO exige dono cadastrado: o cadastro do
-- dono e passo manual da loja (consulta 88c, docs/runbooks/definir-o-dono-da-loja.md). NAO confere o corpo de fin_dre: a migration o confere
-- ao aplicar (pos-voo) e uma sucessora legitima dele nao pode reprovar o cadastro fiscal aqui.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proisstrict, p.proconfig,
         pg_get_function_result(p.oid) AS resultado
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fiscal_cadastro_salvar'
), tb AS (
  SELECT c.oid, c.relname::text AS tabela, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
  FROM pg_class c WHERE c.oid IN (to_regclass('public.fiscal_cadastro'), to_regclass('public.fiscal_cadastro_log'))
), forma AS (
  SELECT t.tabela,
         string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum) AS colunas
  FROM tb t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  GROUP BY t.tabela
), chaves AS (
  SELECT t.tabela, string_agg(k.conname::text, ',' ORDER BY k.conname::text COLLATE "C") AS nomes
  FROM tb t JOIN pg_constraint k ON k.conrelid = t.oid AND k.contype IN ('p', 'c')
  GROUP BY t.tabela
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fiscal_cadastro_salvar: uma so, com o corpo da 20261440000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn) = 1
    AND EXISTS (SELECT 1 FROM fn WHERE h = '0e76c24e09699b4aba53600bf4061c67') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fiscal_cadastro_salvar: atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path fixo em public, jsonb, um argumento p jsonb)', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND NOT f.proisstrict AND f.resultado = 'jsonb'
        AND f.proconfig = ARRAY['search_path=public']::text[]
        AND pg_get_function_arguments(f.oid) = 'p jsonb')
       FROM fn f WHERE f.oid = to_regprocedure('public.fiscal_cadastro_salvar(jsonb)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fiscal_cadastro_salvar: EXECUTE so para authenticated (PUBLIC, anon e service_role nao)', 'sim', CASE WHEN COALESCE(
    (SELECT NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       FROM pg_proc p WHERE p.oid = to_regprocedure('public.fiscal_cadastro_salvar(jsonb)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fiscal_cadastro e fiscal_cadastro_log: tabelas comuns com RLS ligada sem FORCE, uma politica de SELECT (authenticated) cada, so do admin atual', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 2 AND bool_and(t.relkind = 'r' AND t.relrowsecurity AND NOT t.relforcerowsecurity
        AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = t.oid) = 1
        AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid AND p.polname = t.tabela || '_select_policy'
                      AND p.polcmd = 'r' AND p.polpermissive AND p.polwithcheck IS NULL
                      AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]::oid[]
                      AND replace(pg_get_expr(p.polqual, p.polrelid), 'public.', '') = '( SELECT rls_admin_atual() AS rls_admin_atual)'))
       FROM tb t), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fiscal_cadastro e fiscal_cadastro_log: so SELECT para authenticated e service_role; nenhuma escrita para ninguem de aplicacao; anon e PUBLIC nada', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 2 AND bool_and(has_table_privilege('authenticated', t.oid, 'SELECT') AND has_table_privilege('service_role', t.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', t.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', t.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0))
       FROM tb t), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fiscal_cadastro e fiscal_cadastro_log: colunas com o tipo e a nulidade da migration (atualizado_em e atualizado_por NOT NULL, id boolean e id bigint identity)', 'sim', CASE WHEN
    (SELECT count(*) FROM forma) = 2
    AND EXISTS (SELECT 1 FROM forma WHERE tabela = 'fiscal_cadastro'
                  AND colunas = 'id:boolean:true,regime:text:true,atividade:text:true,aberta_em:date:false,vende_no_app_desde:date:false,atualizado_em:timestamp with time zone:true,atualizado_por:uuid:true')
    AND EXISTS (SELECT 1 FROM forma WHERE tabela = 'fiscal_cadastro_log'
                  AND colunas = 'id:bigint:true,quem:uuid:true,quando:timestamp with time zone:true,antes:jsonb:false,depois:jsonb:true')
    AND COALESCE((SELECT a.attidentity = 'a' FROM pg_attribute a WHERE a.attrelid = to_regclass('public.fiscal_cadastro_log') AND a.attname = 'id'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fiscal_cadastro: no maximo uma linha por banco (chave primaria em id, CHECK id) e os CHECKs de regime, atividade e dia 1 existem', 'sim', CASE WHEN
    (SELECT count(*) FROM chaves) = 2
    AND EXISTS (SELECT 1 FROM chaves WHERE tabela = 'fiscal_cadastro'
                  AND nomes = 'fiscal_cadastro_atividade_check,fiscal_cadastro_pkey,fiscal_cadastro_regime_check,fiscal_cadastro_uma_so_check,fiscal_cadastro_vende_dia_1_check')
    AND EXISTS (SELECT 1 FROM chaves WHERE tabela = 'fiscal_cadastro_log' AND nomes = 'fiscal_cadastro_log_pkey')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.fiscal_cadastro') AND k.contype = 'p' AND pg_get_constraintdef(k.oid) = 'PRIMARY KEY (id)')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.fiscal_cadastro') AND k.contype = 'c' AND pg_get_constraintdef(k.oid) = 'CHECK (id)') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fiscal_cadastro_log: a sequencia do identity existe e nao tem grant para ninguem alem do dono', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 1 AND bool_and(NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(s.relacl, acldefault('s', s.relowner))) a WHERE a.grantee <> s.relowner))
       FROM pg_class s JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = s.oid
                                       AND d.refobjid = to_regclass('public.fiscal_cadastro_log') AND d.deptype = 'i'
      WHERE s.relkind = 'S'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

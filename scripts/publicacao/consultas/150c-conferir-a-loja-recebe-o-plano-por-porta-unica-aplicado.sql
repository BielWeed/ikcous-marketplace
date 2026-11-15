-- 150c-conferir-a-loja-recebe-o-plano-por-porta-unica-aplicado: DEPOIS da 20261399998000. SO LEITURA, rol fechado de 8 linhas.
-- Somente catalogo: NAO le nenhuma linha de assinatura_da_loja_chave (e' o hash da chave da loja) nem de assinatura_da_loja (o cartao) e NAO chama as funcoes. Prova que as duas
-- funcoes tem o corpo desta migration, que o visitante (anon) e o logado (authenticated) alcancam SO a porta (assinatura_da_loja_gravar) e nunca o definir_chave, que o
-- definir_chave e' so do service_role e que a tabela da chave esta selada a todo papel de aplicacao. Antes do apply esta consulta responde "nao" (a 150c negativa e' esperada), nunca erro.
WITH fn AS (
  SELECT p.oid, p.proname, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proisstrict, p.proretset, p.proconfig,
         pg_get_function_result(p.oid) AS resultado, pg_get_function_arguments(p.oid) AS argumentos
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('assinatura_da_loja_definir_chave', 'assinatura_da_loja_gravar')
), tab AS (
  SELECT to_regclass('public.assinatura_da_loja_chave') AS oid
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_definir_chave: uma so, com o corpo da 20261399998000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'assinatura_da_loja_definir_chave') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'assinatura_da_loja_definir_chave' AND h = 'ee89c0e70e378fe0be0fc3c805567d56') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_definir_chave: atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path public e pg_temp, retorna void) e EXECUTE so para service_role (anon, authenticated e PUBLIC nada)', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND NOT f.proisstrict AND NOT f.proretset AND f.resultado = 'void'
        AND f.proconfig = ARRAY['search_path=public, pg_temp']::text[]
        AND f.argumentos = 'p_hash text, p_substituir boolean DEFAULT false'
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = f.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM fn f WHERE f.oid = to_regprocedure('public.assinatura_da_loja_definir_chave(text, boolean)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_gravar: uma so, com o corpo da 20261399998000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'assinatura_da_loja_gravar') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'assinatura_da_loja_gravar' AND h = '565f82cb9a65ed96e4702db9d97bf0d6') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_gravar: atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path public e pg_temp, retorna jsonb) e EXECUTE so para anon e authenticated (service_role e PUBLIC nada)', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND NOT f.proisstrict AND NOT f.proretset AND f.resultado = 'jsonb'
        AND f.proconfig = ARRAY['search_path=public, pg_temp']::text[]
        AND f.argumentos = 'p_chave text, p_dados jsonb, p_simular boolean DEFAULT false'
        AND has_function_privilege('anon', f.oid, 'EXECUTE') AND has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = f.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM fn f WHERE f.oid = to_regprocedure('public.assinatura_da_loja_gravar(text, jsonb, boolean)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_chave: tabela comum com RLS ligada sem FORCE e nenhuma politica', 'sim', CASE WHEN COALESCE(
    (SELECT c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
       FROM pg_class c WHERE c.oid = (SELECT oid FROM tab)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_chave: nenhum privilegio para anon, authenticated, service_role e PUBLIC (tabela e coluna)', 'sim', CASE WHEN COALESCE(
    (SELECT NOT has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0)
       FROM pg_class c WHERE c.oid = (SELECT oid FROM tab)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_chave: as 3 colunas com o tipo certo, defaults, chave primaria (id) e os dois CHECK (id = 1 e hash de 64 hex minusculos)', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
       FROM pg_attribute a WHERE a.attrelid = (SELECT oid FROM tab) AND a.attnum > 0 AND NOT a.attisdropped)
       = 'chave_hash:text:true,criada_em:timestamp with time zone:true,id:smallint:true'
    AND EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                 WHERE d.adrelid = (SELECT oid FROM tab) AND a.attname = 'id' AND pg_get_expr(d.adbin, d.adrelid) = '1')
    AND EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                 WHERE d.adrelid = (SELECT oid FROM tab) AND a.attname = 'criada_em' AND pg_get_expr(d.adbin, d.adrelid) = 'now()')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tab) AND k.contype = 'p' AND pg_get_constraintdef(k.oid) = 'PRIMARY KEY (id)')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tab) AND k.contype = 'c' AND replace(pg_get_constraintdef(k.oid), ' ', '') = 'CHECK((id=1))')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tab) AND k.contype = 'c'
                  AND replace(pg_get_constraintdef(k.oid), ' ', '') = 'CHECK((chave_hash~''^[0-9a-f]{64}$''::text))')
    AND (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tab)) = 3 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

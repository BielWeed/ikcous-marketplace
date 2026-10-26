-- 95a-conferir-o-frete-tem-limite-de-cotacoes-aplicado: DEPOIS da 20261389000000. SO LEITURA, somente catalogo, rol fechado de 6 linhas.
-- Nao le nenhuma linha de nenhuma tabela. Antes do apply esta consulta responde "nao" (a 95a negativa e' esperada), nunca erro.
-- Prova que o contador existe com o corpo certo, que so a edge (service_role) o executa e que ninguem de aplicacao toca a tabela dele.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proisstrict, p.proconfig,
         pg_get_function_result(p.oid) AS resultado
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'frete_consumir_cota'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frete_consumir_cota: uma so, com o corpo da 20261389000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn) = 1
    AND EXISTS (SELECT 1 FROM fn WHERE h = '8e86b8ee56a05d623a2684c0f8ab8f05') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frete_consumir_cota: atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path fixo, retorna jsonb, 3 argumentos) e EXECUTE so para service_role', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND NOT f.proisstrict AND f.resultado = 'jsonb'
        AND f.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
        AND pg_get_function_arguments(f.oid) = 'p_origem text, p_limite integer, p_janela_segundos integer'
        AND has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = f.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM fn f WHERE f.oid = to_regprocedure('public.frete_consumir_cota(text,integer,integer)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frete_cota_por_origem: tabela comum com RLS ligada sem FORCE e nenhuma politica', 'sim', CASE WHEN COALESCE(
    (SELECT c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
       FROM pg_class c WHERE c.oid = to_regclass('public.frete_cota_por_origem')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frete_cota_por_origem: nenhum privilegio para anon, authenticated, service_role nem PUBLIC', 'sim', CASE WHEN COALESCE(
    (SELECT NOT has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_table_privilege('anon', c.oid, 'DELETE, TRUNCATE, TRIGGER')
        AND NOT has_table_privilege('authenticated', c.oid, 'DELETE, TRUNCATE, TRIGGER')
        AND NOT has_table_privilege('service_role', c.oid, 'DELETE, TRUNCATE, TRIGGER')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0)
       FROM pg_class c WHERE c.oid = to_regclass('public.frete_cota_por_origem')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frete_cota_por_origem: as 3 colunas com o tipo certo, chave primaria (origem, janela_inicio), CHECK de origem e de chamadas e o indice por janela_inicio', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
       FROM pg_attribute a WHERE a.attrelid = to_regclass('public.frete_cota_por_origem') AND a.attnum > 0 AND NOT a.attisdropped)
       = 'chamadas:integer:true,janela_inicio:timestamp with time zone:true,origem:text:true'
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.frete_cota_por_origem') AND k.contype = 'p' AND pg_get_constraintdef(k.oid) = 'PRIMARY KEY (origem, janela_inicio)')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.frete_cota_por_origem') AND k.contype = 'c'
                  AND replace(pg_get_constraintdef(k.oid), ' ', '') LIKE '%origem%~%[0-9a-f]{32}%')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.frete_cota_por_origem') AND k.contype = 'c'
                  AND replace(pg_get_constraintdef(k.oid), ' ', '') LIKE '%chamadas>0%')
    AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = to_regclass('public.frete_cota_por_origem') AND i.indisvalid
                  AND pg_get_indexdef(i.indexrelid) LIKE '%(janela_inicio)') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

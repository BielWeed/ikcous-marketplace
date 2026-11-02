-- 117a-conferir-as-visitas-da-loja-contam-pelo-porteiro-aplicado: DEPOIS da 20261399000000. SO LEITURA, rol fechado de 8 linhas.
-- Somente catalogo: NAO le nenhuma linha de visitas_por_dia (a tabela nasce vazia e a contagem e' dado da loja). Prova que as duas funcoes
-- tem o corpo desta migration, que o visitante (anon) alcanca SO a contar_entrada (e o authenticated nao), que a leitura e' so do authenticated e do service_role
-- e que a tabela esta selada a todo papel de aplicacao. Antes do apply esta consulta responde "nao" (a 117a negativa e' esperada), nunca erro.
WITH fn AS (
  SELECT p.oid, p.proname, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proisstrict, p.proretset, p.proconfig,
         pg_get_function_result(p.oid) AS resultado, pg_get_function_arguments(p.oid) AS argumentos
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('contar_entrada', 'crm_visitas')
), tab AS (
  SELECT to_regclass('public.visitas_por_dia') AS oid
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'contar_entrada: uma so, com o corpo da 20261399000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'contar_entrada') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'contar_entrada' AND h = 'e31b3fd92a739ff7b5c206ef0ece1c22') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'contar_entrada: atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path fixo e lock_timeout de 100ms, retorna void) e EXECUTE so para anon e service_role (authenticated e PUBLIC nada)', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND NOT f.proisstrict AND NOT f.proretset AND f.resultado = 'void'
        AND f.proconfig = ARRAY['search_path=public', 'lock_timeout=100ms']::text[]
        AND f.argumentos = 'p_canal text'
        AND has_function_privilege('anon', f.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = f.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM fn f WHERE f.oid = to_regprocedure('public.contar_entrada(text)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'crm_visitas: uma so, com o corpo da 20261399000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'crm_visitas') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'crm_visitas' AND h = '025c19ac6d1ce86617dba41b5ba8b73c') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'crm_visitas: atributos de sempre (SECURITY DEFINER, plpgsql, STABLE, search_path fixo, retorna jsonb) e EXECUTE so para authenticated e service_role (anon e PUBLIC nada)', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 's' AND NOT f.proisstrict AND NOT f.proretset AND f.resultado = 'jsonb'
        AND f.proconfig = ARRAY['search_path=public']::text[]
        AND f.argumentos = 'p_inicio date, p_fim date'
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
        AND has_function_privilege('authenticated', f.oid, 'EXECUTE') AND has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = f.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM fn f WHERE f.oid = to_regprocedure('public.crm_visitas(date, date)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'visitas_por_dia: tabela comum com RLS ligada sem FORCE e nenhuma politica', 'sim', CASE WHEN COALESCE(
    (SELECT c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
       FROM pg_class c WHERE c.oid = (SELECT oid FROM tab)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'visitas_por_dia: nenhum privilegio para anon, authenticated, service_role e PUBLIC (tabela e coluna)', 'sim', CASE WHEN COALESCE(
    (SELECT NOT has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0)
       FROM pg_class c WHERE c.oid = (SELECT oid FROM tab)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'visitas_por_dia: as 3 colunas com o tipo certo, default 0, chave primaria (dia, canal) e os dois CHECK (5 canais e contagem >= 0)', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
       FROM pg_attribute a WHERE a.attrelid = (SELECT oid FROM tab) AND a.attnum > 0 AND NOT a.attisdropped)
       = 'canal:text:true,contagem:integer:true,dia:date:true'
    AND EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                 WHERE d.adrelid = (SELECT oid FROM tab) AND a.attname = 'contagem' AND pg_get_expr(d.adbin, d.adrelid) = '0')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tab) AND k.contype = 'p' AND pg_get_constraintdef(k.oid) = 'PRIMARY KEY (dia, canal)')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tab) AND k.contype = 'c'
                  AND pg_get_constraintdef(k.oid) LIKE 'CHECK ((canal = ANY%'
                  AND (SELECT array_agg(m[1] ORDER BY m[1]) FROM regexp_matches(pg_get_constraintdef(k.oid), '''([a-z_]+)''::text', 'g') AS m)
                      = ARRAY['direto', 'instagram', 'outros_sites', 'previa', 'whatsapp']::text[])
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tab) AND k.contype = 'c'
                  AND replace(pg_get_constraintdef(k.oid), ' ', '') = 'CHECK((contagem>=0))')
    AND (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tab)) = 3 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

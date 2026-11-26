-- 187a-conferir-a-saude-da-reconciliacao-aplicado: DEPOIS da 20261500000000. SO LEITURA, somente catalogo, rol fechado de 8 linhas.
-- Nao le nenhuma linha de public.saude_da_reconciliacao e nao chama nenhuma das duas funcoes (chamar a registrar gravaria um batimento sem rodada nenhuma): roda por
-- papel sem privilegio de tabela. Confere o ESTADO NOVO inteiro: a tabela com a forma e o fechamento da migration, a porta da edge so do service_role e a leitura
-- publica so de anon e authenticated, com os corpos dela (md5) e o mesmo dono da tabela.
WITH tab AS (
  SELECT c.oid, c.relowner, c.relacl, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c WHERE c.oid = to_regclass('public.saude_da_reconciliacao')
), fn AS (
  SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.provolatile, p.proconfig, p.proretset, p.proisstrict, l.lanname,
         md5(replace(p.prosrc, chr(13), '')) AS h,
         pg_get_function_identity_arguments(p.oid) AS argumentos, pg_get_function_result(p.oid) AS retorno
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('saude_da_reconciliacao_registrar', 'saude_da_loja')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'saude_da_reconciliacao: tabela comum com as 6 colunas, a chave (id) e os 4 CHECKs desta migration, sem default', 'sim', CASE WHEN
    (SELECT count(*) FROM tab WHERE relkind = 'r') = 1
    AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
           FROM pg_attribute a WHERE a.attrelid = (SELECT oid FROM tab) AND a.attnum > 0 AND NOT a.attisdropped)
        = 'degradado:boolean:true,etapas_com_falha:text[]:true,id:smallint:true,rodadas_degradadas_seguidas:integer:true,ultima_rodada_em:timestamp with time zone:true,ultima_saudavel_em:timestamp with time zone:false'
    AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = (SELECT oid FROM tab))
    AND (SELECT string_agg(k.contype::text || ':' || replace(pg_get_constraintdef(k.oid), ' ', ''), '|' ORDER BY k.contype, replace(pg_get_constraintdef(k.oid), ' ', '') COLLATE "C")
           FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tab))
        = 'c:CHECK((degradado=(cardinality(etapas_com_falha)>0)))|c:CHECK((etapas_com_falha<@ARRAY[''pagamentos''::text,''cancelamentos''::text,''estornos''::text,''contestacoes''::text]))|c:CHECK((id=1))|c:CHECK((rodadas_degradadas_seguidas>=0))|p:PRIMARYKEY(id)'
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'saude_da_reconciliacao: RLS ligada sem FORCE e sem politica; nenhum privilegio de tabela nem de coluna para PUBLIC, anon, authenticated e service_role', 'sim', CASE WHEN
    COALESCE((SELECT t.relrowsecurity AND NOT t.relforcerowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid)
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) g WHERE g.grantee = 0)
        AND NOT EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g WHERE a.attrelid = t.oid AND a.attacl IS NOT NULL AND g.grantee = 0)
        AND NOT has_table_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
       FROM tab t), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'saude_da_reconciliacao_registrar: uma so, com o corpo desta migration (md5), plpgsql, SECURITY DEFINER, VOLATILE, search_path fixo, (boolean, text[]) devolve void', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'saude_da_reconciliacao_registrar') = 1
    AND EXISTS (SELECT 1 FROM fn f WHERE f.proname = 'saude_da_reconciliacao_registrar' AND f.h = '06c25460eb479a7a98fc1abd4f384dfd'
                  AND f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND NOT f.proretset AND NOT f.proisstrict
                  AND f.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                  AND f.argumentos = 'p_degradado boolean, p_etapas_com_falha text[]' AND f.retorno = 'void') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'saude_da_reconciliacao_registrar: EXECUTE so do service_role (PUBLIC, anon e authenticated nao)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'saude_da_reconciliacao_registrar') = 1
    AND COALESCE((SELECT has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) g WHERE g.grantee = 0 AND g.privilege_type = 'EXECUTE')
       FROM fn f WHERE f.proname = 'saude_da_reconciliacao_registrar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'saude_da_loja: uma so, com o corpo desta migration (md5), plpgsql, SECURITY DEFINER, STABLE, search_path fixo, sem argumento, devolve jsonb', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'saude_da_loja') = 1
    AND EXISTS (SELECT 1 FROM fn f WHERE f.proname = 'saude_da_loja' AND f.h = 'c06bfddb10d28733f7a93e30783fbd91'
                  AND f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 's' AND NOT f.proretset AND NOT f.proisstrict
                  AND f.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                  AND f.argumentos = '' AND f.retorno = 'jsonb') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'saude_da_loja: EXECUTE de anon e authenticated (PUBLIC e service_role nao)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'saude_da_loja') = 1
    AND COALESCE((SELECT has_function_privilege('anon', f.oid, 'EXECUTE')
        AND has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) g WHERE g.grantee = 0 AND g.privilege_type = 'EXECUTE')
       FROM fn f WHERE f.proname = 'saude_da_loja'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as duas funcoes tem o mesmo dono da tabela', 'sim', CASE WHEN
    (SELECT count(*) FROM tab) = 1 AND (SELECT count(*) FROM fn) = 2
    AND NOT EXISTS (SELECT 1 FROM fn f WHERE f.proowner IS DISTINCT FROM (SELECT relowner FROM tab)) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

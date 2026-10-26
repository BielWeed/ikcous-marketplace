-- 91a-conferir-o-preco-do-produto-deixa-historico-aplicado: DEPOIS da 20261386000000. SO LEITURA, rol fechado de 8 linhas.
-- Catalogo, mais UMA contagem (quantos produtos ficaram sem nenhuma linha de historico: tem de ser zero). Nao devolve nenhum preco,
-- nome ou id de produto, nem autor. A contagem usa query_to_xml e so referencia a tabela quando ela existe: antes do apply esta consulta
-- responde "nao" (a 91a negativa e' esperada antes do apply), nunca erro. Prova que o historico existe, que so o gatilho escreve nele e que o backfill cobriu a loja.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proisstrict, p.proconfig,
         pg_get_function_result(p.oid) AS resultado
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'registrar_historico_de_preco'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'registrar_historico_de_preco: uma so, com o corpo da 20261386000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn) = 1
    AND EXISTS (SELECT 1 FROM fn WHERE h = '6063b9f032796323f13476dcd6a52cc8') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'registrar_historico_de_preco: atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path fixo, retorna trigger) e EXECUTE para ninguem de aplicacao', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND NOT f.proisstrict AND f.resultado = 'trigger'
        AND f.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
        AND pg_get_function_arguments(f.oid) = ''
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = f.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM fn f WHERE f.oid = to_regprocedure('public.registrar_historico_de_preco()')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'gatilho tr_produto_historico_de_preco em produtos: AFTER INSERT OR UPDATE OF preco_venda por linha, ligado, apontando para a funcao', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 1 AND bool_and(t.tgenabled = 'O' AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 0 AND (t.tgtype & 4) = 4
        AND (t.tgtype & 8) = 0 AND (t.tgtype & 16) = 16 AND (t.tgtype & 32) = 0
        AND t.tgfoid = to_regprocedure('public.registrar_historico_de_preco()')
        AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a WHERE a.attrelid = to_regclass('public.produtos') AND a.attname = 'preco_venda' AND NOT a.attisdropped))
       FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.produtos') AND t.tgname = 'tr_produto_historico_de_preco' AND NOT t.tgisinternal), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'produto_historico_preco: tabela comum com RLS ligada sem FORCE e uma so politica, de SELECT para authenticated, so do admin atual', 'sim', CASE WHEN COALESCE(
    (SELECT c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
        AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) = 1
        AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'produto_historico_preco_select_policy'
                      AND p.polcmd = 'r' AND p.polpermissive AND p.polwithcheck IS NULL
                      AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]::oid[]
                      AND replace(pg_get_expr(p.polqual, p.polrelid), ' ', '') LIKE '%rls_admin_atual()%')
       FROM pg_class c WHERE c.oid = to_regclass('public.produto_historico_preco')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'produto_historico_preco: so SELECT para authenticated e service_role; nenhuma escrita para ninguem de aplicacao; anon e PUBLIC nada', 'sim', CASE WHEN COALESCE(
    (SELECT has_table_privilege('authenticated', c.oid, 'SELECT') AND has_table_privilege('service_role', c.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0)
       FROM pg_class c WHERE c.oid = to_regclass('public.produto_historico_preco')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'produto_historico_preco: as 7 colunas com o tipo certo, chave primaria, FK para produtos ON DELETE CASCADE, CHECK de origem e o indice (produto_id, mudado_em DESC)', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
       FROM pg_attribute a WHERE a.attrelid = to_regclass('public.produto_historico_preco') AND a.attnum > 0 AND NOT a.attisdropped)
       = 'id:uuid:true,mudado_em:timestamp with time zone:true,mudado_por:uuid:false,origem:text:true,preco:numeric(10,2):true,preco_anterior:numeric(10,2):false,produto_id:uuid:true'
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.produto_historico_preco') AND k.contype = 'p' AND pg_get_constraintdef(k.oid) = 'PRIMARY KEY (id)')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.produto_historico_preco') AND k.contype = 'f'
                  AND k.confrelid = to_regclass('public.produtos') AND k.confdeltype = 'c' AND pg_get_constraintdef(k.oid) LIKE 'FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE%')
    AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.produto_historico_preco') AND k.contype = 'c'
                  AND replace(pg_get_constraintdef(k.oid), ' ', '') LIKE '%origem%cadastro%mudanca%migracao%')
    AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = to_regclass('public.produto_historico_preco') AND i.indisvalid
                  AND pg_get_indexdef(i.indexrelid) LIKE '%(produto_id, mudado_em DESC)') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'backfill: nenhum produto ficou sem linha de historico (conta, nao lista)', 'sim', CASE WHEN
    to_regclass('public.produto_historico_preco') IS NOT NULL
    AND (xpath('/row/n/text()', query_to_xml(
          'SELECT count(*) AS n FROM public.produtos p WHERE p.preco_venda IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.produto_historico_preco h WHERE h.produto_id = p.id)',
          false, true, '')))[1]::text::int = 0 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

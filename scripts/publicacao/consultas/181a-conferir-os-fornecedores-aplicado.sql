-- 181a-conferir-os-fornecedores-aplicado: DEPOIS da 20261450000000. SO LEITURA, somente catalogo, rol fechado de 9 linhas.
-- Nao le nenhuma linha de public.fornecedores (nem de nenhuma outra tabela): contato de fornecedor e' dado comercial da loja e
-- esta consulta roda por papel sem privilegio de tabela. Confere o ESTADO NOVO inteiro: a funcao do gatilho, a tabela, as colunas,
-- os CHECKs, a RLS, as quatro politicas, os privilegios e o gatilho.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.proconfig, pg_get_function_result(p.oid) AS resultado
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fornecedores_carimba_atualizado_em'
), tb AS (
  SELECT c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
  FROM pg_class c WHERE c.oid = to_regclass('public.fornecedores')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fornecedores_carimba_atualizado_em: uma so, com o corpo da 20261450000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn) = 1
    AND EXISTS (SELECT 1 FROM fn WHERE h = 'e05593617f77fa8e7caf14479400b6b1') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fornecedores_carimba_atualizado_em: atributos de sempre (plpgsql, trigger, NAO SECURITY DEFINER, search_path fixo em public) e EXECUTE para ninguem de aplicacao', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND NOT f.prosecdef AND f.resultado = 'trigger' AND f.proconfig = ARRAY['search_path=public']::text[]
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = f.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM fn f), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fornecedores: tabela comum com RLS ligada sem FORCE e fora da publicacao do realtime', 'sim', CASE WHEN COALESCE(
    (SELECT t.relkind = 'r' AND t.relrowsecurity AND NOT t.relforcerowsecurity
            AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'fornecedores')
       FROM tb t), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fornecedores: colunas com o tipo e a nulidade da migration (id uuid, nome NOT NULL, favorito boolean NOT NULL, criado_em e atualizado_em NOT NULL)', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
       FROM tb t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped)
      = 'id:uuid:true,nome:text:true,whatsapp:text:false,instagram:text:false,site:text:false,cidade:text:false,uf:text:false,observacoes:text:false,favorito:boolean:true,criado_em:timestamp with time zone:true,atualizado_em:timestamp with time zone:true' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fornecedores: chave primaria em id e os sete CHECKs (nome, whatsapp, instagram, site, cidade, uf, observacoes), sem chave estrangeira', 'sim', CASE WHEN
    (SELECT string_agg(k.conname::text, ',' ORDER BY k.conname::text COLLATE "C") FROM tb t JOIN pg_constraint k ON k.conrelid = t.oid AND k.contype IN ('p', 'c'))
      = 'fornecedores_cidade_check,fornecedores_instagram_check,fornecedores_nome_check,fornecedores_observacoes_check,fornecedores_pkey,fornecedores_site_check,fornecedores_uf_check,fornecedores_whatsapp_check'
    AND NOT EXISTS (SELECT 1 FROM tb t JOIN pg_constraint k ON k.conrelid = t.oid AND k.contype NOT IN ('p', 'c', 'n')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fornecedores: exatamente QUATRO politicas (select, insert, update, delete), so para authenticated, so do admin atual (rls_admin_atual())', 'sim', CASE WHEN COALESCE(
    (SELECT (SELECT count(*) FROM pg_policy p WHERE p.polrelid = t.oid) = 4
        AND (SELECT count(*) FROM (VALUES ('fornecedores_admin_select_policy', 'r'), ('fornecedores_admin_insert_policy', 'a'),
                                          ('fornecedores_admin_update_policy', 'w'), ('fornecedores_admin_delete_policy', 'd')) AS e(nome, acao)
              WHERE EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid AND p.polname = e.nome AND p.polcmd::text = e.acao AND p.polpermissive
                              AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]::oid[]
                              AND ((e.acao IN ('r', 'w', 'd') AND replace(pg_get_expr(p.polqual, p.polrelid), 'public.', '') = '( SELECT rls_admin_atual() AS rls_admin_atual)')
                                   OR (e.acao = 'a' AND p.polqual IS NULL))
                              AND ((e.acao IN ('a', 'w') AND replace(pg_get_expr(p.polwithcheck, p.polrelid), 'public.', '') = '( SELECT rls_admin_atual() AS rls_admin_atual)')
                                   OR (e.acao IN ('r', 'd') AND p.polwithcheck IS NULL)))) = 4
       FROM tb t), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fornecedores: SELECT, INSERT, UPDATE e DELETE so para authenticated; anon, PUBLIC e service_role nada; nenhum privilegio por coluna', 'sim', CASE WHEN COALESCE(
    (SELECT has_table_privilege('authenticated', t.oid, 'SELECT') AND has_table_privilege('authenticated', t.oid, 'INSERT')
        AND has_table_privilege('authenticated', t.oid, 'UPDATE') AND has_table_privilege('authenticated', t.oid, 'DELETE')
        AND NOT has_table_privilege('authenticated', t.oid, 'TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0)
        AND (SELECT count(*) FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee <> t.relowner) = 4
       FROM tb t), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fornecedores: um unico gatilho, BEFORE INSERT OR UPDATE por linha, habilitado, apontando para fornecedores_carimba_atualizado_em', 'sim', CASE WHEN COALESCE(
    (SELECT string_agg(g.tgname || ':' || g.tgtype::text || ':' || g.tgenabled::text || ':' || p.proname, ',' ORDER BY g.tgname)
       FROM tb t JOIN pg_trigger g ON g.tgrelid = t.oid AND NOT g.tgisinternal JOIN pg_proc p ON p.oid = g.tgfoid)
      = 'fornecedores_carimba_atualizado_em:23:O:fornecedores_carimba_atualizado_em', false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

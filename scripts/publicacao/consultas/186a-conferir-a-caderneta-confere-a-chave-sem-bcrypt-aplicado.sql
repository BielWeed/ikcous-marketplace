-- 186a-conferir-a-caderneta-confere-a-chave-sem-bcrypt-aplicado: DEPOIS da 20261490000000. SO LEITURA, somente catalogo, rol fechado de 6 linhas.
-- Nao le nenhuma linha de public.frota_lojas nem de public.frota_segredo (a caderneta guarda o endereco e a chave do banco de cada loja e
-- o hash e o atalho da chave da frota): roda por papel sem privilegio de tabela. Confere o ESTADO NOVO inteiro: as duas colunas do atalho,
-- as duas portas com os corpos novos e as travas de sempre, a caderneta continuando fechada para todo papel que nao e o dono, e o pgcrypto.
WITH fn AS (
  SELECT p.proname, p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proretset, p.proisstrict,
         p.proconfig, p.proowner, pg_get_function_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS resultado,
         NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AS so_anon
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado')
), tb AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relacl, c.relowner
  FROM pg_class c WHERE c.oid IN (to_regclass('public.frota_lojas'), to_regclass('public.frota_segredo'))
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_segredo: as colunas hash_rapido e hash_rapido_de (text, aceitam nulo, sem padrao, sem privilegio de coluna) existem', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                       || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') || ':' || COALESCE(a.attacl::text, '-'), ',' ORDER BY a.attname)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.frota_segredo') AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('hash_rapido', 'hash_rapido_de'))
      = 'hash_rapido:text:false:-:-,hash_rapido_de:text:false:-:-' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_loja: uma so, com o corpo da 20261490000000 (md5), os atributos de sempre (plpgsql, SECURITY DEFINER, VOLATILE, search_path vazio, as 6 colunas) e EXECUTE so do anon', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'resolver_loja') = 1
    AND COALESCE((SELECT bool_and(f.h = '0c60eb13c0016d2129b51def3ec7c255' AND f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v'
        AND f.proretset AND NOT f.proisstrict AND f.proconfig = ARRAY['search_path=""']::text[] AND f.args = 'p_host text, p_chave text'
        AND f.resultado = 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text)'
        AND f.so_anon)
       FROM fn f WHERE f.proname = 'resolver_loja'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_loja_com_estado: uma so, com o corpo da 20261490000000 (md5), as travas da v1 (7 colunas terminando em estado, o mesmo dono) e EXECUTE so do anon', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'resolver_loja_com_estado') = 1
    AND COALESCE((SELECT bool_and(f.h = 'a30e752cff5ae4edc2db612866eb8bcd' AND f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v'
        AND f.proretset AND NOT f.proisstrict AND f.proconfig = ARRAY['search_path=""']::text[] AND f.args = 'p_host text, p_chave text'
        AND f.resultado = 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text, estado text)'
        AND f.proowner IN (SELECT v1.proowner FROM fn v1 WHERE v1.proname = 'resolver_loja')
        AND f.so_anon)
       FROM fn f WHERE f.proname = 'resolver_loja_com_estado'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas e frota_segredo continuam fechadas (tabela comum, RLS ligada, nenhuma politica, nada para PUBLIC, anon, authenticated e service_role) e com o dono das duas portas', 'sim', CASE WHEN
    (SELECT count(*) FROM tb) = 2
    AND COALESCE((SELECT bool_and(t.relkind = 'r' AND t.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid)
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0)
        AND NOT has_table_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND t.relowner = ALL (SELECT f.proowner FROM fn f) AND (SELECT count(*) FROM fn) = 2)
       FROM tb t), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'extensions.crypt(text, text) e extensions.digest(text, text) existem (pgcrypto, a porta da chave da frota e o atalho)', 'sim', CASE WHEN
    -- pelo catalogo (e nao por to_regprocedure): quem roda esta consulta pode nao ter USAGE no schema extensions.
    (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'extensions' AND p.proname IN ('crypt', 'digest') AND pg_get_function_identity_arguments(p.oid) = 'text, text') = 2 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

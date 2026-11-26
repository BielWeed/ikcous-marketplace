-- 182a-conferir-o-estado-de-vida-da-loja-aplicado: DEPOIS da 20261460000000. SO LEITURA, somente catalogo, rol fechado de 8 linhas.
-- Nao le nenhuma linha de public.frota_lojas nem de public.frota_segredo (a caderneta guarda o endereco e a chave do banco de cada loja e
-- o hash do segredo da frota): roda por papel sem privilegio de tabela. Confere o ESTADO NOVO inteiro: a v1 com o filtro do estado e as
-- travas de sempre, a v2 nova com as mesmas travas, as tres colunas, o CHECK e a caderneta continuando fechada.
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
  SELECT c.oid, c.relname, c.relrowsecurity, c.relacl, c.relowner
  FROM pg_class c WHERE c.oid IN (to_regclass('public.frota_lojas'), to_regclass('public.frota_segredo'))
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_loja: uma so, com o corpo da 20261460000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'resolver_loja') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'resolver_loja' AND h = '19072d99f3253583342a0bb6c42447dd') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_loja: atributos de sempre (plpgsql, SECURITY DEFINER, VOLATILE, search_path vazio, as 6 colunas) e EXECUTE so do anon', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND f.proretset AND NOT f.proisstrict
        AND f.proconfig = ARRAY['search_path=""']::text[] AND f.args = 'p_host text, p_chave text'
        AND f.resultado = 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text)'
        AND f.so_anon)
       FROM fn f WHERE f.proname = 'resolver_loja'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_loja_com_estado: uma so, com o corpo da 20261460000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'resolver_loja_com_estado') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'resolver_loja_com_estado' AND h = '92682af1143806d3662411b6d5788096') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_loja_com_estado: as travas da v1 (plpgsql, SECURITY DEFINER, VOLATILE, search_path vazio, o mesmo dono, 7 colunas terminando em estado) e EXECUTE so do anon', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND f.proretset AND NOT f.proisstrict
        AND f.proconfig = ARRAY['search_path=""']::text[] AND f.args = 'p_host text, p_chave text'
        AND f.resultado = 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text, estado text)'
        AND f.proowner = (SELECT v1.proowner FROM fn v1 WHERE v1.proname = 'resolver_loja')
        AND f.so_anon)
       FROM fn f WHERE f.proname = 'resolver_loja_com_estado'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas: as colunas estado (text NOT NULL, padrao ativa), estado_desde (timestamptz NOT NULL, padrao now()) e estado_sha (text) com a forma da migration', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attname)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.frota_lojas') AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('estado', 'estado_desde', 'estado_sha'))
      = 'estado:text:true:''ativa''::text,estado_desde:timestamp with time zone:true:now(),estado_sha:text:false:-' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas: o CHECK frota_lojas_estado_check, validado, aceita so ativa, adormecida e encerrada', 'sim', CASE WHEN COALESCE(
    (SELECT k.contype = 'c' AND k.convalidated
            AND pg_get_constraintdef(k.oid) = 'CHECK ((estado = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])))'
       FROM pg_constraint k WHERE k.conrelid = to_regclass('public.frota_lojas') AND k.conname = 'frota_lojas_estado_check'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas e frota_segredo continuam fechadas (RLS ligada, nenhuma politica, nada para anon, authenticated e PUBLIC)', 'sim', CASE WHEN
    (SELECT count(*) FROM tb) = 2
    AND COALESCE((SELECT bool_and(t.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid)
        AND NOT has_table_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0))
       FROM tb t), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

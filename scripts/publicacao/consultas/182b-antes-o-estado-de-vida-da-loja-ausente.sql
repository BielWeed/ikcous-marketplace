-- 182b-antes-o-estado-de-vida-da-loja-ausente: ANTES da 20261460000000 (ou depois do rollback-manual-destrutivo dela). SO LEITURA, somente
-- catalogo, rol fechado de 6 linhas. Nao le nenhuma linha. O rollback-manual COMUM mantem as colunas e o CHECK (o estado de cada loja e'
-- preservado): depois dele a linha das colunas fica "nao" de proposito e so o destrutivo as tira. As linhas 4, 5 e 6 sao o que o pre-voo da
-- migration exige do banco (a resolver_loja da 20261141 intacta, a caderneta com a forma dela e o pgcrypto): se uma vier "nao", o apply
-- recusaria com B1_BASELINE_DIVERGENT e nada seria escrito, entao o banco nao esta na base de antes.
WITH v1 AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proretset, p.proisstrict, p.proconfig,
         p.proowner, pg_get_function_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS resultado, p.proacl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_loja'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_loja_com_estado: ainda NAO existe', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'resolver_loja_com_estado') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas: as colunas estado, estado_desde e estado_sha e o CHECK frota_lojas_estado_check ainda NAO existem', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.frota_lojas') AND a.attnum > 0 AND NOT a.attisdropped
                   AND a.attname IN ('estado', 'estado_desde', 'estado_sha'))
    AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.frota_lojas') AND k.conname = 'frota_lojas_estado_check') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_loja: uma so, com o corpo da 20261141000000 (md5), os atributos de sempre e EXECUTE so do anon', 'sim', CASE WHEN
    (SELECT count(*) FROM v1) = 1
    AND COALESCE((SELECT f.h = 'fcb01b1e25e00481d8085d53dec291e5' AND f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND f.proretset
        AND NOT f.proisstrict AND f.proconfig = ARRAY['search_path=""']::text[] AND f.args = 'p_host text, p_chave text'
        AND f.resultado = 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text)'
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        AND has_function_privilege('anon', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
       FROM v1 f), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas e frota_segredo existem com a forma da 20261141000000 (as 6 colunas de texto e ativa boolean NOT NULL) e o mesmo dono da resolver_loja', 'sim', CASE WHEN
    to_regclass('public.frota_lojas') IS NOT NULL AND to_regclass('public.frota_segredo') IS NOT NULL
    AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.frota_lojas') AND a.attnum > 0 AND NOT a.attisdropped
           AND ((a.attname IN ('id', 'nome', 'dominio_publico', 'project_ref', 'supabase_url', 'publishable_key') AND a.atttypid = 'text'::regtype)
             OR (a.attname = 'ativa' AND a.atttypid = 'boolean'::regtype AND a.attnotnull))) = 7
    AND (SELECT count(DISTINCT c.relowner) FROM pg_class c WHERE c.oid IN (to_regclass('public.frota_lojas'), to_regclass('public.frota_segredo'))) = 1
    AND (SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.frota_lojas')) = (SELECT f.proowner FROM v1 f) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'extensions.crypt(text, text) existe (pgcrypto, a porta da chave da frota)', 'sim', CASE WHEN EXISTS (
    -- pelo catalogo (e nao por to_regprocedure): quem roda esta consulta pode nao ter USAGE no schema extensions.
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'extensions' AND p.proname = 'crypt' AND pg_get_function_identity_arguments(p.oid) = 'text, text') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

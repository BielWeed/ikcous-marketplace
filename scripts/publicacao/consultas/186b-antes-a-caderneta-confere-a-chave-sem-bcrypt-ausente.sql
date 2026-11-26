-- 186b-antes-a-caderneta-confere-a-chave-sem-bcrypt-ausente: ANTES da 20261490000000 (ou depois do rollback-manual-destrutivo dela). SO
-- LEITURA, somente catalogo, rol fechado de 5 linhas. Nao le nenhuma linha. O rollback-manual COMUM mantem as colunas do atalho: depois
-- dele a linha das colunas fica "nao" de proposito e so o destrutivo as tira. As linhas 3, 4 e 5 sao o que o pre-voo da migration exige
-- do banco (as duas portas com os corpos da 20261460 e o mesmo dono das tabelas, a 20261470 e a 20261480 aplicadas, o pgcrypto): se uma
-- vier "nao", o apply recusaria com B1_BASELINE_DIVERGENT e nada seria escrito, entao o banco nao esta na base de antes.
WITH fn AS (
  SELECT p.proname, p.proowner, p.prosecdef, md5(replace(p.prosrc, chr(13), '')) AS h
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado')
    AND pg_get_function_identity_arguments(p.oid) = 'p_host text, p_chave text'
), tb AS (
  SELECT c.oid, c.relname, c.relowner
  FROM pg_class c WHERE c.oid IN (to_regclass('public.frota_lojas'), to_regclass('public.frota_segredo'))
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_segredo: as colunas hash_rapido e hash_rapido_de ainda NAO existem', 'sim', CASE WHEN
    to_regclass('public.frota_segredo') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.frota_segredo') AND a.attnum > 0 AND NOT a.attisdropped
                      AND a.attname IN ('hash_rapido', 'hash_rapido_de')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a 20261460000000 esta aplicada: resolver_loja e resolver_loja_com_estado, uma so cada, com os corpos dela (md5), SECURITY DEFINER e o mesmo dono de frota_lojas e frota_segredo', 'sim', CASE WHEN
    (SELECT count(*) FROM fn) = 2 AND (SELECT count(*) FROM tb) = 2
    AND (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado')) = 2
    AND (SELECT h FROM fn WHERE proname = 'resolver_loja') = '19072d99f3253583342a0bb6c42447dd'
    AND (SELECT h FROM fn WHERE proname = 'resolver_loja_com_estado') = '92682af1143806d3662411b6d5788096'
    AND (SELECT bool_and(prosecdef) FROM fn)
    AND (SELECT count(DISTINCT d) FROM (SELECT relowner AS d FROM tb UNION ALL SELECT proowner FROM fn) x) = 1 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a 20261470000000 e a 20261480000000 estao aplicadas: a porta frota_mudar_estado existe e o service_role nao alcanca frota_lojas nem frota_segredo', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'frota_mudar_estado'
              AND pg_get_function_identity_arguments(p.oid) = 'p_id text, p_ref text, p_de text, p_para text, p_sha text, p_base text, p_motivo text, p_confirmacao text, p_valido_ate timestamp with time zone')
    AND (SELECT count(*) FROM tb) = 2
    AND NOT EXISTS (SELECT 1 FROM tb t
                     WHERE has_table_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                        OR has_any_column_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'extensions.crypt(text, text) e extensions.digest(text, text) existem (pgcrypto no schema extensions)', 'sim', CASE WHEN
    -- pelo catalogo (e nao por to_regprocedure): quem roda esta consulta pode nao ter USAGE no schema extensions.
    (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'extensions' AND p.proname IN ('crypt', 'digest') AND pg_get_function_identity_arguments(p.oid) = 'text, text') = 2 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

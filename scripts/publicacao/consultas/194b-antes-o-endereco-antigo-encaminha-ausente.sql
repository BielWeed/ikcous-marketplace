-- 194b-antes-o-endereco-antigo-encaminha-ausente: ANTES da 20261570000000 (ou depois do rollback-manual-destrutivo dela). SO LEITURA,
-- somente catalogo, rol fechado de 5 linhas. Nao le nenhuma linha. O rollback-manual COMUM tira so as portas e mantem a tabela: depois dele
-- a linha da tabela fica "nao" de proposito e so o destrutivo a tira. As linhas 4 e 5 sao o que o pre-voo da migration exige do banco (a
-- 20261490 aplicada; a chave e o CHECK de formato de frota_lojas da 20261141): se uma vier "nao", o apply recusaria com
-- B1_BASELINE_DIVERGENT e nada seria escrito, entao o banco nao esta na base de antes.
WITH fn AS (
  SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS h
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado')
    AND pg_get_function_identity_arguments(p.oid) = 'p_host text, p_chave text'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_enderecos_que_encaminham e a funcao do gatilho dela ainda NAO existem', 'sim', CASE WHEN
    to_regclass('public.frota_enderecos_que_encaminham') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'frota_enderecos_que_encaminham_nao_e_principal')
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_encaminhamento e frota_trocar_dominio ainda NAO existem', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_encaminhamento', 'frota_trocar_dominio'))
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a 20261490000000 esta aplicada: frota_segredo com hash_rapido e hash_rapido_de, resolver_loja e resolver_loja_com_estado uma so cada com os corpos dela (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.frota_segredo') AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname IN ('hash_rapido', 'hash_rapido_de')) = 2
    AND (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado')) = 2
    AND (SELECT h FROM fn WHERE proname = 'resolver_loja') = '0c60eb13c0016d2129b51def3ec7c255'
    AND (SELECT h FROM fn WHERE proname = 'resolver_loja_com_estado') = 'a30e752cff5ae4edc2db612866eb8bcd' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas: a chave em id (text) e o CHECK de formato do dominio_publico da 20261141000000 (a base do pre-voo)', 'sim', CASE WHEN
    (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conrelid = to_regclass('public.frota_lojas') AND k.conname = 'frota_lojas_pkey')
      = 'PRIMARY KEY (id)'
    AND (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = to_regclass('public.frota_lojas') AND a.attname = 'id' AND NOT a.attisdropped) = 'text'
    AND (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k
          WHERE k.conrelid = to_regclass('public.frota_lojas') AND k.conname = 'frota_lojas_dominio_publico_check')
      = 'CHECK ((dominio_publico ~ ''^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$''::text))' THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

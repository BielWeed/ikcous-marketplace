-- 183b-antes-a-loja-muda-de-estado-so-pela-porta-ausente: ANTES da 20261470000000 (ou depois do rollback-manual-destrutivo dela). SO LEITURA,
-- somente catalogo, rol fechado de 5 linhas. Nao le nenhuma linha. O rollback-manual COMUM mantem a tabela do historico (com as linhas):
-- depois dele a linha da tabela fica "nao" de proposito e so o destrutivo a tira. A linha 5 e' o que o pre-voo da migration exige do banco
-- (a 20261460000000 aplicada): se vier "nao", o apply recusaria com B1_BASELINE_DIVERGENT e nada seria escrito, entao o banco nao esta na
-- base de antes. (O pre-voo tambem recusa a IKCOUS ou a Savy fora de ativa; isso e' linha da caderneta, e esta consulta nao le linha.)
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_mudar_estado: ainda NAO existe', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'frota_mudar_estado') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas_estado_so_pela_porta: ainda NAO existe (nem a funcao nem o gatilho em frota_lojas)', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'frota_lojas_estado_so_pela_porta')
    AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.frota_lojas') AND t.tgname = 'frota_lojas_estado_so_pela_porta') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_estado_historico: a tabela ainda NAO existe', 'sim', CASE WHEN
    to_regclass('public.frota_estado_historico') IS NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a 20261460000000 esta aplicada: as colunas estado, estado_desde e estado_sha e o CHECK dos tres estados em frota_lojas, e a resolver_loja e a resolver_loja_com_estado com os corpos dela (md5)', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attname)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.frota_lojas') AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('estado', 'estado_desde', 'estado_sha', 'project_ref'))
      = 'estado:text:true:''ativa''::text,estado_desde:timestamp with time zone:true:now(),estado_sha:text:false:-,project_ref:text:true:-'
    AND COALESCE((SELECT pg_get_constraintdef(k.oid) = 'CHECK ((estado = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])))'
       FROM pg_constraint k WHERE k.conrelid = to_regclass('public.frota_lojas') AND k.conname = 'frota_lojas_estado_check'), false)
    AND (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_loja'
          AND pg_get_function_identity_arguments(p.oid) = 'p_host text, p_chave text') = '19072d99f3253583342a0bb6c42447dd'
    AND (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_loja_com_estado'
          AND pg_get_function_identity_arguments(p.oid) = 'p_host text, p_chave text') = '92682af1143806d3662411b6d5788096' THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

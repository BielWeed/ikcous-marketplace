-- 203b-antes-as-listas-dos-ajustes-nao-somem-entre-aparelhos-base-vigente: ANTES da 20261643000000; prova que a loja esta na
-- base que o pre-voo dela aceita: upsert_store_config com o corpo da 20261310000000 (ou o desta, reaplicacao),
-- salvar_politica_de_devolucao com o da 20261199000000 (ou o desta), as colunas das cinco listas com o tipo esperado e as
-- guardas de admin existentes. Positiva antes e depois do apply; depois do rollback-manual tambem.
-- SO LEITURA: apenas catalogo, rol fechado de 4 linhas; nenhum dado de loja ou de cliente e lido, nenhuma funcao e chamada.
WITH fn AS (
  SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS m
    FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.upsert_store_config(jsonb)'), to_regprocedure('public.salvar_politica_de_devolucao(jsonb)'))
), colunas AS (
  SELECT count(*) AS n FROM pg_attribute a
   WHERE a.attnum > 0 AND NOT a.attisdropped
     AND ((a.attrelid = to_regclass('public.store_config') AND a.attname = 'formas_pagamento_entrega' AND a.atttypid = 'text[]'::regtype)
       OR (a.attrelid = to_regclass('public.store_config') AND a.attname = 'home_sections' AND a.atttypid = 'jsonb'::regtype)
       OR (a.attrelid = to_regclass('public.politica_devolucao')
           AND a.attname IN ('metodos_locais', 'metodos_nacionais', 'categorias_sem_troca') AND a.atttypid = 'text[]'::regtype))
), itens(item, esperado, vivo) AS (
  SELECT 'upsert_store_config: corpo da 20261310000000 ou desta (md5)', 'aa4ed730ac6ad3d3c2644b4285ff39a9',
         COALESCE((SELECT CASE WHEN m = '2f772ffd1370359ba6c64540b71c35b2' THEN 'aa4ed730ac6ad3d3c2644b4285ff39a9' ELSE m END
                     FROM fn WHERE proname = 'upsert_store_config'), 'AUSENTE')
  UNION ALL
  SELECT 'salvar_politica_de_devolucao: corpo da 20261199000000 ou desta (md5)', '043f816330a66b290fd04d272a4ee934',
         COALESCE((SELECT CASE WHEN m = '976f05a67ca929ace608a62391588bcd' THEN '043f816330a66b290fd04d272a4ee934' ELSE m END
                     FROM fn WHERE proname = 'salvar_politica_de_devolucao'), 'AUSENTE')
  UNION ALL
  SELECT 'as cinco listas: formas_pagamento_entrega (text[]) e home_sections (jsonb) em store_config; metodos_locais, metodos_nacionais e categorias_sem_troca (text[]) em politica_devolucao', '5',
         (SELECT n::text FROM colunas)
  UNION ALL
  SELECT 'is_admin() e is_admin_atual() existem', 'sim',
         CASE WHEN to_regprocedure('public.is_admin()') IS NOT NULL AND to_regprocedure('public.is_admin_atual()') IS NOT NULL
              THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

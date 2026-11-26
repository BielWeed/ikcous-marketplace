-- 191b-antes-a-loja-nova-nasce-com-a-ficha-ausente: ANTES da 20261540000000 (ou depois do rollback-manual dela). SO LEITURA, rol fechado de 5 linhas.
-- As linhas 2 a 4 sao a base que o pre-voo da migration exige: a tabela com a chave em (id), nenhuma coluna NOT NULL alem de id sem default (o
-- INSERT so com id nao falha) e o comentario da tabela NULL (a marca desta migration ainda NAO existe, nem outro comentario que o pre-voo
-- recusaria). Se vier "nao" em alguma delas ANTES do apply, o pre-voo recusa (B1_BASELINE_DIVERGENT, nada escrito) — meca antes.
-- A ultima linha e' INFORMATIVA (molde da 111a): diz se a ficha (linha id = 1) JA existe (IKCOUS e Savy: sim; loja recem-instalada antes desta
-- migration: nao) e repete o valor nas duas colunas (nunca reprova). Le de store_config so a existencia da linha id = 1.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'store_config: a tabela existe com chave primaria ou unica exatamente em (id) (o alvo do ON CONFLICT)', 'sim', CASE WHEN
    to_regclass('public.store_config') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_constraint k
                 WHERE k.conrelid = to_regclass('public.store_config') AND k.contype IN ('p', 'u')
                   AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                                          WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'id' AND NOT a.attisdropped)]::smallint[])
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'store_config: toda coluna NOT NULL alem de id tem default (o INSERT so com id nao falha)', 'sim', CASE WHEN
    to_regclass('public.store_config') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = to_regclass('public.store_config') AND a.attnum > 0 AND NOT a.attisdropped
                       AND a.attnotnull AND NOT a.atthasdef AND a.attidentity = '' AND a.attgenerated = '' AND a.attname <> 'id')
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'store_config: o comentario da tabela ainda e NULL (a marca desta migration ainda NAO existe, nem outro comentario)', 'sim', CASE WHEN
    to_regclass('public.store_config') IS NOT NULL
    AND obj_description(to_regclass('public.store_config'), 'pg_class') IS NULL THEN 'sim' ELSE 'nao' END
  UNION ALL
  -- INFORMATIVO: a ficha ja existe? So a existencia (nenhuma coluna e' lida). esperado = vivo, nunca reprova.
  SELECT 'informativo: a ficha (linha id = 1 de store_config) ja existe antes do apply',
         (CASE WHEN to_regclass('public.store_config') IS NOT NULL AND EXISTS (SELECT 1 FROM public.store_config WHERE id = 1) THEN 'sim' ELSE 'nao' END),
         (CASE WHEN to_regclass('public.store_config') IS NOT NULL AND EXISTS (SELECT 1 FROM public.store_config WHERE id = 1) THEN 'sim' ELSE 'nao' END)
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

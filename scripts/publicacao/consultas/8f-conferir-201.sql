-- 8f — Confere a 20261201000000 (LINHA NOVA NASCE SOB AUTORIZAÇÃO): o DEFAULT de
-- `order_refunds.criada_sob_autorizacao` é `true`. Só catálogo, um único SELECT,
-- nenhuma linha de dado.
--
-- Saída: item | esperado | vivo | ok (ok = false primeiro).
--   * ANTES da 201 (com a 96 aplicada): coluna boolean e SEM default
--     (`vivo` = 'sem default') — a edge antiga ainda no ar não pode marcar linha
--     nova como "sob autorização" (defeito D1, cabeçalho da 201).
--   * DEPOIS da 201: o default é `true`. Esta consulta espera o estado DEPOIS;
--     para conferir o ANTES, a linha `default` aparece com ok = false e
--     `vivo` = 'sem default' — é a leitura certa do estado anterior.
-- A 201 não toca linha existente (sem backfill): as linhas legadas continuam
-- NULL, e `linhas com NULL` só informa isso (esperado = vivo).
WITH col AS (
  SELECT format_type(a.atttypid, a.atttypmod) AS tipo,
         COALESCE(pg_get_expr(d.adbin, d.adrelid), 'sem default') AS def
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = to_regclass('public.order_refunds')
     AND a.attname = 'criada_sob_autorizacao'
     AND a.attnum > 0
     AND NOT a.attisdropped
), r(item, esperado, vivo) AS (
  SELECT 'order_refunds.criada_sob_autorizacao: tipo', 'boolean',
         COALESCE((SELECT tipo FROM col), 'AUSENTE')
  UNION ALL
  SELECT 'order_refunds.criada_sob_autorizacao: DEFAULT', 'true',
         COALESCE((SELECT def FROM col), 'AUSENTE')
  UNION ALL
  -- por to_jsonb: a consulta tem de PARSEAR também antes da 96, quando a coluna
  -- ainda não existe (referência direta à coluna daria erro de parse).
  SELECT 'informativo: linhas legadas com criada_sob_autorizacao NULL',
         (SELECT count(*) FROM public.order_refunds t
           WHERE jsonb_exists(to_jsonb(t), 'criada_sob_autorizacao')
             AND to_jsonb(t) -> 'criada_sob_autorizacao' = 'null'::jsonb)::text,
         (SELECT count(*) FROM public.order_refunds t
           WHERE jsonb_exists(to_jsonb(t), 'criada_sob_autorizacao')
             AND to_jsonb(t) -> 'criada_sob_autorizacao' = 'null'::jsonb)::text
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM r
 ORDER BY ok, item;

-- DEPOIS da 20261411000000. So catalogo: nao le dados de cupons.
WITH estado AS (
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = idx.relam
    JOIN pg_catalog.pg_attribute col ON col.attrelid = i.indrelid
      AND col.attname = 'code' AND col.attnum > 0 AND NOT col.attisdropped
    JOIN pg_catalog.pg_opclass op ON op.oid = i.indclass[0]
    WHERE i.indexrelid = to_regclass('public.coupons_code_upper_uidx')
      AND i.indrelid = to_regclass('public.coupons')
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      AND i.indnatts = 1 AND i.indnkeyatts = 1 AND i.indpred IS NULL
      AND pg_get_expr(i.indexprs, i.indrelid) = 'upper(code)'
      AND am.amname = 'btree' AND i.indcollation[0] = col.attcollation
      AND op.opcnamespace = 'pg_catalog'::regnamespace AND op.opcname = 'text_ops'
  ) AS valido
), itens(item, esperado, vivo, ok) AS (
  SELECT 'cupom: indice unico de codigo em maiusculas valido', 'sim',
         CASE WHEN valido THEN 'sim' ELSE 'nao' END, valido FROM estado
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;

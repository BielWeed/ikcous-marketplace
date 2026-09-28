-- Troca o endereço do projeto antigo (cafkrminfnokvgjqtkle) pelo do projeto
-- novo (dekxabvqdsuukijblazl) em toda coluna de texto/json do schema public,
-- numa transação só: se qualquer UPDATE falhar, nada muda.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  r record;
  n bigint;
  total bigint := 0;
  antigo constant text := 'cafkrminfnokvgjqtkle';
  novo constant text := 'dekxabvqdsuukijblazl';
  expr text;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND c.is_generated = 'NEVER'
       AND (c.data_type IN ('text', 'character varying', 'jsonb', 'json')
            OR c.udt_name IN ('_text', '_varchar'))
     ORDER BY 1, 2, 3
  LOOP
    expr := CASE
      WHEN r.data_type IN ('text', 'character varying')
        THEN format('replace(%I, %L, %L)', r.column_name, antigo, novo)
      WHEN r.data_type = 'jsonb'
        THEN format('replace(%I::text, %L, %L)::jsonb', r.column_name, antigo, novo)
      WHEN r.data_type = 'json'
        THEN format('replace(%I::text, %L, %L)::json', r.column_name, antigo, novo)
      WHEN r.udt_name = '_text'
        THEN format('replace(%I::text, %L, %L)::text[]', r.column_name, antigo, novo)
      ELSE format('replace(%I::text, %L, %L)::varchar[]', r.column_name, antigo, novo)
    END;
    EXECUTE format('UPDATE %I.%I SET %I = %s WHERE %I::text LIKE %L',
                   r.table_schema, r.table_name, r.column_name, expr,
                   r.column_name, '%' || antigo || '%');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE '%.%.% -> % linha(s) trocada(s)', r.table_schema, r.table_name, r.column_name, n;
      total := total + n;
    END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL: % linha(s) trocada(s)', total;
END $$;
COMMIT;

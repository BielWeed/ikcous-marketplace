-- Só CONTA onde o endereço do projeto antigo (cafkrminfnokvgjqtkle) aparece
-- gravado no banco. Não muda nada. Não mostra dado nenhum, só tabela.coluna
-- e quantidade de linhas.
DO $$
DECLARE
  r record;
  n bigint;
  total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, c.column_name
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
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I::text LIKE %L',
                   r.table_schema, r.table_name, r.column_name,
                   '%cafkrminfnokvgjqtkle%')
       INTO n;
    IF n > 0 THEN
      RAISE NOTICE '%.%.% -> % linha(s)', r.table_schema, r.table_name, r.column_name, n;
      total := total + n;
    END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL: % linha(s) com o endereço antigo', total;
END $$;

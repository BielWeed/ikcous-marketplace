-- Parte (e.1) do runbook docs/runbooks/migrar-banco-da-loja.md — SÓ CONTA,
-- nenhuma linha muda. Varre toda coluna text/character varying/jsonb/text[]
-- de toda tabela BASE do schema `public` (via information_schema, não uma
-- lista escrita à mão — não deixa faltar tabela nova) procurando o ref do
-- projeto antigo, e devolve uma linha por tabela.coluna onde achou alguma
-- ocorrência.
--
-- Rode ANTES de scripts/migracao/trocar-endereco-antigo.sql, para saber o
-- tamanho do que vai mudar.

\set ON_ERROR_STOP on

DROP TABLE IF EXISTS relatorio_endereco_antigo;
CREATE TEMP TABLE relatorio_endereco_antigo (
  tabela text,
  coluna text,
  ocorrencias bigint
);

DO $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.is_generated = 'NEVER'
       AND (
             c.data_type IN ('text', 'character varying', 'jsonb')
          OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar'))
       )
     ORDER BY c.table_name, c.column_name
  LOOP
    IF r.data_type = 'ARRAY' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE EXISTS (SELECT 1 FROM unnest(%I) AS v WHERE v ILIKE %L)',
        r.table_name, r.column_name, '%cafkrminfnokvgjqtkle%'
      ) INTO n;
    ELSIF r.data_type = 'jsonb' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE %I::text ILIKE %L',
        r.table_name, r.column_name, '%cafkrminfnokvgjqtkle%'
      ) INTO n;
    ELSE
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE %I ILIKE %L',
        r.table_name, r.column_name, '%cafkrminfnokvgjqtkle%'
      ) INTO n;
    END IF;

    IF n > 0 THEN
      INSERT INTO relatorio_endereco_antigo VALUES (r.table_name, r.column_name, n);
    END IF;
  END LOOP;
END $$;

\echo '=== tabela.coluna com ocorrência do ref antigo (cafkrminfnokvgjqtkle) ==='
SELECT * FROM relatorio_endereco_antigo ORDER BY ocorrencias DESC, tabela, coluna;

\echo '=== total de linhas (some tabela.coluna, não é "linhas distintas") ==='
SELECT coalesce(sum(ocorrencias), 0) AS total_de_ocorrencias
  FROM relatorio_endereco_antigo;

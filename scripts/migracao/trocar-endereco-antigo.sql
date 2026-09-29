-- Parte (e.2) do runbook docs/runbooks/migrar-banco-da-loja.md — troca
-- cafkrminfnokvgjqtkle (projeto pausado) por dekxabvqdsuukijblazl (projeto
-- novo) em toda coluna text/character varying/jsonb/text[] de toda tabela
-- BASE do schema `public` que contiver o ref antigo.
--
-- NÃO é uma migration (não mora em supabase/migrations/) — por isso leva
-- BEGIN/COMMIT DE PROPÓSITO: é um ajuste de dado, de uma vez, fora do
-- pipeline de schema/ledger. Roda inteiro numa transação: conta antes,
-- troca, conta depois — se sobrar QUALQUER ocorrência, aborta com
-- RAISE EXCEPTION (o COMMIT no fim, sobre uma transação já abortada, sai
-- como ROLLBACK — comportamento documentado do Postgres, não bug deste
-- script).
--
-- Rode scripts/migracao/contar-endereco-antigo.sql ANTES, para saber o que
-- esperar.

\set ON_ERROR_STOP on

BEGIN;

-- Função local (schema temporário da sessão): mesma varredura do script de
-- contagem, encapsulada para não duplicar o texto do loop nas duas medições
-- (antes/depois) deste arquivo.
CREATE OR REPLACE FUNCTION pg_temp.contar_endereco_antigo(agulha text)
RETURNS bigint
LANGUAGE plpgsql
AS $fn$
DECLARE
  r record;
  n bigint;
  total bigint := 0;
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
  LOOP
    IF r.data_type = 'ARRAY' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE EXISTS (SELECT 1 FROM unnest(%I) AS v WHERE v ILIKE %L)',
        r.table_name, r.column_name, '%' || agulha || '%'
      ) INTO n;
    ELSIF r.data_type = 'jsonb' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE %I::text ILIKE %L',
        r.table_name, r.column_name, '%' || agulha || '%'
      ) INTO n;
    ELSE
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE %I ILIKE %L',
        r.table_name, r.column_name, '%' || agulha || '%'
      ) INTO n;
    END IF;
    total := total + n;
  END LOOP;
  RETURN total;
END;
$fn$;

DO $$
DECLARE
  r record;
  antes bigint;
  depois bigint;
BEGIN
  antes := pg_temp.contar_endereco_antigo('cafkrminfnokvgjqtkle');
  RAISE NOTICE 'antes: % ocorrência(s) de cafkrminfnokvgjqtkle', antes;

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
      -- Troca elemento a elemento (não a array inteira como texto): sem
      -- isto, cada elemento precisaria ser reformatado do zero na hora de
      -- voltar para text[], e um elemento com vírgula/aspas dentro (uma URL
      -- com query string, por exemplo) sairia corrompido.
      EXECUTE format(
        'UPDATE public.%I SET %I = (SELECT array_agg(replace(elem, %L, %L)) FROM unnest(%I) AS elem) WHERE EXISTS (SELECT 1 FROM unnest(%I) AS v WHERE v ILIKE %L)',
        r.table_name, r.column_name,
        'cafkrminfnokvgjqtkle', 'dekxabvqdsuukijblazl',
        r.column_name, r.column_name, '%cafkrminfnokvgjqtkle%'
      );
    ELSIF r.data_type = 'jsonb' THEN
      -- Vai e volta por texto: replace() na representação textual do jsonb,
      -- reparseada como jsonb no fim. O ref antigo (20 letras minúsculas
      -- aleatórias) nunca colide com um nome de chave de verdade, então
      -- trocar a substring não corrompe a estrutura.
      EXECUTE format(
        'UPDATE public.%I SET %I = replace(%I::text, %L, %L)::jsonb WHERE %I::text ILIKE %L',
        r.table_name, r.column_name, r.column_name,
        'cafkrminfnokvgjqtkle', 'dekxabvqdsuukijblazl',
        r.column_name, '%cafkrminfnokvgjqtkle%'
      );
    ELSE
      EXECUTE format(
        'UPDATE public.%I SET %I = replace(%I, %L, %L) WHERE %I ILIKE %L',
        r.table_name, r.column_name, r.column_name,
        'cafkrminfnokvgjqtkle', 'dekxabvqdsuukijblazl',
        r.column_name, '%cafkrminfnokvgjqtkle%'
      );
    END IF;
  END LOOP;

  depois := pg_temp.contar_endereco_antigo('cafkrminfnokvgjqtkle');
  RAISE NOTICE 'depois: % ocorrência(s) restante(s)', depois;

  IF depois <> 0 THEN
    RAISE EXCEPTION
      'trocar-endereco-antigo: sobrou % ocorrência(s) depois da troca — abortando (o COMMIT abaixo vira ROLLBACK)',
      depois;
  END IF;

  RAISE NOTICE 'trocado: % -> % ocorrências restantes', antes, depois;
END $$;

COMMIT;

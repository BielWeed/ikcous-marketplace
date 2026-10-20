-- 19a — DEPOIS de aplicar a migration 20261215000000 (a politica de devolucao nao mostra quem a
-- editou, achado L): confirma, POR OBJETO, que `anon` e `authenticated` leem 15 das 16 colunas de
-- `public.politica_devolucao` (todas, menos `updated_by`, o uuid do admin que salvou por ultimo),
-- que nenhum dos dois tem SELECT da tabela inteira, que a RLS segue ligada com a politica publica
-- de SELECT e que `service_role` (as edges) mantem a leitura. E' a consulta do lote em
-- `provasDeObjetos` de scripts/frota/canais-de-backend.json; a de ausencia e' a 19b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_class, pg_attribute, pg_policies, funcoes
-- has_*_privilege): a linha da tabela (inclusive `updated_by`) NAO e' lida nem devolvida.
--
-- POR OBJETO, nunca por `schema_migrations`: o registro do ledger nao prova o que esta no banco.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 9
-- linhas, as mesmas em qualquer estado do banco (tabela ausente vira `AUSENTE` na propria linha,
-- papel inexistente vira `papel ausente`, nunca some uma linha). Tudo `true` = a migration esta
-- aplicada e o vazamento fechou; qualquer `false` = PARE e leia a linha.
--
-- LIMITES: nao prova o comportamento do PostgREST (isso e' a prova viva da migration). Nao le dado
-- nenhum. Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de
-- cada loja. tests/banco/politica-devolucao-portao-viva.cjs roda esta consulta num Postgres real.
WITH tab AS (
  SELECT to_regclass('public.politica_devolucao') IS NOT NULL AS existe
), cols AS (
  SELECT a.attrelid, a.attnum
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.politica_devolucao')
     AND a.attnum > 0 AND NOT a.attisdropped
), itens(item, esperado, vivo) AS (
  SELECT 'controle: colunas de politica_devolucao visiveis a este papel', '16',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              ELSE (SELECT count(*)::text FROM cols) END
  UNION ALL
  SELECT 'politica_devolucao: RLS ligada com a politica publica de SELECT', 'sim',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.politica_devolucao'))
                   AND EXISTS (SELECT 1 FROM pg_policies p
                                WHERE p.schemaname = 'public' AND p.tablename = 'politica_devolucao'
                                  AND p.policyname = 'politica_devolucao_publica_select_policy'
                                  AND p.cmd = 'SELECT' AND p.qual = 'true')
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'service_role: SELECT da tabela inteira', 'sim',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
              WHEN has_table_privilege('service_role', 'public.politica_devolucao', 'SELECT') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'anon: SELECT da tabela inteira', 'nao',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
              WHEN has_table_privilege('anon', 'public.politica_devolucao', 'SELECT') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'anon: SELECT em updated_by', 'nao',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
              WHEN has_column_privilege('anon', 'public.politica_devolucao', 'updated_by', 'SELECT') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'anon: colunas legiveis', '15 de 16',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
              ELSE (SELECT count(*) FILTER (WHERE has_column_privilege('anon', c.attrelid, c.attnum, 'SELECT'))::text
                           || ' de ' || count(*)::text
                      FROM cols c) END
  UNION ALL
  SELECT 'authenticated: SELECT da tabela inteira', 'nao',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
              WHEN has_table_privilege('authenticated', 'public.politica_devolucao', 'SELECT') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'authenticated: SELECT em updated_by', 'nao',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
              WHEN has_column_privilege('authenticated', 'public.politica_devolucao', 'updated_by', 'SELECT') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'authenticated: colunas legiveis', '15 de 16',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
              ELSE (SELECT count(*) FILTER (WHERE has_column_privilege('authenticated', c.attrelid, c.attnum, 'SELECT'))::text
                           || ' de ' || count(*)::text
                      FROM cols c) END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

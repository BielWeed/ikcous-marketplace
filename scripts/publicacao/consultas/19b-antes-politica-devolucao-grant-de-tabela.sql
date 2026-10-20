-- 19b — ANTES de aplicar a migration 20261215000000 (a politica de devolucao nao mostra quem a
-- editou, achado L): confirma, POR OBJETO, que a loja esta na base de antes — `anon` e
-- `authenticated` com SELECT da tabela `public.politica_devolucao` INTEIRA (16 de 16 colunas,
-- `updated_by` incluido), RLS ligada com a politica publica de SELECT e `service_role` lendo. E' a
-- consulta de AUSENCIA do lote (`ausenciaConfirmadaPor` em scripts/frota/canais-de-backend.json):
-- so com a 19a NEGATIVA e esta POSITIVA (da mesma janela ou mais nova) o portao
-- (scripts/frota/publicar-release.mjs) imprime o apply do arquivo.
-- SO LEITURA, um unico SELECT, so catalogo: a linha da tabela NAO e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 9
-- linhas, as mesmas em qualquer estado do banco. Uma loja que ja tem a migration aplicada reprova
-- aqui de proposito (`updated_by` ja fechado, 15 de 16): esta consulta e' "antes". Uma loja onde a
-- tabela nao existe (a 20261175000000 nao foi aplicada) reprova em `AUSENTE`.
--
-- LIMITES: nao prova o comportamento. Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
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
  SELECT 'anon: SELECT da tabela inteira', 'sim',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
              WHEN has_table_privilege('anon', 'public.politica_devolucao', 'SELECT') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'anon: SELECT em updated_by', 'sim',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
              WHEN has_column_privilege('anon', 'public.politica_devolucao', 'updated_by', 'SELECT') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'anon: colunas legiveis', '16 de 16',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
              ELSE (SELECT count(*) FILTER (WHERE has_column_privilege('anon', c.attrelid, c.attnum, 'SELECT'))::text
                           || ' de ' || count(*)::text
                      FROM cols c) END
  UNION ALL
  SELECT 'authenticated: SELECT da tabela inteira', 'sim',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
              WHEN has_table_privilege('authenticated', 'public.politica_devolucao', 'SELECT') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'authenticated: SELECT em updated_by', 'sim',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
              WHEN has_column_privilege('authenticated', 'public.politica_devolucao', 'updated_by', 'SELECT') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'authenticated: colunas legiveis', '16 de 16',
         CASE WHEN NOT (SELECT existe FROM tab) THEN 'AUSENTE'
              WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
              ELSE (SELECT count(*) FILTER (WHERE has_column_privilege('authenticated', c.attrelid, c.attnum, 'SELECT'))::text
                           || ' de ' || count(*)::text
                      FROM cols c) END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

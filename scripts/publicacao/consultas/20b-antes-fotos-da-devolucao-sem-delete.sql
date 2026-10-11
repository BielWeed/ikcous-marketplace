-- 20b — ANTES de aplicar a migration 20261216000000 (o cliente apaga a foto de devolucao que nao
-- usou): confirma, POR OBJETO, que a loja esta na base de antes — NENHUMA politica
-- `devolucoes_cliente_delete_policy` —, que nenhuma outra politica de DELETE (ou ALL) em
-- `storage.objects` alcanca o bucket `devolucoes` (se alcancasse, o cliente ja apagaria foto sem a nossa
-- condicao) e que as politicas de INSERT e de SELECT do cliente existem (a 20261175000000 esta aplicada).
-- E' a consulta de AUSENCIA do lote (`ausenciaConfirmadaPor` em scripts/frota/canais-de-backend.json):
-- so com a 20a NEGATIVA e esta POSITIVA (da mesma janela ou mais nova) o portao
-- (scripts/frota/publicar-release.mjs) imprime o apply do arquivo.
-- SO LEITURA, um unico SELECT, so catalogo (pg_policies).
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas,
-- as mesmas em qualquer estado do banco. Uma loja que ja tem a nossa politica reprova aqui de
-- proposito. Uma loja sem as politicas de INSERT/SELECT (a 20261175000000 nao foi aplicada) reprova na
-- linha delas.
--
-- LIMITES: mede o texto, nao o comportamento; a lista de buckets aceitos nas outras politicas e' a da
-- 20a. Evidencia LOCAL nao prova a IKCOUS nem a Savy.
WITH pol AS (
  SELECT p.policyname, p.cmd, p.permissive AS permissiva, p.roles::text AS papeis, p.qual
    FROM pg_policies p
   WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
), del AS (
  SELECT * FROM pol WHERE policyname = 'devolucoes_cliente_delete_policy'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: politicas de storage.objects visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pol) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'devolucoes: politicas de DELETE do cliente', '0',
         (SELECT count(*)::text FROM del WHERE cmd = 'DELETE')
  UNION ALL
  SELECT 'devolucoes: DELETE so para authenticated', 'AUSENTE',
         CASE WHEN NOT EXISTS (SELECT 1 FROM del) THEN 'AUSENTE'
              WHEN (SELECT count(*) FROM del WHERE cmd = 'DELETE' AND permissiva = 'PERMISSIVE'
                                                AND papeis = '{authenticated}') = 1
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'devolucoes: DELETE so no bucket, na pasta do cliente e fora da foto em uso', 'AUSENTE',
         CASE WHEN NOT EXISTS (SELECT 1 FROM del) THEN 'AUSENTE'
              WHEN (SELECT bool_and(position('bucket_id = ''devolucoes''' IN qual) > 0
                                    AND position('split_part(name' IN qual) > 0
                                    AND position('auth.uid()' IN qual) > 0
                                    AND position('NOT (EXISTS' IN qual) > 0
                                    AND position('ANY (d.fotos)' IN qual) > 0)
                      FROM del)
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'devolucoes: nenhuma outra politica DELETE/ALL alcanca o bucket', 'sim',
         CASE WHEN NOT EXISTS (
                SELECT 1 FROM pol
                 WHERE cmd IN ('DELETE', 'ALL')
                   AND policyname <> 'devolucoes_cliente_delete_policy'
                   AND NOT (COALESCE(qual, '') ~ '^[(]+bucket_id = ''(banners|products|produtos|branding)''::text[)] AND '
                            AND COALESCE(qual, '') !~ '[)] OR '
                            AND position('devolucoes' IN COALESCE(qual, '')) = 0)
              ) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'devolucoes: INSERT e SELECT do cliente seguem no lugar', 'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pol WHERE policyname = 'devolucoes_cliente_insert_policy' AND cmd = 'INSERT')
               AND EXISTS (SELECT 1 FROM pol WHERE policyname = 'devolucoes_dono_ou_admin_select_policy' AND cmd = 'SELECT')
              THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

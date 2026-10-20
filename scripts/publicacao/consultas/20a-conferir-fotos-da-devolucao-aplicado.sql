-- 20a — DEPOIS de aplicar a migration 20261216000000 (o cliente apaga a foto de devolucao que nao
-- usou): confirma, POR OBJETO, (1) que existe a politica `devolucoes_cliente_delete_policy` em
-- `storage.objects` (DELETE, PERMISSIVE, so para `authenticated`) com as pecas que a fazem segura
-- (bucket `devolucoes`, pasta do proprio cliente, so o objeto que nenhuma devolucao referencia);
-- (2) que NENHUMA outra politica de DELETE (ou ALL) em `storage.objects` alcanca o bucket — politicas
-- permissivas se somam por OR, e uma mais larga anularia a condicao da nossa; e (3) que as politicas de
-- INSERT e de SELECT do cliente seguem no lugar. E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 20b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_policies): nenhum objeto do bucket e nenhuma linha
-- de devolucao e' lido nem devolvido.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas,
-- as mesmas em qualquer estado do banco (politica ausente vira `AUSENTE` na propria linha, nunca
-- some uma linha). Tudo `true` = a migration esta aplicada; qualquer `false` = PARE e leia a linha.
--
-- LIMITES: mede o TEXTO da condicao da politica, nao o comportamento — esse e' da prova viva da
-- migration e do teste da tela. A linha (2) aceita as OUTRAS politicas de DELETE/ALL so quando presas a
-- um bucket de uma lista fechada (banners, products, produtos, branding): uma politica de DELETE nova
-- para outro bucket reprova a linha de proposito (falha fechada) e quem a criou atualiza a lista aqui.
-- Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run da consulta contra o ref de cada loja.
-- tests/banco/fotos-da-devolucao-portao-viva.cjs roda esta consulta num Postgres real.
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
  SELECT 'devolucoes: politicas de DELETE do cliente', '1',
         (SELECT count(*)::text FROM del WHERE cmd = 'DELETE')
  UNION ALL
  SELECT 'devolucoes: DELETE so para authenticated', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM del) THEN 'AUSENTE'
              WHEN (SELECT count(*) FROM del WHERE cmd = 'DELETE' AND permissiva = 'PERMISSIVE'
                                                AND papeis = '{authenticated}') = 1
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'devolucoes: DELETE so no bucket, na pasta do cliente e fora da foto em uso', 'sim',
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

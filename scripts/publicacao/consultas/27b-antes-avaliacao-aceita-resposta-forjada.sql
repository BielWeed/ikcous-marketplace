-- 27b — ANTES de aplicar a migration 20261224000000 (a avaliacao nasce sem a resposta da loja): confirma, POR
-- OBJETO, a base de antes: a funcao do gatilho e o gatilho AINDA NAO existem (a avaliacao ainda aceita resposta, util e
-- data forjados) e as quatro pecas de que o apply depende ja estao de pe: as quatro colunas de `public.reviews` que o
-- gatilho reescreve (com os tipos de sempre), `public.rls_admin_atual()` (a porta de admin das politicas, 20261197) e o
-- gatilho irmao `tr_avaliacao_nasce_verificada` (o selo pela compra, AFTER INSERT, 20261030). E' a consulta de
-- AUSENCIA (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 27a
-- negativa so vira "aplique" se esta for positiva (a loja esta na base de antes, e o pre-voo do apply vai passar).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_trigger, pg_attribute, pg_type): nenhuma linha
-- de avaliacao e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` ou `nao` na propria linha). Tudo `true` = a loja esta na base
-- de antes; uma loja que JA tem a funcao ou o gatilho reprova aqui de proposito, nas duas primeiras linhas do objeto.
--
--   * funcao    -- 'AUSENTE' se nenhuma funcao `avaliacao_nasce_sem_a_resposta_da_loja` existe em public (qualquer
--                  assinatura: o pre-voo do apply tambem recusa a sobrecarga).
--   * gatilho   -- 'AUSENTE' se nenhum gatilho de nome `tr_avaliacao_nasce_sem_a_resposta_da_loja` existe (em qualquer tabela).
--   * colunas   -- as quatro colunas e seus tipos de sempre em public.reviews.
--   * rls_admin_atual -- 'sim' se `public.rls_admin_atual()` existe e devolve boolean (sem ela o pre-voo recusa).
--   * irmao     -- 'sim' se `tr_avaliacao_nasce_verificada` e' um gatilho AFTER INSERT por linha de public.reviews.
--
-- tests/banco/avaliacao-nasce-sem-resposta-da-loja-portao-viva.cjs roda esta consulta num Postgres real (positiva
-- depois do rollback, negativa depois do apply, um negativo por linha). LIMITE: evidencia LOCAL nao prova a IKCOUS nem
-- a Savy: so o run desta consulta contra o ref de cada loja.
WITH colunas AS (
  SELECT string_agg(a.attname || ':' || t.typname, ' ' ORDER BY a.attname) AS def
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
   WHERE a.attrelid = to_regclass('public.reviews') AND NOT a.attisdropped
     AND a.attname IN ('merchant_reply', 'merchant_reply_at', 'helpful', 'created_at')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'avaliacao_nasce_sem_a_resposta_da_loja: a funcao ainda NAO existe',
         'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = 'avaliacao_nasce_sem_a_resposta_da_loja')
              THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'tr_avaliacao_nasce_sem_a_resposta_da_loja: o gatilho ainda NAO existe',
         'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'tr_avaliacao_nasce_sem_a_resposta_da_loja')
              THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'reviews: as quatro colunas que o gatilho reescreve, com os tipos de sempre',
         'created_at:timestamptz helpful:int4 merchant_reply:text merchant_reply_at:timestamptz',
         COALESCE((SELECT c.def FROM colunas c), 'AUSENTE')
  UNION ALL
  SELECT 'rls_admin_atual(): existe e devolve boolean (20261197000000)',
         'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p
                            WHERE p.oid = to_regprocedure('public.rls_admin_atual()') AND p.prorettype = 'boolean'::regtype)
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tr_avaliacao_nasce_verificada: o gatilho irmao do selo (AFTER INSERT por linha em reviews) esta de pe',
         'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t
                            WHERE t.tgrelid = to_regclass('public.reviews') AND t.tgname = 'tr_avaliacao_nasce_verificada'
                              AND NOT t.tgisinternal AND t.tgtype = 5)
              THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

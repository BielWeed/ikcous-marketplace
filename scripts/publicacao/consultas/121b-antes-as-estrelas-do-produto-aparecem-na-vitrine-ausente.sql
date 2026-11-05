-- 121b — ANTES de aplicar a migration 20261399500000 (as estrelas do produto aparecem na vitrine): confirma, POR OBJETO, a base de antes: a
-- funcao do gatilho e o gatilho AINDA NAO existem (as notas de `produtos` nao acompanham as avaliacoes) e as pecas de que o apply depende ja estao de
-- pe: as tres colunas de `public.reviews` que o gatilho le (product_id, rating, status, com os tipos de sempre), as tres de `public.produtos` que
-- ele le e escreve (id, rating, review_count) e a restricao `reviews_status_check` citando 'publicada' (20261031000000). E' a consulta de AUSENCIA
-- (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 121a negativa so vira "aplique" se esta for
-- positiva (a loja esta na base de antes, e o pre-voo do apply vai passar).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_trigger, pg_attribute, pg_type, pg_constraint): nenhuma linha de avaliacao
-- nem de produto e' lida ou devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas em qualquer estado do banco
-- (objeto ausente vira `AUSENTE` ou `nao` na propria linha). Tudo `true` = a loja esta na base de antes; uma loja que JA tem a funcao ou o
-- gatilho reprova aqui de proposito, nas duas linhas do objeto.
--
--   * funcao    -- 'AUSENTE' se nenhuma funcao `avaliacao_atualiza_a_nota_do_produto` existe em public (qualquer assinatura: o pre-voo do apply
--                  tambem recusa a sobrecarga).
--   * gatilho   -- 'AUSENTE' se nenhum gatilho de nome `tr_avaliacao_atualiza_a_nota_do_produto` existe (em qualquer tabela).
--   * colunas   -- as tres colunas de reviews e as tres de produtos, com os tipos de sempre.
--   * restricao -- 'sim' se `reviews_status_check` e' um CHECK que cita 'publicada' (sem ele o pre-voo recusa).
--
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH reviews_cols AS (
  SELECT string_agg(a.attname || ':' || t.typname, ' ' ORDER BY a.attname) AS def
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
   WHERE a.attrelid = to_regclass('public.reviews') AND NOT a.attisdropped
     AND a.attname IN ('product_id', 'rating', 'status')
), produtos_cols AS (
  SELECT string_agg(a.attname || ':' || t.typname, ' ' ORDER BY a.attname) AS def
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
   WHERE a.attrelid = to_regclass('public.produtos') AND NOT a.attisdropped
     AND a.attname IN ('id', 'rating', 'review_count')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'avaliacao_atualiza_a_nota_do_produto: a funcao ainda NAO existe',
         'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = 'avaliacao_atualiza_a_nota_do_produto')
              THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'tr_avaliacao_atualiza_a_nota_do_produto: o gatilho ainda NAO existe',
         'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'tr_avaliacao_atualiza_a_nota_do_produto')
              THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'reviews: product_id, rating e status com os tipos de sempre',
         'product_id:uuid rating:int4 status:text',
         COALESCE((SELECT c.def FROM reviews_cols c), 'AUSENTE')
  UNION ALL
  SELECT 'produtos: id, rating e review_count com os tipos de sempre',
         'id:uuid rating:numeric review_count:int4',
         COALESCE((SELECT c.def FROM produtos_cols c), 'AUSENTE')
  UNION ALL
  SELECT 'reviews_status_check: o CHECK de status cita publicada (20261031000000)',
         'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c
                            WHERE c.conrelid = to_regclass('public.reviews') AND c.conname = 'reviews_status_check'
                              AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%publicada%')
              THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

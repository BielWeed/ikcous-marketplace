-- 45b — ANTES de aplicar a migration 20261242000000 (o lucro usa o custo do dia da venda): confirma, POR OBJETO, a
-- base de antes: a funcao do gatilho `marketplace_order_item__guarda_o_custo_do_dia` e o gatilho
-- `tr_marketplace_order_items_guarda_o_custo_do_dia` ainda NAO existem (a tabela lateral
-- `marketplace_order_item_custo` pode existir: o rollback-manual a DEIXA, com os registros, e reaplicar a aceita); as DUAS funcoes que a migration reescreve existem (uma assinatura so cada) com o corpo VIGENTE
-- (md5: get_admin_analytics_v2 da 20261234000000, fin_dre da 20261199000000) e com os atributos de sempre; e as
-- tabelas e colunas que os corpos novos leem existem. E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em
-- `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 45a negativa so vira "aplique" se esta for positiva
-- (a loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_class, pg_attribute, pg_trigger):
-- nenhuma linha de pedido, de item, de produto ou de custo e' lida nem devolvida.
--
-- NAO mede a ACL de proposito: o CREATE OR REPLACE a preserva (o pre-voo da migration recusa o apply com a ACL
-- aberta) e a 45a a mede DEPOIS.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base de
-- antes; uma loja que JA tem a migration reprova aqui de proposito, nas linhas dos objetos novos e dos corpos.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF).
--   * atributos  -- SECURITY DEFINER + `search_path=public` + a linguagem, a volatilidade e o retorno de cada uma, e
--                   UMA assinatura so por nome.
--   * colunas    -- as 12 colunas que os corpos novos leem (marketplace_order_items: id, order_id, product_id,
--                   quantity, price; produtos: id, custo, deleted_at; devolucao_itens: order_item_id, product_id,
--                   quantidade, reestocado_em), por pg_attribute.
--
-- tests/banco/custo-do-dia-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do rollback,
-- negativa depois do apply, um negativo por linha). Os md5 vem dos ARQUIVOS das migrations, nao de uma loja: o valor
-- VIVO de cada loja so esta consulta mede. LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
WITH alvo(chave, assinatura, nome, lingua, volatilidade, retorno) AS (
  VALUES ('analytics', 'public.get_admin_analytics_v2(integer)', 'get_admin_analytics_v2', 'plpgsql', 'v', 'json'),
         ('dre', 'public.fin_dre(date,date)', 'fin_dre', 'plpgsql', 's', 'jsonb')
), fn AS (
  SELECT t.chave, p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         COALESCE(p.prosecdef AND l.lanname = t.lingua AND p.provolatile = t.volatilidade AND NOT p.proretset
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = t.retorno
            AND (SELECT count(*) FROM pg_proc q
                  WHERE q.pronamespace = 'public'::regnamespace AND q.proname = t.nome) = 1, false) AS atributos_ok
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), novos AS (
  SELECT (NOT EXISTS (SELECT 1 FROM pg_proc p
                           WHERE p.pronamespace = 'public'::regnamespace
                             AND p.proname = 'marketplace_order_item__guarda_o_custo_do_dia')
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgname = 'tr_marketplace_order_items_guarda_o_custo_do_dia'
                             AND NOT t.tgisinternal)) AS ausentes
), lidas AS (
  SELECT count(*) AS n
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'public'::regnamespace
     AND a.attnum > 0 AND NOT a.attisdropped
     AND ((c.relname = 'marketplace_order_items' AND a.attname IN ('id', 'order_id', 'product_id', 'quantity', 'price'))
       OR (c.relname = 'produtos' AND a.attname IN ('id', 'custo', 'deleted_at'))
       OR (c.relname = 'devolucao_itens' AND a.attname IN ('order_item_id', 'product_id', 'quantidade', 'reestocado_em')))
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'a funcao do gatilho e o gatilho ainda NAO existem (a tabela lateral pode ficar de um rollback-manual)',
         'ausentes',
         CASE WHEN (SELECT n.ausentes FROM novos n) THEN 'ausentes' ELSE 'presentes' END
  UNION ALL
  SELECT 'get_admin_analytics_v2: corpo e o vigente da 20261234000000, sem o custo do dia (md5)',
         '05eac70f6bd4360c1f71fd373747ad0e',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'analytics'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_dre: corpo e o vigente da 20261199000000, sem o custo do dia (md5)',
         'e58ac49d3881a459b929064a3acb470a',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'dre'), 'AUSENTE')
  UNION ALL
  SELECT 'as duas funcoes: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, linguagem, volatilidade e retorno)',
         'atributos de sempre',
         CASE WHEN (SELECT count(*) FROM fn) < 2 THEN 'AUSENTE'
              WHEN (SELECT bool_and(f.atributos_ok) FROM fn f) THEN 'atributos de sempre'
              ELSE 'DIFERENTE: ' || (SELECT string_agg(f.chave, ',' ORDER BY f.chave) FROM fn f WHERE NOT f.atributos_ok) END
  UNION ALL
  SELECT 'as 12 colunas que os corpos novos leem existem (itens do pedido, produtos e itens da devolucao)',
         '12',
         (SELECT l.n::text FROM lidas l)
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

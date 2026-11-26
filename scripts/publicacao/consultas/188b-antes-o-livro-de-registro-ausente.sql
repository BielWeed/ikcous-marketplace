-- 188b-antes-o-livro-de-registro-ausente: ANTES da 20261510000000 (ou depois do rollback-manual-destrutivo dela). SO LEITURA, um unico
-- SELECT, somente catalogo e o agendador (cron.job: so jobname), rol fechado de 7 linhas. Nao le nenhuma linha de tabela nem o comando
-- dos jobs. O rollback-manual COMUM mantem as 3 tabelas (seladas, com as linhas) e a funcao de limpar: depois dele a linha das tabelas
-- e a das funcoes ficam "nao" de proposito, e so o destrutivo as apaga.
-- As linhas 5 a 7 sao o que o pre-voo da migration exige do banco: se uma vier "nao", o apply recusaria com B1_BASELINE_DIVERGENT e
-- nada seria escrito, entao a loja nao esta na base de antes.
-- VISIBILIDADE DO JOB: papel que sofre a RLS do cron.job (pg_cron real) nao ve job alheio; aqui isso so pode dar 'sim' a mais, nunca
-- 'nao' a mais (a linha pede o job AUSENTE). O supabase_read_only_user tem BYPASSRLS e ve todos. Sem USAGE no schema cron, ERRA (42501).
WITH tabelas(tabela, origem) AS (
  VALUES ('marketplace_orders', 'user_id'), ('marketplace_order_items', 'order_id'), ('order_refunds', 'order_id'),
         ('marketplace_order_payment_history', 'order_id'), ('devolucoes', 'user_id'), ('devolucao_itens', 'devolucao_id'),
         ('produtos', ''), ('product_variants', ''), ('categorias', ''), ('coupons', ''), ('fornecedores', ''),
         ('fin_lancamentos', ''), ('fin_contas', ''), ('fin_categorias', ''), ('store_config', ''),
         ('config_pagamento_cartao', ''), ('politica_devolucao', '')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'livro_de_registro_anotar e livro_de_registro_limpar: ainda NAO existem', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('livro_de_registro_anotar', 'livro_de_registro_limpar')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'livro_de_registro, livro_de_registro_chave e livro_de_registro_falhas: as tabelas ainda NAO existem', 'sim', CASE WHEN
    to_regclass('public.livro_de_registro') IS NULL AND to_regclass('public.livro_de_registro_chave') IS NULL
    AND to_regclass('public.livro_de_registro_falhas') IS NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'nenhum gatilho tr_livro_alteracao ou tr_livro_exclusao em tabela nenhuma, e o job limpar-livro-de-registro NAO agendado', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname IN ('tr_livro_alteracao', 'tr_livro_exclusao'))
    AND NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'limpar-livro-de-registro') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as 17 tabelas existem, comuns, cada uma com chave primaria de UMA coluna chamada id', 'sim', CASE WHEN
    (SELECT count(*) FROM tabelas x
      WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.' || x.tabela) AND c.relkind = 'r')
        AND EXISTS (SELECT 1 FROM pg_constraint k
                     WHERE k.conrelid = to_regclass('public.' || x.tabela) AND k.contype = 'p' AND array_length(k.conkey, 1) = 1
                       AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = k.conrelid AND a.attnum = k.conkey[1]) = 'id')) = 17 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as colunas do titular existem como uuid (marketplace_orders.user_id, devolucoes.user_id e order_id ou devolucao_id nas 4 filhas)', 'sim', CASE WHEN
    (SELECT count(*) FROM tabelas x
      WHERE x.origem <> ''
        AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = to_regclass('public.' || x.tabela) AND a.attname = x.origem AND NOT a.attisdropped
                       AND a.atttypid = 'uuid'::regtype)) = 6 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'Postgres 14 ou mais novo, cron.schedule(text, text, text), cron.job e auth.uid() existem', 'sim', CASE WHEN
    current_setting('server_version_num')::int >= 140000
    AND to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL AND to_regclass('cron.job') IS NOT NULL
    AND to_regprocedure('auth.uid()') IS NOT NULL THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

-- 8e — DEPOIS de aplicar as migrations 20261192..20261202 (ou quando um apply
-- terminou em ESTADO DESCONHECIDO e é preciso saber o que ficou): confere, por
-- OBJETO, que tudo o que elas criam existe e que o corpo vivo de cada uma das
-- 61 funções que elas definem é o corpo FINAL esperado (ou, para duas delas, o
-- da migration sucessora: ver OS DOIS ESTADOS).
-- SÓ LEITURA, um único SELECT, só catálogo: nenhuma linha de cliente.
--
-- Saída: item | esperado | vivo | ok, com as linhas ok = false primeiro.
-- Tudo `true` = a fila inteira 92..202 está no banco. Um `false` isolado depois
-- de um apply interrompido nomeia a função/objeto que ficou de fora; a
-- migration dona dele é a que contém o CREATE desse nome (grep no arquivo).
--
-- Cada md5 final é o corpo (`prosrc`, sem `\r`) que a ÚLTIMA migration da faixa
-- que define a função deixa. 59 deles aparecem literalmente no arquivo da
-- migration (preflight da migration seguinte); os de
-- `registrar_contestacao_no_ledger` e `registrar_estorno_externo_do_mp` vêm do
-- corpo da própria migration. tests/ci_conferir_banco_test.ts recalcula todos a
-- partir dos arquivos desta árvore e tests/banco/impressao-digital-viva.cjs
-- roda esta consulta no PG real, depois de aplicar 92..202, como papel só-leitura.
--
-- OS DOIS ESTADOS (onda I-b, 09/10/2026). Esta consulta é a pré-checagem do
-- backfill do ledger 92-202 e tem de dar positiva numa loja que ainda está no
-- corpo da 20261199 E numa que já recebeu a migration SUCESSORA que redefine
-- uma das 61 depois da 202 — senão ficaria vermelha para sempre depois do
-- apply da sucessora. Hoje são duas, cada uma POR SI (função independente:
-- uma loja pode ter só uma delas):
--   * `painel_inicio`          → 20261212000000 (o início conta estoque baixo pela regra da loja);
--   * `get_admin_analytics_v2` → 20261214000000 (o lucro do estoque só conta produto com custo).
-- ATENÇÃO (cadeia futura): cada função tem UMA sucessora no CTE, a da ÚLTIMA migration que a
-- redefine; uma terceira definição troca o hash e uma loja parada no intermediário passa a dar
-- NEGATIVA (falha fechada). Quem escrever a próxima sucessora decide se mantém o intermediário.
-- Para essas duas a linha "corpo final <fn>" aceita o md5 da 20261199 (o do
-- `final`, que é o `esperado`) OU o md5 da sucessora DA PRÓPRIA função (CTE
-- `sucessoras`); aceito, o `vivo` mostra o `esperado`. O rollback-manual de cada
-- sucessora devolve o corpo da 99, que segue aceito. Nada mais foi afrouxado:
-- corpo estranho (vivo = o md5 dele), função AUSENTE e sobrecarga múltipla
-- (vivo = os md5 separados por vírgula) reprovam igual, e as outras 59 seguem
-- exatas. tests/ci_conferir_banco_test.ts confere os hashes aceitos contra os
-- arquivos (sucessoras = as migrations depois da 202 que redefinem uma das 61,
-- com o md5 do corpo; o preflight delas e o rollback-manual citam os dois) e
-- tests/banco/portao-8e-aceita-sucessoras-viva.cjs roda esta consulta no PG
-- real nos estados 99, só 12, só 14 e árvore inteira, com os negativos.
--
-- Não confere ACL (GRANT/REVOKE) nem a política inteira — isso é o que o
-- pós-voo de cada migration já afirma dentro da transação; aqui é só "o objeto
-- existe e o corpo é o esperado".
WITH corpos AS (
  SELECT p.proname,
         string_agg(md5(replace(p.prosrc, E'\r', '')), ',' ORDER BY md5(replace(p.prosrc, E'\r', ''))) AS h
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
   GROUP BY p.proname
), final(fn, h) AS (VALUES
    ('admin_devolucao_concluir', '26080db4aeb82bdfb9fcd0c6f7169ebb'),
    ('admin_devolucao_decidir', '9cd24a3818b1fea1b4d182bf4b2b52b0'),
    ('admin_devolucao_liberar_vinculo_reverso', '8314060e4e11eeab71d077fd76e0398f'),
    ('admin_devolucao_reemitir_reembolso', '422cfaa8c53cefc1913b9e082442631d'),
    ('admin_devolucao_registrar', 'f59a9f01811512329c425295ea171e76'),
    ('admin_devolucao_reprovar', '16f223b54591e6ee24eeb6e28c8c264c'),
    ('admin_devolucoes_listar', '5a632e0a239104598dcdc4eb323c09b1'),
    ('autorizar_post_do_estorno', 'e128f7ad54ebc82c97b97af4aa7baa08'),
    ('cancelar_pedido_com_cobranca', 'e924c8fd33bb87e86a4a3fbd4fefde4e'),
    ('confirmar_pagamento', 'dc5632ca36019058225cdb520687c74a'),
    ('confirmar_retorno_do_produto', '803245a0850dccfa6bf3814434023da9'),
    ('crm_clientes', 'd5823a661555bcee3813ab32aeee9117'),
    ('crm_visao', '7f6ec1bc0fa9f40591c0b577201b7c36'),
    ('devolucao_detalhe', '6897a45df3e5d29256f85611ea3ca91f'),
    ('devolucao_elegibilidade', '0bdb635f4f04e8edb894b70da58282e7'),
    ('devolucoes_do_pedido', 'ab157c125b4f4a73f523a12b3c967a56'),
    ('ensure_role_protection', '44d677c3fa562318668122aad65fe0df'),
    ('fin_caixa_abrir', '46793029f342662859e0bf6205566119'),
    ('fin_caixa_atual', 'dd00ea41f415a20bc594659eb2aef08f'),
    ('fin_caixa_fechar', '69a9dd8988cdc05392f500deb64f349f'),
    ('fin_caixa_historico', '2bd23adcaa5d30b52172ad33ad3137cd'),
    ('fin_caixa_movimentar', 'd7e8dfeec40f89dff51f4cb3ccf14b9a'),
    ('fin_categoria_salvar', 'ec6da50db8e67dd3895aed7bbb8a0cb6'),
    ('fin_categorias_listar', '4cf0145c5b73d781cd2006881e638513'),
    ('fin_conta_salvar', '2f9b720cb3804edba4879595b0d6fe1d'),
    ('fin_contas_listar', 'c4b5434e8b99879cfb95b2b94d6b2695'),
    ('fin_dre', 'e58ac49d3881a459b929064a3acb470a'),
    ('fin_extrato', '46f4763de4295da1fa9113910e188d6e'),
    ('fin_lancamento_baixar', 'e59bc12ea20182da4209a257df0be8c1'),
    ('fin_lancamento_cancelar', 'a0b036d6d16d323dc806732b85b8b1cf'),
    ('fin_lancamento_salvar', '559a13a9d69e02e5048623685cd07514'),
    ('fin_previstos', 'b8b28d76b42d8f53cf38cdf13997016f'),
    ('fin_resumo', '410668ed931d89e0a16a568b35df7973'),
    ('get_admin_analytics_v2', '6abc7e44b0aae3b2e542e87daf055451'),
    ('get_admin_customers_paged', '3c4a0fc4ca6f5d1c9a017a38bff2ec49'),
    ('get_admin_orders_cancelados_recentes', '99a9e4cb232aef020bf297ddcd1901f0'),
    ('get_admin_orders_paged', '5861dbbe0e9c007a4196f5308c17d763'),
    ('get_admin_user_detail', '4dec3f232e1905ad62688b8bcd098b2a'),
    ('get_category_analytics', '9202ebd1aae8cc95e431fd3eb9bc7eb3'),
    ('get_coupon_stats', 'ca4d7e6a2b7fc7b1caef9c4deca4bc9b'),
    ('get_retention_rate', '9692f411bf837541049308fa1d9da4e9'),
    ('get_segmented_push_count', 'e5f6b76afd6ec75df32f168d9942e209'),
    ('get_segmented_push_targets', '404f93b98fdc97b3dde45ac30fa799eb'),
    ('handle_profile_role_sync_to_auth', 'e63371757c43ef2619dd613af4635ad3'),
    ('is_admin_atual', '519842163e48cc377ac1337ffb9db936'),
    ('painel_inicio', 'ebcafff0ad5efbb70391a2cc93a14247'),
    ('pedido__mudar_status', '4623b27a07468553d6ac00a888e04db4'),
    ('pedido__saldo_a_estornar', '9579d2b56b57cf948659936a928dd7dc'),
    ('prevent_role_change', '92ff3224c34e3367cdf892579e8176f0'),
    ('registrar_contestacao_no_ledger', '946d4a9af0b47825bf7b2fc8472b232c'),
    ('registrar_estorno_externo_do_mp', 'ce8d4089aa20c71c7dc9ffb1566e6dac'),
    ('registrar_estorno_manual', '6901cdc521dfae408836a150a5752ad0'),
    ('registrar_pagamento_recebido', '6584d62da7815a913b1e0cb86c108b0f'),
    ('registrar_venda_presencial', '6a421904a7c99a0e17ca58f2f891c71d'),
    ('rls_admin_atual', 'ccb7a56e835b8181795fffb7bee97305'),
    ('salvar_config_pagamento_cartao', 'd957529f1cc67bd5e6005ed4bd0614b4'),
    ('salvar_politica_de_devolucao', '043f816330a66b290fd04d272a4ee934'),
    ('save_store_identity', 'b3c3b0aa2cb8cb8aadcdc5f3906d7cde'),
    ('solicitar_estorno', '069c3d12a470cc4708099d909c57ca02'),
    ('update_order_status_atomic', 'c8df4feb3f53b90922a6c8398371e394'),
    ('upsert_store_config', '9c56a9c6953e1d774a1ee97d5d8a7e16')
), sucessoras(fn, h, versao) AS (VALUES
    ('painel_inicio', 'f11d22d076c59ab54d1beb280954dd15', '20261212000000'),
    ('get_admin_analytics_v2', '0a5f8c75bbeeda3777a6a7326a0e281c', '20261214000000')
), colunas(tabela, coluna) AS (VALUES
    ('order_refunds', 'mp_chargeback_id'),
    ('order_refunds', 'mp_chargeback_case_id'),
    ('order_refunds', 'mp_chargeback_valor_do_caso'),
    ('order_refunds', 'post_autorizado_em'),
    ('order_refunds', 'criada_sob_autorizacao')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM corpos) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'corpo final ' || f.fn, f.h,
         CASE WHEN c.h IS NULL THEN 'AUSENTE'
              WHEN c.h = f.h OR c.h IN (SELECT s.h FROM sucessoras s WHERE s.fn = f.fn) THEN f.h
              ELSE c.h END
    FROM final f LEFT JOIN corpos c ON c.proname = f.fn
  UNION ALL
  SELECT 'coluna ' || k.tabela || '.' || k.coluna || ' existe', 'EXISTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                            WHERE a.attrelid = to_regclass('public.' || k.tabela)
                              AND a.attname = k.coluna AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'EXISTE' ELSE 'AUSENTE' END
    FROM colunas k
  UNION ALL
  SELECT 'tabela contestacoes_decisao_final existe', 'EXISTE',
         CASE WHEN to_regclass('public.contestacoes_decisao_final') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'indice ' || i.nome || ' existe', 'EXISTE',
         CASE WHEN to_regclass('public.' || i.nome) IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
    FROM (VALUES ('uq_order_refunds_pedido_refund_mp'), ('uq_order_refunds_pedido_contestacao')) AS i(nome)
  UNION ALL
  SELECT 'politica ' || pl.tabela || '.' || pl.nome || ' existe', 'EXISTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_policies pp
                            WHERE pp.schemaname = 'public' AND pp.tablename = pl.tabela AND pp.policyname = pl.nome)
              THEN 'EXISTE' ELSE 'AUSENTE' END
    FROM (VALUES ('marketplace_order_items', 'order_items_select_policy'),
                 ('marketplace_order_history', 'order_history_select_policy')) AS pl(tabela, nome)
  UNION ALL
  SELECT 'politicas de public que citam rls_admin_atual', '>0',
         CASE WHEN (SELECT count(*) FROM pg_policies pp
                     WHERE pp.schemaname = 'public'
                       AND (COALESCE(pp.qual, '') LIKE '%rls_admin_atual%' OR COALESCE(pp.with_check, '') LIKE '%rls_admin_atual%')) > 0
              THEN '>0' ELSE '0' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

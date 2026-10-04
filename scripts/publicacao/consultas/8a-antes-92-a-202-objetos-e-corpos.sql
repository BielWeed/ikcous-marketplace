-- 8a — ANTES de aplicar as migrations 20261192..20261202 numa loja: o que elas
-- CRIAM ainda não existe e o corpo vivo de cada função que elas SUBSTITUEM é
-- exatamente o baseline que o pré-voo da própria migration exige.
-- SÓ LEITURA, um único SELECT, só catálogo (pg_proc, pg_attribute, pg_class,
-- pg_policies): nenhuma linha de dado de cliente é lida nem devolvida.
--
-- POR OBJETO, nunca por `schema_migrations`: o registro do ledger não prova o
-- que está no banco (o dono aplica à mão, o ledger pode estar vazio ou
-- adiantado). Conferir o objeto vivo é a única prova.
--
-- Saída: uma linha por item — item | esperado | vivo | ok. As linhas com
-- ok = false vêm primeiro. Tudo `true` = a loja está na base pré-92 e pode
-- receber a fila 92..202; qualquer `false` = PARE e leia a linha.
--
-- O QUE CADA GRUPO DE LINHAS PROVA
--   * controle     — o papel enxerga as funções de `public` (um catálogo
--                    vazio, por permissão, faria todo "ausente" abaixo passar
--                    por engano).
--   * BASE         — `liberar_cobranca_do_pedido` (a edge de cartão confere o
--                    corpo dela e NENHUMA migration 92..202 a redefine) está
--                    com o corpo `bae7882a…`. Se o corpo for outro, a linha
--                    mostra `base diferente: <md5 vivo>` e NADA aqui ajusta
--                    nada: é decisão de quem lê.
--   * base <fn>    — 53 funções que 92..202 redefinem: o md5 vivo é o do
--                    baseline que o preflight da primeira migration que a
--                    substitui exige (cada valor aparece literalmente num
--                    preflight da árvore; a guarda de
--                    tests/ci_conferir_banco_test.ts confere isso).
--   * nova <fn>    — 8 funções que 92..202 CRIAM: têm de estar ausentes.
--   * coluna/tabela/índice/política — o que 92..202 cria: tem de estar ausente
--                    (5 colunas de `order_refunds`, a tabela
--                    `contestacoes_decisao_final`, 2 índices únicos, 2 políticas
--                    de SELECT novas) e nenhuma política de `public` pode citar
--                    `rls_admin_atual` ainda.
--
-- md5 = md5 do corpo (`prosrc`) sem `\r` — a mesma conta dos preflights. Se uma
-- função tiver sobrecarga viva, o `vivo` lista os md5 separados por vírgula e a
-- linha reprova (o baseline assume uma assinatura só).
WITH corpos AS (
  SELECT p.proname,
         string_agg(md5(replace(p.prosrc, E'\r', '')), ',' ORDER BY md5(replace(p.prosrc, E'\r', ''))) AS h
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
   GROUP BY p.proname
), base(fn, h) AS (VALUES
    ('admin_devolucao_concluir', '2207a35be5937de4e1f6205dcd3340d1'),
    ('admin_devolucao_decidir', '9016a6f0151bcefddd65eb24bc369c32'),
    ('admin_devolucao_liberar_vinculo_reverso', '83144be5ac2bc52f07f02274023a83ab'),
    ('admin_devolucao_reemitir_reembolso', '06c92efbbf5b3db1f97853e121612c88'),
    ('admin_devolucao_registrar', '1c21f253418ca60b76c8f9374dd9b298'),
    ('admin_devolucao_reprovar', 'b68b1b227b2fa90a037374e2770a1b68'),
    ('admin_devolucoes_listar', '959e175f6471d3894ea6dbe802876313'),
    ('confirmar_pagamento', 'b34f8033380177a45d500a2360ba2bdd'),
    ('confirmar_retorno_do_produto', '5eb2cb42af868bff0216d82b920dbd63'),
    ('crm_clientes', 'f31396c2f583756da56ae63a44cf09dc'),
    ('crm_visao', '0e76e93760b7db349c294c40b4477c18'),
    ('devolucao_detalhe', 'cec98031ee4c30cf9fe80c2e4df01d5e'),
    ('devolucao_elegibilidade', '882d22ff3b6a417fcc6b1aed7bdaf678'),
    ('devolucoes_do_pedido', '12c08b046aacd29f91ed398910bf65b3'),
    ('ensure_role_protection', '4a68bf7969530871c9ebedb8ac81111b'),
    ('fin_caixa_abrir', '43d5aa2cb9ef146298db43808b3b98e4'),
    ('fin_caixa_atual', 'fbb4466d909f17f029c3918e0e7f2a30'),
    ('fin_caixa_fechar', '0582b0b80702ee9261b41f5376de3861'),
    ('fin_caixa_historico', '5c2c363f4e887a8c69abf277d2a839f9'),
    ('fin_caixa_movimentar', '34b4ffa5560eb333bff22495088508ce'),
    ('fin_categoria_salvar', '13aadcc57fc634f1758ad91c82b295ce'),
    ('fin_categorias_listar', '4db367379c108c46f7d526c741cf2bbf'),
    ('fin_conta_salvar', '4fd59e7124913b1b39a4f10cee153722'),
    ('fin_contas_listar', '154c1de0d59615a58e2df1b12c61f6ab'),
    ('fin_dre', '3ab0be7bdb863cd8605581252ef7a46a'),
    ('fin_extrato', '1be12e753eeb9f573800bbaf56923be7'),
    ('fin_lancamento_baixar', 'ee843dd1ba3d94647cd47be817fe3452'),
    ('fin_lancamento_cancelar', '25595f56b9f3134f5fb3ee9488670ea0'),
    ('fin_lancamento_salvar', '033299a836af5a342e6cf9e1d6a1fed6'),
    ('fin_previstos', '1c00acae271d225e5e22b4b4f892196c'),
    ('fin_resumo', '436c4f46e7d60f610926edc0dcc887df'),
    ('get_admin_analytics_v2', 'a2c6c6d16330bf0a0c6a3e22e83d969c'),
    ('get_admin_customers_paged', '26eb0dfa4174535aefd383671a5afdbf'),
    ('get_admin_orders_cancelados_recentes', 'cdb61f0f957078523aabe402e4b48fb3'),
    ('get_admin_orders_paged', '59ee815bdf0e456d03987a8dd65baba5'),
    ('get_admin_user_detail', '1794226c392b8d2eece44f3afe2af166'),
    ('get_category_analytics', '3d23aebe664ca22b5b14a03ca8572189'),
    ('get_coupon_stats', '68839bb23cdb1f56bf69033457034350'),
    ('get_retention_rate', '87e30f3261194136cc99bf65a124593f'),
    ('get_segmented_push_count', '268d433bec60dca068dac1ff3049f6cc'),
    ('get_segmented_push_targets', 'e160802d4ed395497952112acca4df0e'),
    ('handle_profile_role_sync_to_auth', '408b1496e36049d0b4475c50dc201794'),
    ('painel_inicio', 'f4509ee736a5134003fd5e94901c5018'),
    ('prevent_role_change', '16018a39db2658ff669e032f1c0c6062'),
    ('registrar_estorno_manual', '3632b8b804ecf913bd849879212ff1ba'),
    ('registrar_pagamento_recebido', 'ac0b2d9856a1c3d2d38add0b5d737575'),
    ('registrar_venda_presencial', '654bc307a4c7f54c9e4b8ce44969e29f'),
    ('salvar_config_pagamento_cartao', '05ed486b13d9e9084108bf94d9a8154b'),
    ('salvar_politica_de_devolucao', '79c7ca96ef89dcbec6c94f81945aa33f'),
    ('save_store_identity', 'fe7dad0ae7054a2b92646e89845a43d4'),
    ('solicitar_estorno', 'ee9fe85d9b18b0e38e23cf48dd3b1111'),
    ('update_order_status_atomic', 'ed2f7fd3e0177c027720049b2fe55d3b'),
    ('upsert_store_config', '37a81b0351637a90b7a5a8e10a7d3e82')
), novas(fn) AS (VALUES
    ('autorizar_post_do_estorno'),
    ('cancelar_pedido_com_cobranca'),
    ('is_admin_atual'),
    ('pedido__mudar_status'),
    ('pedido__saldo_a_estornar'),
    ('registrar_contestacao_no_ledger'),
    ('registrar_estorno_externo_do_mp'),
    ('rls_admin_atual')
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
  SELECT 'BASE liberar_cobranca_do_pedido (nenhuma 92..202 a redefine)',
         'bae7882a60430547ee32b4b2092580a8',
         COALESCE((SELECT CASE WHEN c.h = 'bae7882a60430547ee32b4b2092580a8' THEN c.h ELSE 'base diferente: ' || c.h END
                     FROM corpos c WHERE c.proname = 'liberar_cobranca_do_pedido'), 'AUSENTE')
  UNION ALL
  SELECT 'base ' || b.fn, b.h, COALESCE(c.h, 'AUSENTE')
    FROM base b LEFT JOIN corpos c ON c.proname = b.fn
  UNION ALL
  SELECT 'nova ' || n.fn || ' ainda nao existe', 'ausente',
         CASE WHEN c.h IS NULL THEN 'ausente' ELSE 'EXISTE' END
    FROM novas n LEFT JOIN corpos c ON c.proname = n.fn
  UNION ALL
  SELECT 'coluna ' || k.tabela || '.' || k.coluna || ' ainda nao existe', 'ausente',
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                            WHERE a.attrelid = to_regclass('public.' || k.tabela)
                              AND a.attname = k.coluna AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'EXISTE' ELSE 'ausente' END
    FROM colunas k
  UNION ALL
  SELECT 'tabela contestacoes_decisao_final ainda nao existe', 'ausente',
         CASE WHEN to_regclass('public.contestacoes_decisao_final') IS NULL THEN 'ausente' ELSE 'EXISTE' END
  UNION ALL
  SELECT 'indice ' || i.nome || ' ainda nao existe', 'ausente',
         CASE WHEN to_regclass('public.' || i.nome) IS NULL THEN 'ausente' ELSE 'EXISTE' END
    FROM (VALUES ('uq_order_refunds_pedido_refund_mp'), ('uq_order_refunds_pedido_contestacao')) AS i(nome)
  UNION ALL
  SELECT 'politica ' || pl.tabela || '.' || pl.nome || ' ainda nao existe', 'ausente',
         CASE WHEN EXISTS (SELECT 1 FROM pg_policies pp
                            WHERE pp.schemaname = 'public' AND pp.tablename = pl.tabela AND pp.policyname = pl.nome)
              THEN 'EXISTE' ELSE 'ausente' END
    FROM (VALUES ('marketplace_order_items', 'order_items_select_policy'),
                 ('marketplace_order_history', 'order_history_select_policy')) AS pl(tabela, nome)
  UNION ALL
  SELECT 'politicas de public que citam rls_admin_atual', '0',
         (SELECT count(*) FROM pg_policies pp
           WHERE pp.schemaname = 'public'
             AND (COALESCE(pp.qual, '') LIKE '%rls_admin_atual%' OR COALESCE(pp.with_check, '') LIKE '%rls_admin_atual%'))::text
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

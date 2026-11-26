-- 188m — MEDICAO, so leitura, do VOLUME que o livro de registro (migration 20261510000000) vai receber, ANTES do apply (e depois, para
-- comparar). Molde da 22m/27m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e' prova do portao da release. Quem decide e' a pessoa
-- que le a tabela. Rodar em CADA loja antes de aplicar a 20261510000000.
--
-- NAO LE DADO: nenhuma linha das 17 tabelas, do livro nem de cliente; nada de pg_stats (amostra de valores das colunas); do agendador so
-- jobname, schedule e active (nunca o comando). So catalogo e contadores de estatistica (pg_stat_user_tables, pg_stat_database), tamanhos
-- (pg_relation_size, pg_total_relation_size, pg_database_size) e a estimativa do planejador (reltuples). Roda por papel SEM privilegio
-- nas 17 tabelas (tests/banco/o-livro-de-registro-portao-viva.cjs prova isso); sem USAGE no schema cron, ERRA (42501).
--
-- Saida: tipo | objeto | detalhe. O detalhe e' `chave=valor` separado por `|`. Tipos, na ordem:
--   controle    quem leu (superusuario?, BYPASSRLS?), a versao do servidor (server_version_num; o livro exige 14+), o tamanho do banco
--               (pg_database_size, em MB; o disjuntor do livro desliga acima de 400 MB) e desde quando os contadores contam (stats_reset
--               de pg_stat_database; nulo = desde que o banco nasceu) com os dias ate agora.
--   tabela      uma linha por tabela das 17: atualizacoes (n_tup_upd, das quais n_tup_hot_upd HOT), exclusoes (n_tup_del), insercoes
--               (n_tup_ins, que o livro NAO anota), linhas vivas (n_live_tup) e a estimativa do planejador (reltuples), tamanho da
--               tabela e total com indices (bytes), e os gatilhos que ja existem nela (nomes; tr_livro_* = livro ja aplicado).
--   cron        a versao do pg_cron instalada e cada job visivel: nome, horario e se esta ativo. Com a RLS do cron.job valendo para quem
--               leu (row_security_active), os jobs de outro dono nao aparecem: a linha `controle` diz se e' o caso.
--   livro       o que do livro ja existe (as 3 tabelas e as 2 funcoes): presente/ausente. Antes do apply, tudo ausente.
--   ESTIMATIVA  a conta do que o livro vai guardar em 90 dias, por tabela e no total: (atualizacoes + exclusoes) / dias de contagem x 90,
--               a ~320 bytes por anotacao de atualizacao (so a coluna que mudou) e o tamanho medio da linha da tabela por exclusao
--               (a linha inteira). E' teto, nao media: UPDATE que so mexe no carimbo (updated_at, ultima_atualizacao) ou que nao muda
--               nada conta aqui e nao vira anotacao. Comparar com os tetos da chave: 200000 linhas e 400 MB de banco.
WITH tabelas(ordem, tabela) AS (
  VALUES (1, 'marketplace_orders'), (2, 'marketplace_order_items'), (3, 'order_refunds'), (4, 'marketplace_order_payment_history'),
         (5, 'devolucoes'), (6, 'devolucao_itens'), (7, 'produtos'), (8, 'product_variants'), (9, 'categorias'), (10, 'coupons'),
         (11, 'fornecedores'), (12, 'fin_lancamentos'), (13, 'fin_contas'), (14, 'fin_categorias'), (15, 'store_config'),
         (16, 'config_pagamento_cartao'), (17, 'politica_devolucao')
), banco AS (
  SELECT d.stats_reset,
         GREATEST(EXTRACT(EPOCH FROM (now() - COALESCE(d.stats_reset, pg_postmaster_start_time()))) / 86400.0, 1.0) AS dias
    FROM pg_stat_database d WHERE d.datname = current_database()
), medidas AS (
  SELECT t.ordem, t.tabela, c.oid, c.reltuples, s.n_tup_upd, s.n_tup_hot_upd, s.n_tup_del, s.n_tup_ins, s.n_live_tup,
         CASE WHEN c.oid IS NULL THEN NULL ELSE pg_relation_size(c.oid) END AS bytes_tabela,
         CASE WHEN c.oid IS NULL THEN NULL ELSE pg_total_relation_size(c.oid) END AS bytes_total,
         (SELECT string_agg(g.tgname::text, ',' ORDER BY g.tgname) FROM pg_trigger g WHERE g.tgrelid = c.oid AND NOT g.tgisinternal) AS gatilhos
    FROM tabelas t
    LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.tabela)
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
), estimativa AS (
  SELECT m.ordem, m.tabela,
         (COALESCE(m.n_tup_upd, 0) / b.dias * 90.0) AS upd_90,
         (COALESCE(m.n_tup_del, 0) / b.dias * 90.0) AS del_90,
         CASE WHEN COALESCE(m.reltuples, 0) > 0 THEN m.bytes_tabela / m.reltuples ELSE 0 END AS bytes_por_linha
    FROM medidas m CROSS JOIN banco b
), r(ordem, tipo, objeto, detalhe) AS (
  SELECT 0, 'controle', 'quem leu',
         'usuario=' || current_user || '|superusuario=' || COALESCE((SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user), '?')
         || '|bypassrls=' || COALESCE((SELECT rolbypassrls::text FROM pg_roles WHERE rolname = current_user), '?')
         || '|rls_do_cron_vale=' || COALESCE(row_security_active('cron.job')::text, '?')
  UNION ALL
  SELECT 0, 'controle', 'servidor', 'server_version_num=' || current_setting('server_version_num')
  UNION ALL
  SELECT 0, 'controle', 'banco',
         'pg_database_size_mb=' || round(pg_database_size(current_database()) / 1048576.0, 1)::text
         || '|stats_reset=' || COALESCE((SELECT stats_reset::text FROM banco), 'nulo')
         || '|dias_de_contagem=' || COALESCE((SELECT round(dias, 1)::text FROM banco), '?')
  UNION ALL
  SELECT 10 + m.ordem, 'tabela', m.tabela,
         CASE WHEN m.oid IS NULL THEN 'AUSENTE' ELSE
           'n_tup_upd=' || COALESCE(m.n_tup_upd, 0)::text || '|n_tup_hot_upd=' || COALESCE(m.n_tup_hot_upd, 0)::text
           || '|n_tup_del=' || COALESCE(m.n_tup_del, 0)::text || '|n_tup_ins=' || COALESCE(m.n_tup_ins, 0)::text
           || '|n_live_tup=' || COALESCE(m.n_live_tup, 0)::text || '|reltuples=' || m.reltuples::bigint::text
           || '|bytes_tabela=' || m.bytes_tabela::text || '|bytes_total=' || m.bytes_total::text
           || '|gatilhos=' || COALESCE(m.gatilhos, 'nenhum') END
    FROM medidas m
  UNION ALL
  SELECT 40, 'cron', 'pg_cron', 'extversion=' || COALESCE((SELECT e.extversion FROM pg_extension e WHERE e.extname = 'pg_cron'), 'ausente')
  UNION ALL
  SELECT 41, 'cron', j.jobname, 'schedule=' || j.schedule || '|active=' || j.active::text
    FROM cron.job j
  UNION ALL
  SELECT 50, 'livro', x.nome,
         CASE WHEN COALESCE(to_regclass('public.' || x.nome)::oid, to_regprocedure('public.' || x.nome || '()')::oid) IS NULL
              THEN 'ausente' ELSE 'presente' END
    FROM unnest(ARRAY['livro_de_registro', 'livro_de_registro_chave', 'livro_de_registro_falhas',
                      'livro_de_registro_anotar', 'livro_de_registro_limpar']) AS x(nome)
  UNION ALL
  SELECT 60 + e.ordem, 'ESTIMATIVA', e.tabela,
         'anotacoes_90d=' || round(e.upd_90 + e.del_90)::text
         || '|bytes_90d=' || round(e.upd_90 * 320 + e.del_90 * e.bytes_por_linha)::text
    FROM estimativa e
  UNION ALL
  SELECT 99, 'ESTIMATIVA', 'total das 17',
         'anotacoes_90d=' || round(sum(e.upd_90 + e.del_90))::text
         || '|mb_90d=' || round(sum(e.upd_90 * 320 + e.del_90 * e.bytes_por_linha) / 1048576.0, 1)::text
         || '|teto_linhas=200000|teto_banco_mb=400'
    FROM estimativa e
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto, detalhe;

-- 196m — MEDICAO, so leitura, de QUEM CRIA PEDIDO na loja, ANTES da migration 20261600000000 (a loja pausa o pedido novo: um gatilho
-- BEFORE INSERT em marketplace_orders recusa o pedido online quando a loja esta em manutencao ou com as vendas pausadas). Molde da
-- 22m/41m/188m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e' prova do portao da release. Quem decide e' a pessoa que le a tabela.
-- Rodar em CADA loja antes do apply. PARAR se aparecer: funcao que insere em marketplace_orders fora do mapa do plano (create_marketplace_order,
-- _v23, _v24 e registrar_venda_presencial), outro gatilho BEFORE INSERT em marketplace_orders, ou loja com manutencao=true HOJE (ela passa a
-- recusar pedido online no apply: avisar o dono antes).
--
-- NAO LE DADO DE PESSOA: nenhuma linha de pedido, de cliente nem a chave da assinatura (nem o hash). Le do catalogo (pg_proc, pg_trigger,
-- pg_attribute) e, de dado da LOJA, so store_config.manutencao (quantas linhas e o valor) e os 5 campos de data/estado do cartao da
-- assinatura (status, teste_ate, proxima_cobranca_em, pausa_em, atualizado_em). As linhas sao lidas por to_jsonb para a consulta nao errar
-- numa loja que ainda nao tem a coluna (sai `ausente`). As TABELAS store_config, assinatura_da_loja (20261177000000) e assinatura_da_loja_chave
-- (20261399998000) tem de existir: sem elas a consulta erra (42P01), e o erro ja e' a resposta (a 20261600000000 exige as tres).
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?) e se a RLS VALE para quem leu em store_config e assinatura_da_loja: com a RLS valendo,
--              as linhas de loja abaixo podem sair vazias e o numero nao e' o da loja.
--   premissa   o que o pre-voo da 20261600000000 vai exigir: marketplace_orders.canal e .idempotency_key, store_config.manutencao,
--              is_admin() e is_admin_atual(), assinatura_da_loja (com pausa_em, da 20261590000000) e assinatura_da_loja_chave: presente/ausente.
--              E o que ela cria (pausa_de_vendas e as 5 funcoes): antes do apply, tudo ausente.
--   funcao     uma linha por funcao (fora de pg_catalog e information_schema) cujo corpo cita marketplace_orders e INSERT: insere_pedido=sim
--              quando o corpo tem INSERT INTO [public.]marketplace_orders; SECURITY DEFINER; EXECUTE de anon e authenticated; md5 do corpo
--              (sem CR). As de insere_pedido=nao so citam a tabela e inserem em outra (estorno, devolucao, livro de registro).
--   gatilho    uma linha por gatilho nao interno de marketplace_orders, com a definicao inteira (momento, evento, WHEN, funcao) e se esta ligado.
--   loja       store_config: quantas linhas e o valor de manutencao em cada uma; assinatura_da_loja: se a chave esta definida (so se existe linha)
--              e o cartao (status e as datas).
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta.
WITH fn AS (
  SELECT n.nspname, p.oid, p.oid::regprocedure::text AS assinatura, p.prosecdef, md5(replace(p.prosrc, chr(13), '')) AS corpo,
         p.prosrc ~* 'insert\s+into\s+(public\.)?marketplace_orders\M' AS insere,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* 'marketplace_orders'
     AND p.prosrc ~* '\minsert\M'
), gat AS (
  SELECT g.tgname, g.tgenabled, pg_get_triggerdef(g.oid) AS def
    FROM pg_trigger g
   WHERE g.tgrelid = to_regclass('public.marketplace_orders') AND NOT g.tgisinternal
), coluna(ordem, tabela, coluna) AS (
  VALUES (1, 'marketplace_orders', 'canal'), (2, 'marketplace_orders', 'idempotency_key'), (3, 'store_config', 'manutencao'),
         (4, 'assinatura_da_loja', 'status'), (5, 'assinatura_da_loja', 'pausa_em')
), funcao_exigida(ordem, assinatura) AS (
  VALUES (11, 'public.is_admin()'), (12, 'public.is_admin_atual()'),
         (13, 'public.data_da_pausa_de_vendas(date, date, date, date)'), (14, 'public.marcar_suspensa_desde()'),
         (15, 'public.motivo_da_loja_nao_aceitar_pedido()'), (16, 'public.a_loja_aceita_pedido_novo()'),
         (17, 'public.situacao_das_vendas_da_loja()')
), tabela_exigida(ordem, tabela) AS (
  VALUES (21, 'assinatura_da_loja_chave'), (22, 'pausa_de_vendas')
), loja AS (
  SELECT to_jsonb(s) ->> 'manutencao' AS manutencao FROM public.store_config s
), cartao AS (
  SELECT to_jsonb(a) AS j FROM public.assinatura_da_loja a
), r(ordem, tipo, objeto, detalhe) AS (
  SELECT 0, 'controle', 'quem leu',
         'usuario=' || current_user || '|superusuario=' || COALESCE((SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user), '?')
         || '|bypassrls=' || COALESCE((SELECT rolbypassrls::text FROM pg_roles WHERE rolname = current_user), '?')
         || '|rls_vale_store_config=' || COALESCE(row_security_active('public.store_config')::text, '?')
         || '|rls_vale_assinatura=' || COALESCE(row_security_active('public.assinatura_da_loja')::text, '?')
  UNION ALL
  SELECT 10 + c.ordem, 'premissa', c.tabela || '.' || c.coluna,
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                            WHERE a.attrelid = to_regclass('public.' || c.tabela) AND a.attname = c.coluna AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'presente' ELSE 'ausente' END
    FROM coluna c
  UNION ALL
  SELECT 10 + e.ordem, 'premissa', e.assinatura,
         CASE WHEN to_regprocedure(e.assinatura) IS NULL THEN 'ausente' ELSE 'presente' END
    FROM funcao_exigida e
  UNION ALL
  SELECT 10 + t.ordem, 'premissa', 'public.' || t.tabela,
         CASE WHEN to_regclass('public.' || t.tabela) IS NULL THEN 'ausente' ELSE 'presente' END
    FROM tabela_exigida t
  UNION ALL
  SELECT 100, 'funcao', f.assinatura,
         'insere_pedido=' || CASE WHEN f.insere THEN 'sim' ELSE 'nao' END || '|schema=' || f.nspname
         || '|security_definer=' || f.prosecdef::text || '|anon_executa=' || f.anon_exec::text
         || '|authenticated_executa=' || f.auth_exec::text || '|md5=' || f.corpo
    FROM fn f
  UNION ALL
  SELECT 200, 'gatilho', g.tgname, 'ligado=' || g.tgenabled::text || '|' || g.def
    FROM gat g
  UNION ALL
  SELECT 300, 'loja', 'store_config',
         'linhas=' || (SELECT count(*) FROM loja)::text
         || '|manutencao=' || COALESCE((SELECT string_agg(COALESCE(l.manutencao, 'nulo'), ',' ORDER BY l.manutencao) FROM loja l), 'nenhuma_linha')
  UNION ALL
  SELECT 301, 'loja', 'assinatura_da_loja',
         CASE WHEN NOT EXISTS (SELECT 1 FROM cartao) THEN 'cartao=nenhuma_linha'
              ELSE (SELECT 'cartao=presente|status=' || COALESCE(c.j ->> 'status', 'nulo')
                           || '|teste_ate=' || COALESCE(c.j ->> 'teste_ate', 'nulo')
                           || '|proxima_cobranca_em=' || COALESCE(c.j ->> 'proxima_cobranca_em', 'nulo')
                           || '|pausa_em=' || CASE WHEN c.j ? 'pausa_em' THEN COALESCE(c.j ->> 'pausa_em', 'nulo') ELSE 'coluna_ausente' END
                           || '|atualizado_em=' || COALESCE(c.j ->> 'atualizado_em', 'nulo')
                      FROM cartao c LIMIT 1)
         END
         || '|linhas=' || (SELECT count(*) FROM cartao)::text
  UNION ALL
  SELECT 302, 'loja', 'assinatura_da_loja_chave',
         'chave_definida=' || (SELECT CASE WHEN count(*) > 0 THEN 'sim' ELSE 'nao' END FROM public.assinatura_da_loja_chave)
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto COLLATE "C";

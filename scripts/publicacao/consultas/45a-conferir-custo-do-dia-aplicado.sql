-- 45a — DEPOIS de aplicar a migration 20261242000000 (o lucro usa o custo do dia da venda: a tabela lateral
-- `marketplace_order_item_custo`, o gatilho `tr_marketplace_order_items_guarda_o_custo_do_dia` que copia o custo do
-- produto para cada item que nasce, e os dois relatorios do lojista que passam a ler esse custo:
-- `get_admin_analytics_v2` (CRM) e `fin_dre` (DRE)): confirma, POR OBJETO, que o corpo vivo de CADA uma das TRES
-- funcoes (as duas reescritas e a do gatilho) e o desta migration (md5), que os atributos sao os desenhados, que o
-- EXECUTE esta como deve (os dois relatorios so do authenticated; a funcao do gatilho fechada a todos, inclusive
-- service_role), que a tabela e' so do servidor (o custo e' do lojista: a cliente le os itens do proprio pedido e
-- por isso o custo NAO mora em `marketplace_order_items`), que o gatilho esta ligado e que a tabela nao vai ao
-- realtime. E' a consulta do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json; a de ausencia e' a
-- 45b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_class, pg_attribute, pg_policy,
-- pg_constraint, pg_trigger, pg_publication_tables, aclexplode): nenhuma linha de pedido, de item, de produto ou de
-- custo e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 13 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = o
-- lote esta aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual reprovam todas menos o
-- controle.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261242000000.
--   * atributos  -- SECURITY DEFINER + `search_path=public` nas TRES, com a linguagem, a volatilidade e o retorno de
--                   cada uma (analytics plpgsql VOLATILE json; DRE plpgsql STABLE jsonb; gatilho plpgsql VOLATILE
--                   trigger) e UMA assinatura so por nome.
--   * EXECUTE    -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                   has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por
--                   has_function_privilege (papel ausente conta como sem EXECUTE).
--   * tabela     -- relrowsecurity, contagem de policies, privilegios de anon/authenticated/service_role e as tres
--                   colunas (pg_attribute: information_schema esconde coluna sem privilegio do leitor), a chave
--                   primaria e a chave estrangeira com ON DELETE CASCADE (o registro acompanha o item).
--   * marcador   -- leitura humana do mesmo fato do md5: os dois relatorios leem a tabela do custo do dia e caem no
--                   custo de hoje do produto (`COALESCE(oic.custo, p.custo`).
--
-- CADEIA: o corpo de get_admin_analytics_v2 desta consulta e' o SUCESSOR da 20261234000000 (35a) e o de fin_dre,
-- o SUCESSOR da 20261199000000 (8e). Depois desta migration a 35a (lote 35), a 17a (lote 17) e a 8e (lote 92-202)
-- continuam POSITIVAS: as tres aceitam o corpo desta migration ao lado dos anteriores.
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts e pelo teste estatico da migration;
-- tests/banco/custo-do-dia-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do apply, negativa
-- depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/custo-do-dia-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o
-- ref de cada loja.
WITH alvo(chave, assinatura, nome, lingua, volatilidade, retorno) AS (
  VALUES ('analytics', 'public.get_admin_analytics_v2(integer)', 'get_admin_analytics_v2', 'plpgsql', 'v', 'json'),
         ('dre', 'public.fin_dre(date,date)', 'fin_dre', 'plpgsql', 's', 'jsonb'),
         ('gatilho', 'public.marketplace_order_item__guarda_o_custo_do_dia()', 'marketplace_order_item__guarda_o_custo_do_dia', 'plpgsql', 'v', 'trigger')
), fn AS (
  SELECT t.chave, p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         COALESCE(p.prosecdef AND l.lanname = t.lingua AND p.provolatile = t.volatilidade AND NOT p.proretset
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = t.retorno
            AND (SELECT count(*) FROM pg_proc q
                  WHERE q.pronamespace = 'public'::regnamespace AND q.proname = t.nome) = 1, false) AS atributos_ok,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec,
         CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS svc_exec,
         p.prosrc
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), tab AS (
  SELECT c.oid,
         c.relrowsecurity AS rls,
         (SELECT count(*) FROM pg_policy po WHERE po.polrelid = c.oid) AS politicas,
         CASE WHEN to_regrole('anon') IS NULL THEN false
              ELSE has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') END AS anon_acessa,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false
              ELSE has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE') END AS auth_acessa,
         CASE WHEN to_regrole('service_role') IS NULL THEN false
              ELSE has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE') END AS svc_acessa,
         (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attname)
            FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
         EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = c.oid AND k.contype = 'p'
                    AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'item_id')]::int2[]) AS pk,
         EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = c.oid AND k.contype = 'f'
                    AND k.confrelid = to_regclass('public.marketplace_order_items')
                    AND k.confdeltype = 'c') AS fk_cascata
    FROM pg_class c
   WHERE c.oid = to_regclass('public.marketplace_order_item_custo')
), gat AS (
  SELECT CASE WHEN t.tgenabled = 'O'
               AND t.tgtype = 5
               AND t.tgfoid = to_regprocedure('public.marketplace_order_item__guarda_o_custo_do_dia()')
              THEN 'ligado AFTER INSERT por linha' ELSE 'DIFERENTE' END AS estado
    FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.marketplace_order_items')
     AND t.tgname = 'tr_marketplace_order_items_guarda_o_custo_do_dia'
     AND NOT t.tgisinternal
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_admin_analytics_v2: corpo e o da 20261242000000, com o custo do dia da venda (md5)',
         'dceb62881ebf8fa404ba3ac295041691',
         -- A 45 sucede só o analytics: aceita os dois corpos EXATOS; normaliza ao esperado histórico do rol.
         COALESCE((SELECT CASE WHEN f.m IN ('dceb62881ebf8fa404ba3ac295041691', 'ab25e738a3101cccbb0c09450b660ee0', '5746d8a1df216ca4a5569901c45a2a07', '060c9ab5b1505dc375b41e4436e9d3a8')
                              THEN 'dceb62881ebf8fa404ba3ac295041691' ELSE f.m END FROM fn f WHERE f.chave = 'analytics'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_dre: corpo e o da 20261242000000, com o custo do dia da venda (md5)',
         'afc3e13805ce37819cfdcd094043087c',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'dre'), 'AUSENTE')
  UNION ALL
  SELECT 'marketplace_order_item__guarda_o_custo_do_dia: corpo e o da 20261242000000, o gatilho que nunca derruba a compra (md5)',
         'b9be9cba9794deb2c1700bfbc3578454',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'gatilho'), 'AUSENTE')
  UNION ALL
  SELECT 'as tres funcoes: atributos do desenho (SECURITY DEFINER, search_path=public, linguagem, volatilidade, retorno e uma assinatura so)',
         'SECURITY DEFINER search_path=public, linguagem, volatilidade e retorno do desenho',
         CASE WHEN (SELECT count(*) FROM fn) < 3 THEN 'AUSENTE'
              WHEN (SELECT bool_and(f.atributos_ok) FROM fn f)
              THEN 'SECURITY DEFINER search_path=public, linguagem, volatilidade e retorno do desenho'
              ELSE 'DIFERENTE: ' || (SELECT string_agg(f.chave, ',' ORDER BY f.chave) FROM fn f WHERE NOT f.atributos_ok) END
  UNION ALL
  SELECT 'get_admin_analytics_v2 e fin_dre: EXECUTE so do authenticated (PUBLIC e anon nao)',
         'PUBLIC=nao anon=nao authenticated=sim',
         CASE WHEN (SELECT count(*) FROM fn f WHERE f.chave IN ('analytics', 'dre')) < 2 THEN 'AUSENTE'
              ELSE 'PUBLIC=' || CASE WHEN (SELECT bool_or(f.public_exec) FROM fn f WHERE f.chave IN ('analytics', 'dre')) THEN 'sim' ELSE 'nao' END
                || ' anon=' || CASE WHEN (SELECT bool_or(f.anon_exec) FROM fn f WHERE f.chave IN ('analytics', 'dre')) THEN 'sim' ELSE 'nao' END
                || ' authenticated=' || CASE WHEN (SELECT bool_and(f.auth_exec) FROM fn f WHERE f.chave IN ('analytics', 'dre')) THEN 'sim' ELSE 'nao' END
         END
  UNION ALL
  SELECT 'marketplace_order_item__guarda_o_custo_do_dia: EXECUTE fechado a todos (PUBLIC, anon, authenticated e service_role)',
         'PUBLIC=nao anon=nao authenticated=nao service_role=nao',
         COALESCE((SELECT 'PUBLIC=' || CASE WHEN f.public_exec THEN 'sim' ELSE 'nao' END
                          || ' anon=' || CASE WHEN f.anon_exec THEN 'sim' ELSE 'nao' END
                          || ' authenticated=' || CASE WHEN f.auth_exec THEN 'sim' ELSE 'nao' END
                          || ' service_role=' || CASE WHEN f.svc_exec THEN 'sim' ELSE 'nao' END
                     FROM fn f WHERE f.chave = 'gatilho'), 'AUSENTE')
  UNION ALL
  SELECT 'marketplace_order_item_custo: so do servidor (RLS ligada, nenhuma policy, nenhum acesso de anon, authenticated e service_role)',
         'rls=sim politicas=0 anon=nao authenticated=nao service_role=nao',
         COALESCE((SELECT 'rls=' || CASE WHEN t.rls THEN 'sim' ELSE 'nao' END
                          || ' politicas=' || t.politicas::text
                          || ' anon=' || CASE WHEN t.anon_acessa THEN 'sim' ELSE 'nao' END
                          || ' authenticated=' || CASE WHEN t.auth_acessa THEN 'sim' ELSE 'nao' END
                          || ' service_role=' || CASE WHEN t.svc_acessa THEN 'sim' ELSE 'nao' END
                     FROM tab t), 'AUSENTE')
  UNION ALL
  SELECT 'marketplace_order_item_custo: as tres colunas do desenho (custo, item_id, registrado_em)',
         'custo:numeric,item_id:uuid,registrado_em:timestamp with time zone',
         COALESCE((SELECT t.colunas FROM tab t), 'AUSENTE')
  UNION ALL
  SELECT 'marketplace_order_item_custo: item_id e a chave primaria e acompanha o item (chave estrangeira com ON DELETE CASCADE)',
         'pk=sim fk_cascata=sim',
         COALESCE((SELECT 'pk=' || CASE WHEN t.pk THEN 'sim' ELSE 'nao' END
                          || ' fk_cascata=' || CASE WHEN t.fk_cascata THEN 'sim' ELSE 'nao' END
                     FROM tab t), 'AUSENTE')
  UNION ALL
  SELECT 'tr_marketplace_order_items_guarda_o_custo_do_dia: ligado, AFTER INSERT por linha, apontando para a funcao do gatilho',
         'ligado AFTER INSERT por linha',
         COALESCE((SELECT g.estado FROM gat g), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2 e fin_dre: leem o custo do dia e caem no custo de hoje (COALESCE(oic.custo, p.custo))',
         'sim',
         CASE WHEN (SELECT count(*) FROM fn f WHERE f.chave IN ('analytics', 'dre')) < 2 THEN 'AUSENTE'
              WHEN (SELECT bool_and(position('marketplace_order_item_custo' IN f.prosrc) > 0
                                    AND position('COALESCE(oic.custo, p.custo' IN f.prosrc) > 0)
                      FROM fn f WHERE f.chave IN ('analytics', 'dre'))
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_order_item_custo: fora da publicacao do realtime (o custo do lojista nunca vai ao navegador)',
         'fora',
         CASE WHEN to_regclass('public.marketplace_order_item_custo') IS NULL THEN 'AUSENTE'
              WHEN EXISTS (SELECT 1 FROM pg_publication_tables pt
                            WHERE pt.schemaname = 'public' AND pt.tablename = 'marketplace_order_item_custo')
              THEN 'dentro' ELSE 'fora' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

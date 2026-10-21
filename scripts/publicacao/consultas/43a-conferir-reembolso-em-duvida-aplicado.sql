-- 43a — DEPOIS de aplicar a migration 20261241000000 (o reembolso em duvida prende o saldo: a regra UNICA
-- `order_refund__pode_ter_saido`, a tabela de marcas `order_refund_prova`, o saldo que desconta o "em duvida", as
-- saidas dos 7 dias, a leitura do painel `pedido_reembolsos_e_saldo` e o EXECUTE da funcao antiga
-- `admin_devolucao_reemitir_reembolso` fechado ao logado): confirma, POR OBJETO, que o corpo vivo de CADA uma das
-- SETE funcoes reescritas e das CINCO novas e o desta migration (md5), que os atributos sao os desenhados, que o
-- EXECUTE esta como deve (as duas regras do servidor fechadas a todos, inclusive service_role; as tres portas novas so do
-- authenticated; a antiga fechada ao logado) e que a tabela de marcas e' so do servidor. E' a consulta do lote em
-- `provasDeObjetos` de scripts/frota/canais-de-backend.json; a de ausencia e' a 43b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_class, pg_attribute, pg_policy,
-- aclexplode): nenhuma linha de pedido, de reembolso, de devolucao ou de marca e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 21 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = o
-- lote esta aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual reprovam todas menos o
-- controle.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261241000000.
--   * atributos  -- SECURITY DEFINER + `search_path=public` nas DOZE, com a linguagem e a volatilidade de cada uma
--                   (sql STABLE: a regra unica, a espera dos 7 dias e o saldo; plpgsql STABLE: a leitura do painel; plpgsql VOLATILE: as
--                   outras oito). A lista L8 (portas-do-visitante-permitidas.json) reprova se o tipo mudar.
--   * EXECUTE    -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                   has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por
--                   has_function_privilege (papel ausente conta como sem EXECUTE).
--   * tabela     -- relrowsecurity, contagem de policies, privilegios de anon/authenticated/service_role e as tres
--                   colunas (pg_attribute: information_schema esconde coluna sem privilegio do leitor).
--   * marcador   -- leitura humana do mesmo fato do md5: o corpo do saldo chama a regra unica e respeita a marca de
--                   substituida por manual; as duas saidas dos 7 dias e o painel leem a MESMA espera
--                   (order_refund__liberavel_apos_espera). O campo do painel diz so que a ESPERA passou: a
--                   porta ainda pode recusar por outro motivo, e o front mostra a RESPOSTA da porta.
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts e pelo teste estatico da migration;
-- tests/banco/reembolso-em-duvida-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do apply,
-- negativa depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/reembolso-em-duvida-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta
-- contra o ref de cada loja.
WITH alvo(chave, assinatura, lingua, volatilidade, hash_desta) AS (
  VALUES ('pode', 'public.order_refund__pode_ter_saido(uuid)', 'sql', 's', 'bdbb28b3d91588c8b10283d57bfb73d6'),
         ('espera', 'public.order_refund__liberavel_apos_espera(uuid)', 'sql', 's', 'cb37f24646fda24e1a51c8f01983e083'),
         ('saldo', 'public.pedido__saldo_a_estornar(uuid)', 'sql', 's', '99741b4cdbf1e8d8340f80440e6da094'),
         ('solicitar', 'public.solicitar_estorno(uuid,numeric,text)', 'plpgsql', 'v', '840de50f44958fe43b55f5222691df9b'),
         ('concluir', 'public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', 'plpgsql', 'v', 'ebb901efff59a53082836a13e053cd1a'),
         ('autorizar', 'public.autorizar_post_do_estorno(uuid,numeric)', 'plpgsql', 'v', 'c73e48294c08f34240abc3843aa7d1f1'),
         ('reemitir', 'public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)', 'plpgsql', 'v', 'fd5d79042efa68f9a17298fff1e950bd'),
         ('porfora', 'public.admin_devolucao_reembolso_por_fora(uuid,uuid)', 'plpgsql', 'v', '76eaffb4f9438f7fe557961e1bdaad81'),
         ('avisa', 'public.devolucao_avisa_o_cliente()', 'plpgsql', 'v', '56502b960dcf3e136c1d0d5c41091c20'),
         ('esperadev', 'public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)', 'plpgsql', 'v', '92dd1608d02ef5e9fd9fe34e0bd7c49f'),
         ('esperaped', 'public.registrar_estorno_manual_apos_espera(uuid,uuid,text)', 'plpgsql', 'v', '7b1403e418b2d80d02db287444f8a0ef'),
         ('painel', 'public.pedido_reembolsos_e_saldo(uuid)', 'plpgsql', 's', '86dd0eaaaa571a4d5e85622e90442bc0')
), fn AS (
  SELECT t.chave, p.oid,
         -- A 343 preserva a regra da 241 e a estende ao reembolso manual.
         CASE WHEN t.chave = 'concluir' AND md5(replace(p.prosrc, chr(13), '')) = 'ea651d52157521c0fe7ffccc948b4b1a'
           THEN t.hash_desta ELSE md5(replace(p.prosrc, chr(13), '')) END AS m,
         (p.prosecdef AND l.lanname = t.lingua AND p.provolatile = t.volatilidade AND NOT p.proretset
            AND p.proconfig = ARRAY['search_path=public']::text[]) AS atributos_ok,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec,
         CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS svc_exec,
         p.prosrc
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), antiga AS (
  SELECT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.admin_devolucao_reemitir_reembolso(uuid,boolean)')
), tab AS (
  SELECT c.relrowsecurity AS rls,
         (SELECT count(*) FROM pg_policy po WHERE po.polrelid = c.oid) AS politicas,
         CASE WHEN to_regrole('anon') IS NULL THEN false
              ELSE has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') END AS anon_acessa,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false
              ELSE has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE') END AS auth_acessa,
         CASE WHEN to_regrole('service_role') IS NULL THEN false
              ELSE has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE') END AS svc_acessa,
         (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attname)
            FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas
    FROM pg_class c
   WHERE c.oid = to_regclass('public.order_refund_prova')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'order_refund__pode_ter_saido: corpo e o da 20261241000000, a regra unica (md5)',
         'bdbb28b3d91588c8b10283d57bfb73d6',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'pode'), 'AUSENTE')
  UNION ALL
  SELECT 'order_refund__liberavel_apos_espera: corpo e o da 20261241000000, a espera dos 7 dias (md5)',
         'cb37f24646fda24e1a51c8f01983e083',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'espera'), 'AUSENTE')
  UNION ALL
  SELECT 'pedido__saldo_a_estornar: corpo e o da 20261241000000, com o em duvida (md5)',
         '99741b4cdbf1e8d8340f80440e6da094',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'saldo'), 'AUSENTE')
  UNION ALL
  SELECT 'solicitar_estorno: corpo e o da 20261241000000, a conta pela funcao de saldo (md5)',
         '840de50f44958fe43b55f5222691df9b',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'solicitar'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_devolucao_concluir: corpo e o da 20261241000000, o ramo do app pela funcao de saldo (md5)',
         'ebb901efff59a53082836a13e053cd1a',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'concluir'), 'AUSENTE')
  UNION ALL
  SELECT 'autorizar_post_do_estorno: corpo e o da 20261241000000, recusa a linha liberada por fora (md5)',
         'c73e48294c08f34240abc3843aa7d1f1',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'autorizar'), 'AUSENTE')
  UNION ALL
  SELECT 'reemitir_reembolso_da_devolucao: corpo e o da 20261241000000, pela regra unica (md5)',
         'fd5d79042efa68f9a17298fff1e950bd',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'reemitir'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_devolucao_reembolso_por_fora: corpo e o da 20261241000000, pela regra unica e marcando a substituida (md5)',
         '76eaffb4f9438f7fe557961e1bdaad81',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'porfora'), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao_avisa_o_cliente: corpo e o da 20261241000000, a loja esta confirmando com o Mercado Pago (md5)',
         '56502b960dcf3e136c1d0d5c41091c20',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'avisa'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_devolucao_reembolso_por_fora_apos_espera: corpo e o da 20261241000000 (md5)',
         '92dd1608d02ef5e9fd9fe34e0bd7c49f',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'esperadev'), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_estorno_manual_apos_espera: corpo e o da 20261241000000 (md5)',
         '7b1403e418b2d80d02db287444f8a0ef',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'esperaped'), 'AUSENTE')
  UNION ALL
  SELECT 'pedido_reembolsos_e_saldo: corpo e o da 20261241000000 (md5)',
         '86dd0eaaaa571a4d5e85622e90442bc0',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'painel'), 'AUSENTE')
  UNION ALL
  SELECT 'as doze funcoes: atributos do desenho (SECURITY DEFINER, search_path=public, linguagem e volatilidade de cada uma)',
         'SECURITY DEFINER search_path=public, linguagem e volatilidade do desenho',
         CASE WHEN (SELECT count(*) FROM fn) < 12 THEN 'AUSENTE'
              WHEN (SELECT bool_and(f.atributos_ok) FROM fn f)
              THEN 'SECURITY DEFINER search_path=public, linguagem e volatilidade do desenho'
              ELSE 'DIFERENTE: ' || (SELECT string_agg(f.chave, ',' ORDER BY f.chave) FROM fn f WHERE NOT f.atributos_ok) END
  UNION ALL
  SELECT 'as duas regras do servidor (pode_ter_saido e liberavel_apos_espera): EXECUTE fechado a todos (PUBLIC, anon, authenticated e service_role)',
         'PUBLIC=nao anon=nao authenticated=nao service_role=nao',
         CASE WHEN (SELECT count(*) FROM fn f WHERE f.chave IN ('pode', 'espera')) < 2 THEN 'AUSENTE'
              ELSE 'PUBLIC=' || CASE WHEN (SELECT bool_or(f.public_exec) FROM fn f WHERE f.chave IN ('pode', 'espera')) THEN 'sim' ELSE 'nao' END
                || ' anon=' || CASE WHEN (SELECT bool_or(f.anon_exec) FROM fn f WHERE f.chave IN ('pode', 'espera')) THEN 'sim' ELSE 'nao' END
                || ' authenticated=' || CASE WHEN (SELECT bool_or(f.auth_exec) FROM fn f WHERE f.chave IN ('pode', 'espera')) THEN 'sim' ELSE 'nao' END
                || ' service_role=' || CASE WHEN (SELECT bool_or(f.svc_exec) FROM fn f WHERE f.chave IN ('pode', 'espera')) THEN 'sim' ELSE 'nao' END
         END
  UNION ALL
  SELECT 'as tres portas novas do lojista: EXECUTE so do authenticated (PUBLIC e anon nao)',
         'PUBLIC=nao anon=nao authenticated=sim',
         CASE WHEN (SELECT count(*) FROM fn f WHERE f.chave IN ('esperadev', 'esperaped', 'painel')) < 3 THEN 'AUSENTE'
              ELSE 'PUBLIC=' || CASE WHEN (SELECT bool_or(f.public_exec) FROM fn f WHERE f.chave IN ('esperadev', 'esperaped', 'painel')) THEN 'sim' ELSE 'nao' END
                || ' anon=' || CASE WHEN (SELECT bool_or(f.anon_exec) FROM fn f WHERE f.chave IN ('esperadev', 'esperaped', 'painel')) THEN 'sim' ELSE 'nao' END
                || ' authenticated=' || CASE WHEN (SELECT bool_and(f.auth_exec) FROM fn f WHERE f.chave IN ('esperadev', 'esperaped', 'painel')) THEN 'sim' ELSE 'nao' END
         END
  UNION ALL
  SELECT 'admin_devolucao_reemitir_reembolso: EXECUTE fechado ao logado e ao visitante (a antiga, sem chamador)',
         'PUBLIC=nao anon=nao authenticated=nao',
         COALESCE((SELECT 'PUBLIC=' || CASE WHEN a.public_exec THEN 'sim' ELSE 'nao' END
                          || ' anon=' || CASE WHEN a.anon_exec THEN 'sim' ELSE 'nao' END
                          || ' authenticated=' || CASE WHEN a.auth_exec THEN 'sim' ELSE 'nao' END
                     FROM antiga a), 'AUSENTE')
  UNION ALL
  SELECT 'order_refund_prova: so do servidor (RLS ligada, nenhuma policy, nenhum acesso de anon, authenticated e service_role)',
         'rls=sim politicas=0 anon=nao authenticated=nao service_role=nao',
         COALESCE((SELECT 'rls=' || CASE WHEN t.rls THEN 'sim' ELSE 'nao' END
                          || ' politicas=' || t.politicas::text
                          || ' anon=' || CASE WHEN t.anon_acessa THEN 'sim' ELSE 'nao' END
                          || ' authenticated=' || CASE WHEN t.auth_acessa THEN 'sim' ELSE 'nao' END
                          || ' service_role=' || CASE WHEN t.svc_acessa THEN 'sim' ELSE 'nao' END
                     FROM tab t), 'AUSENTE')
  UNION ALL
  SELECT 'order_refund_prova: as tres colunas do desenho (refund_id, substituida_por_manual_em, por_fora_liberado_em)',
         'por_fora_liberado_em:timestamp with time zone,refund_id:uuid,substituida_por_manual_em:timestamp with time zone',
         COALESCE((SELECT t.colunas FROM tab t), 'AUSENTE')
  UNION ALL
  SELECT 'pedido__saldo_a_estornar: desconta o em duvida pela regra unica e respeita a substituida por manual',
         'sim',
         COALESCE((SELECT CASE WHEN position('order_refund__pode_ter_saido' IN f.prosrc) > 0
                                AND position('pv.substituida_por_manual_em IS NOT NULL' IN f.prosrc) > 0
                               THEN 'sim' ELSE 'nao' END
                     FROM fn f WHERE f.chave = 'saldo'), 'AUSENTE')
  UNION ALL
  SELECT 'as duas saidas dos 7 dias e o painel: a mesma espera (order_refund__liberavel_apos_espera)',
         'sim',
         CASE WHEN (SELECT count(*) FROM fn f WHERE f.chave IN ('esperadev', 'esperaped', 'painel')) < 3 THEN 'AUSENTE'
              WHEN (SELECT bool_and(position('order_refund__liberavel_apos_espera' IN f.prosrc) > 0)
                      FROM fn f WHERE f.chave IN ('esperadev', 'esperaped', 'painel'))
              THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

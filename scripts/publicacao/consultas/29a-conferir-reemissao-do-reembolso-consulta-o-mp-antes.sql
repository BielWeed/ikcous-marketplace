-- 29a — DEPOIS de aplicar a migration 20261226000000 (a reemissao do reembolso consulta o Mercado Pago antes de pagar
-- de novo): confirma, POR OBJETO, que as TRES funcoes novas estao vivas com o corpo da migration (md5): o diagnostico
-- do estorno (`registrar_diagnostico_do_estorno`), a reemissao so de servidor (`reemitir_reembolso_da_devolucao`) e
-- "Ja devolvi por fora" do lojista logado (`admin_devolucao_reembolso_por_fora`); que os atributos sao os de sempre
-- (SECURITY DEFINER, plpgsql, VOLATILE, `search_path=public`: a lista L8 reprova se o tipo ou o SECURITY DEFINER
-- mudarem); que o EXECUTE esta como deve (as duas de servidor SO do service_role; a do lojista SO do authenticated;
-- nenhuma alcancavel por PUBLIC ou anon); e que a tabela `order_refund_diagnostico` e' so do servidor (RLS ligada,
-- nenhuma policy, nenhum acesso de anon nem de authenticated). E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 29b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_class, pg_policy, aclexplode):
-- nenhuma linha de devolucao, de reembolso ou de diagnostico e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 9 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = o
-- corte esta aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual reprovam as linhas dos
-- corpos, dos atributos, do EXECUTE e da tabela.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF). SUCESSORA (15/10/2026): a
--                   20261241000000 (o reembolso em duvida prende o saldo) reescreve `reemitir_reembolso_da_devolucao`
--                   e `admin_devolucao_reembolso_por_fora` (as duas passam a decidir pela regra unica
--                   `order_refund__pode_ter_saido`, que le o mesmo diagnostico); a linha do corpo de cada uma aceita o
--                   md5 da 20261226000000 OU o da 20261241000000 (aceito, o `vivo` mostra o `esperado`), para a 29a
--                   seguir POSITIVA depois do apply da sucessora. Corpo estranho reprova igual; o EXECUTE e os
--                   atributos seguem exatos (a sucessora nao os muda).
--   * atributos  -- SECURITY DEFINER + plpgsql + VOLATILE + proconfig = {search_path=public}, nas TRES funcoes.
--   * EXECUTE    -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                   has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role
--                   por has_function_privilege.
--   * tabela     -- relrowsecurity, contagem de policies e privilegios de anon/authenticated.
--   * decisao    -- leitura humana do mesmo fato do md5: o corpo da reemissao decide pelo diagnostico
--                   (`order_refund_diagnostico`) e pela consulta ao MP (`nao_achou`) e confere o ator nas DUAS fontes
--                   (auth.users e profiles).
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts, e
-- tests/banco/reemissao-do-reembolso-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do
-- apply, negativa depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/reemissao-do-reembolso-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
WITH alvo(chave, assinatura) AS (
  VALUES ('diagnostico', 'public.registrar_diagnostico_do_estorno(uuid,text,boolean,boolean)'),
         ('reemitir', 'public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)'),
         ('porfora', 'public.admin_devolucao_reembolso_por_fora(uuid,uuid)')
), fn AS (
  SELECT t.chave, p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         (p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
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
), tab AS (
  SELECT c.relrowsecurity AS rls,
         (SELECT count(*) FROM pg_policy po WHERE po.polrelid = c.oid) AS politicas,
         CASE WHEN to_regrole('anon') IS NULL THEN false
              ELSE has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') END AS anon_acessa,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false
              ELSE has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE') END AS auth_acessa
    FROM pg_class c
   WHERE c.oid = to_regclass('public.order_refund_diagnostico')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'registrar_diagnostico_do_estorno: corpo e o da 20261226000000 (md5)',
         'b8e4e28fbcd23a32dac0d18823b8aefe',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'diagnostico'), 'AUSENTE')
  UNION ALL
  SELECT 'reemitir_reembolso_da_devolucao: corpo e o da 20261226000000 (md5)',
         '872fcb1d2bac9816e2d2b1c7c2e868c0',
         COALESCE((SELECT CASE WHEN f.m IN ('872fcb1d2bac9816e2d2b1c7c2e868c0',
                                            'fd5d79042efa68f9a17298fff1e950bd')
                               THEN '872fcb1d2bac9816e2d2b1c7c2e868c0' ELSE f.m END
                     FROM fn f WHERE f.chave = 'reemitir'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_devolucao_reembolso_por_fora: corpo e o da 20261226000000 (md5)',
         '0a7e06d7004c3fb70897e87c4dfa8cf9',
         COALESCE((SELECT CASE WHEN f.m IN ('0a7e06d7004c3fb70897e87c4dfa8cf9',
                                            '76eaffb4f9438f7fe557961e1bdaad81')
                               THEN '0a7e06d7004c3fb70897e87c4dfa8cf9' ELSE f.m END
                     FROM fn f WHERE f.chave = 'porfora'), 'AUSENTE')
  UNION ALL
  SELECT 'as tres funcoes: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public',
         CASE WHEN (SELECT count(*) FROM fn) < 3 THEN 'AUSENTE'
              WHEN (SELECT bool_and(atributos_ok) FROM fn)
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public' ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'as duas funcoes de servidor: EXECUTE so do service_role (PUBLIC, anon e authenticated nao)',
         'PUBLIC=nao anon=nao authenticated=nao service_role=sim',
         CASE WHEN (SELECT count(*) FROM fn WHERE chave IN ('diagnostico', 'reemitir')) < 2 THEN 'AUSENTE'
              ELSE 'PUBLIC=' || CASE WHEN (SELECT bool_or(public_exec) FROM fn WHERE chave IN ('diagnostico', 'reemitir')) THEN 'sim' ELSE 'nao' END
                || ' anon=' || CASE WHEN (SELECT bool_or(anon_exec) FROM fn WHERE chave IN ('diagnostico', 'reemitir')) THEN 'sim' ELSE 'nao' END
                || ' authenticated=' || CASE WHEN (SELECT bool_or(auth_exec) FROM fn WHERE chave IN ('diagnostico', 'reemitir')) THEN 'sim' ELSE 'nao' END
                || ' service_role=' || CASE WHEN (SELECT bool_and(svc_exec) FROM fn WHERE chave IN ('diagnostico', 'reemitir')) THEN 'sim' ELSE 'nao' END
         END
  UNION ALL
  SELECT 'admin_devolucao_reembolso_por_fora: EXECUTE so do authenticated (PUBLIC e anon nao)',
         'PUBLIC=nao anon=nao authenticated=sim',
         COALESCE((SELECT 'PUBLIC=' || CASE WHEN f.public_exec THEN 'sim' ELSE 'nao' END
                          || ' anon=' || CASE WHEN f.anon_exec THEN 'sim' ELSE 'nao' END
                          || ' authenticated=' || CASE WHEN f.auth_exec THEN 'sim' ELSE 'nao' END
                     FROM fn f WHERE f.chave = 'porfora'), 'AUSENTE')
  UNION ALL
  SELECT 'order_refund_diagnostico: so do servidor (RLS ligada, nenhuma policy, nenhum acesso de anon e authenticated)',
         'rls=sim politicas=0 anon=nao authenticated=nao',
         COALESCE((SELECT 'rls=' || CASE WHEN t.rls THEN 'sim' ELSE 'nao' END
                          || ' politicas=' || t.politicas::text
                          || ' anon=' || CASE WHEN t.anon_acessa THEN 'sim' ELSE 'nao' END
                          || ' authenticated=' || CASE WHEN t.auth_acessa THEN 'sim' ELSE 'nao' END
                     FROM tab t), 'AUSENTE')
  UNION ALL
  SELECT 'reemitir_reembolso_da_devolucao: decide pelo diagnostico e pela consulta do MP e confere o ator nas duas fontes',
         'sim',
         COALESCE((SELECT CASE WHEN position('order_refund_diagnostico' IN f.prosrc) > 0
                                AND position('nao_achou' IN f.prosrc) > 0
                                AND position('auth.users' IN f.prosrc) > 0
                                AND position('public.profiles' IN f.prosrc) > 0
                               THEN 'sim' ELSE 'nao' END
                     FROM fn f WHERE f.chave = 'reemitir'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

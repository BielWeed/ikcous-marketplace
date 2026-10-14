-- 30a — DEPOIS de aplicar as migrations 20261227000000 e 20261228000000 (os numeros do painel: a taxa de
-- devolucao do CRM fala da MESMA turma de vendas e nunca passa de 100%; o "Hoje" do Inicio e o "vs. ontem"
-- do CRM comparam ate a MESMA hora do dia): confirma, POR OBJETO, que o corpo vivo de cada uma das DUAS
-- funcoes e o NOVO (md5), que cada uma mantem os atributos de sempre (SECURITY DEFINER, plpgsql, STABLE,
-- `search_path=public`) e que a ACL segue a de sempre (PUBLIC e anon sem EXECUTE; authenticated e
-- service_role com). E' a consulta do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json;
-- a de ausencia e' a 30b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode): nenhuma linha
-- de pedido, de devolucao ou de cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 9 linhas, as
-- mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma
-- linha). Tudo `true` = o corte esta aplicado; qualquer `false` = PARE e leia a linha. Depois do
-- rollback-manual de uma das duas reprovam SO as duas linhas do corpo dela (md5 e marcador).
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261227000000
--                (crm_visao) e o da 20261228000000 (painel_inicio).
--   * marcador -- 'sim' se o corpo traz o corte na mesma hora (`::time <= v_hora`, que so existe nos
--                corpos novos): leitura humana do mesmo fato do md5. No crm_visao, tambem a CTE `turma`
--                (a turma de vendas da taxa de devolucao).
--   * atributos -- SECURITY DEFINER + plpgsql + STABLE + proconfig = {search_path=public}.
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e
--                service_role por has_function_privilege. (A ACL ja e' a das duas funcoes desde a
--                20261199000000; aqui ela confirma que os corpos novos nao a mexeram.)
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts e pelos testes
-- estaticos tests/migration_o_crm_compara_o_que_e_comparavel_test.ts e
-- tests/migration_o_inicio_compara_ate_a_mesma_hora_test.ts; tests/banco/numeros-do-painel-portao-viva.cjs
-- roda esta consulta num Postgres real (positiva depois do apply, negativa depois de cada rollback, um
-- negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/numeros-do-painel-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
WITH alvo(chave, assinatura) AS (
  VALUES ('crm', 'public.crm_visao(date,date)'),
         ('painel', 'public.painel_inicio()')
), fn AS (
  SELECT t.chave,
         p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('::time <= v_hora' IN p.prosrc) > 0
                   AND (t.chave <> 'crm' OR position('turma AS (' IN p.prosrc) > 0)
              THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 's'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
              THEN 'SECURITY DEFINER plpgsql STABLE search_path=public' ELSE 'DIFERENTE' END AS atributos,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' service_role=' || CASE WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
                                          WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'crm_visao: corpo e o da 20261227000000, com a taxa da turma e o corte na mesma hora (md5)',
         'c33073503fccc6caa5f1085265501eae',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_visao: o corpo traz a turma de vendas e o corte na mesma hora',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_visao: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)',
         'SECURITY DEFINER plpgsql STABLE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_visao: EXECUTE fechado para anon (authenticated e service_role sim)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: corpo e o da 20261228000000, com a semana passada cortada na mesma hora (md5)',
         'ad5620273997ba9266f240f272bf399b',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'painel'), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: o corpo traz o corte na mesma hora',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'painel'), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)',
         'SECURITY DEFINER plpgsql STABLE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'painel'), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: EXECUTE fechado para anon (authenticated e service_role sim)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.chave = 'painel'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

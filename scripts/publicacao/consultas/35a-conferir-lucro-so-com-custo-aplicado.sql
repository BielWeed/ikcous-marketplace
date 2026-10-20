-- 35a — DEPOIS de aplicar a migration 20261234000000 (o lucro so conta produto com custo: o grafico "Lucro
-- acumulado" e o "Top 5 produtos mais lucrativos" do CRM > Visao geral deixam de tratar produto SEM custo como
-- margem de 100%, e o JSON ganha `productsWithoutCost`): confirma, POR OBJETO, que o corpo vivo de
-- `get_admin_analytics_v2(integer)` e o NOVO (md5), que traz a regra nova, que mantem os atributos de sempre
-- (SECURITY DEFINER, plpgsql, search_path=public, VOLATILE) e que a ACL segue a de sempre (PUBLIC e anon sem
-- EXECUTE; authenticated com). E' a consulta do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json; a
-- de ausencia e' a 35b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode): nenhuma linha de
-- produto, de pedido ou de cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas
-- em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo
-- `true` = o lucro novo esta aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual
-- reprovam SO as duas linhas do corpo (md5 e marcador).
--
--   * sobrecargas -- UMA funcao com esse nome em `public`.
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261234000000.
--   * marcador -- 'sim' se o corpo traz a regra nova: o filtro do lucro por dia
--                (`FILTER (WHERE p.custo IS NOT NULL), 0) AS profit`) e a chave `productsWithoutCost`. Leitura humana
--                do mesmo fato do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + `search_path=public` + retorno json.
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                has_function_privilege nao tem o pseudo-papel PUBLIC; anon e authenticated por
--                has_function_privilege. O EXECUTE de service_role nao e' medido (nenhuma migration o fixa; o
--                CREATE OR REPLACE o preserva).
--
-- CADEIA: o corpo desta consulta e' o SUCESSOR da 20261214000000 (lote 17: o lucro do estoque so conta produto
-- com custo). Depois desta migration a 17a (lote 17) e a 8e (lote 92-202) continuam POSITIVAS: as duas aceitam
-- este corpo ao lado do da 20261214000000.
-- JA DECIDIDO (15/10/2026): a 20261242000000 (o lucro usa o custo do dia da venda) redefine o corpo DEPOIS desta
-- migration. A linha do md5 aceita o corpo da 34 OU o da 42 (o rol e os rotulos nao mudam) e o marcador aceita as
-- duas formas do filtro do lucro: uma loja que ja recebeu a 42 nao deixa o portao do lote 35 vermelho.
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts e pelo teste estatico
-- tests/migration_o_lucro_so_conta_produto_com_custo_test.ts; tests/banco/lucro-so-com-custo-portao-viva.cjs roda esta
-- consulta num Postgres real (positiva depois do apply, negativa depois do rollback, um negativo por linha).
-- LIMITES: nao prova o COMPORTAMENTO (isso e' de tests/banco/lucro-so-com-custo-viva.cjs). Evidencia LOCAL nao prova a
-- IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.get_admin_analytics_v2(integer)')
), fn AS (
  SELECT p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'get_admin_analytics_v2') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN (position('FILTER (WHERE p.custo IS NOT NULL), 0) AS profit' IN p.prosrc) > 0
                    OR position('FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit' IN p.prosrc) > 0)
                   AND position('''productsWithoutCost'', products_without_cost' IN p.prosrc) > 0
              THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
                   AND p.prorettype = 'json'::regtype
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public -> json'
              ELSE 'DIFERENTE' END AS atributos,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_admin_analytics_v2: sobrecargas', '1',
         COALESCE((SELECT f.sobrecargas::text FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2: corpo e o da 20261234000000, com o lucro so de produto com custo (md5)',
         '05eac70f6bd4360c1f71fd373747ad0e',
         -- aceita tambem o corpo da SUCESSORA 20261242000000 (o lucro usa o custo do dia da venda): o `vivo` mostra o esperado
         COALESCE((SELECT CASE WHEN f.m IN ('05eac70f6bd4360c1f71fd373747ad0e', 'dceb62881ebf8fa404ba3ac295041691', 'ab25e738a3101cccbb0c09450b660ee0', '5746d8a1df216ca4a5569901c45a2a07', '060c9ab5b1505dc375b41e4436e9d3a8')
                               THEN '05eac70f6bd4360c1f71fd373747ad0e' ELSE f.m END
                     FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2: o corpo so soma lucro de produto com custo e conta os sem custo',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public -> json',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2: EXECUTE fechado para anon (authenticated sim)',
         'PUBLIC=nao anon=nao authenticated=sim',
         COALESCE((SELECT f.acl FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

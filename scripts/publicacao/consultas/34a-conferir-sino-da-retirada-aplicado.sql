-- 34a — DEPOIS de aplicar a migration 20261233000000 (o sino do pedido de retirada fala de retirada): confirma,
-- POR OBJETO, que o corpo vivo de notifica_cliente_de_mudanca_de_status() e o NOVO (md5), que ele traz o texto da
-- retirada E ainda traz o da entrega (a troca so soma o ramo da retirada), que os atributos de sempre ficaram
-- (SECURITY DEFINER, plpgsql, VOLATILE, search_path=public, retorna trigger), que a trigger
-- tr_pedido_avisa_o_cliente segue ligada a ela (AFTER UPDATE OF status, por linha) e que a ACL segue a de hoje
-- (aberta por heranca do PUBLIC, como declara tests/banco/portas-do-visitante-permitidas.json). E' a consulta do
-- lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json; a de ausencia e' a 34b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_trigger, pg_attribute, pg_namespace, pg_language,
-- aclexplode): nenhuma linha de pedido, de cliente ou de notificacao e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 7 linhas, as mesmas em
-- qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = o
-- sino da retirada esta aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual reprovam SO as
-- duas linhas do corpo (md5 e marcador da retirada).
--
--   * corpo    -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261233000000.
--   * marcador -- 'sim' se o corpo traz o texto da retirada (`Pedido pronto para retirar`, `Pedido retirado` e o id
--                 `store-pickup`) / se ainda traz o da entrega (`Pedido a caminho` e `Pedido entregue`). Leitura
--                 humana do mesmo fato do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + `search_path=public` + retorno trigger + sem argumentos.
--   * trigger  -- a tr_pedido_avisa_o_cliente em marketplace_orders aponta para a funcao, e' AFTER UPDATE OF status
--                 por linha (tgtype 17, so a coluna status).
--   * EXECUTE  -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                 has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por
--                 has_function_privilege. A migration nao a mexe: ela e' a de hoje.
--
-- md5 recalculado do ARQUIVO da migration por tests/ci_conferir_banco_test.ts e pelo teste estatico
-- tests/migration_o_sino_do_pedido_de_retirada_fala_de_retirada_test.ts; tests/banco/o-sino-do-pedido-de-retirada-portao-viva.cjs
-- roda esta consulta num Postgres real (positiva depois do apply, negativa depois do rollback, um negativo por
-- linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de tests/banco/o-sino-do-pedido-de-retirada-viva.cjs). Evidencia
-- LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('Pedido pronto para retirar' IN p.prosrc) > 0
                   AND position('Pedido retirado' IN p.prosrc) > 0
                   AND position('store-pickup' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END AS marca_retirada,
         CASE WHEN position('Pedido a caminho' IN p.prosrc) > 0
                   AND position('Pedido entregue' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END AS marca_entrega,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset
                   AND p.proconfig = ARRAY['search_path=public']::text[]
                   AND pg_get_function_arguments(p.oid) = '' AND pg_get_function_result(p.oid) = 'trigger'
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public trigger'
              ELSE 'DIFERENTE' END AS atributos,
         CASE WHEN EXISTS (
                SELECT 1 FROM pg_trigger t
                 WHERE t.tgname = 'tr_pedido_avisa_o_cliente'
                   AND t.tgrelid = to_regclass('public.marketplace_orders')
                   AND t.tgfoid = p.oid AND NOT t.tgisinternal AND t.tgtype = 17
                   AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a
                                          WHERE a.attrelid = to_regclass('public.marketplace_orders')
                                            AND a.attname = 'status' AND NOT a.attisdropped))
              THEN 'AFTER UPDATE OF status por linha' ELSE 'DIFERENTE' END AS gatilho,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' service_role=' || CASE WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
                                          WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.notifica_cliente_de_mudanca_de_status()')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'notifica_cliente_de_mudanca_de_status: corpo e o da 20261233000000, com o texto da retirada (md5)',
         'fc8fd54a2fa1533f0d926744aab8ff58',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'notifica_cliente_de_mudanca_de_status: o corpo traz o texto da retirada',
         'sim',
         COALESCE((SELECT f.marca_retirada FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'notifica_cliente_de_mudanca_de_status: o corpo ainda traz o texto da entrega',
         'sim',
         COALESCE((SELECT f.marca_entrega FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'notifica_cliente_de_mudanca_de_status: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, trigger)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public trigger',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'tr_pedido_avisa_o_cliente: segue ligada a funcao (AFTER UPDATE OF status, por linha)',
         'AFTER UPDATE OF status por linha',
         COALESCE((SELECT f.gatilho FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'notifica_cliente_de_mudanca_de_status: EXECUTE como hoje (aberto por heranca do PUBLIC)',
         'PUBLIC=sim anon=sim authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

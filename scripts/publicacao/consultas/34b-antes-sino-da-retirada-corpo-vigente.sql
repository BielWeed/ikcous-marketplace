-- 34b — ANTES de aplicar a migration 20261233000000 (o sino do pedido de retirada fala de retirada): confirma, POR
-- OBJETO, a base de antes: notifica_cliente_de_mudanca_de_status() existe com o corpo VIGENTE (md5, o da
-- 20261026000000), SEM o texto da retirada, com os atributos de sempre, com a trigger tr_pedido_avisa_o_cliente
-- ligada a ela e com a ACL de hoje. E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em
-- `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 34a negativa so vira "aplique" se esta for
-- positiva (a loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_trigger, pg_attribute, pg_namespace, pg_language,
-- aclexplode): nenhuma linha de pedido, de cliente ou de notificacao e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas em
-- qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base de
-- antes; uma loja que JA tem a migration reprova aqui de proposito, nas linhas do corpo e do marcador.
--
--   * corpo    -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261026000000.
--   * marcador -- 'nao' se o texto da retirada NAO aparece no corpo (so o corpo novo o traz).
--   * atributos, trigger, EXECUTE -- os mesmos da 34a, antes da troca (a migration nao os mexe).
--
-- tests/banco/o-sino-do-pedido-de-retirada-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do
-- rollback, negativa depois do apply, um negativo por linha). O md5 do corpo de antes vem do ARQUIVO da migration
-- 20261026000000, nao de uma loja: o valor VIVO de cada loja so esta consulta mede.
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('Pedido pronto para retirar' IN p.prosrc) > 0
                   OR position('Pedido retirado' IN p.prosrc) > 0
                   OR position('store-pickup' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END AS marca_retirada,
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
  SELECT 'notifica_cliente_de_mudanca_de_status: corpo e o da 20261026000000, sem o texto da retirada (md5)',
         '7ace411aa5e184677d21d3b15ae94bf2',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'notifica_cliente_de_mudanca_de_status: o corpo ainda NAO traz o texto da retirada',
         'nao',
         COALESCE((SELECT f.marca_retirada FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'notifica_cliente_de_mudanca_de_status: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, trigger)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public trigger',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'tr_pedido_avisa_o_cliente: ligada a funcao (AFTER UPDATE OF status, por linha)',
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

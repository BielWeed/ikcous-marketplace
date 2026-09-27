-- 6a — Confere se as migrations 79 a 82 foram aplicadas com o corpo/ACL/dado
-- que cada uma promete. Mesmo desenho de 1a/1b (75-78) e 2a/2b (72-74),
-- condensado numa consulta só porque cada migration desta faixa mexe numa
-- coisa diferente (79: RPC de devolução; 80: RPC de pedido; 81: ACL de duas
-- RPCs de convidado; 82: dado). Usada como pré-checagem do ledger 79-82
-- (`conferir-banco.cjs`, `CONSULTAS_DA_PRE_CHECAGEM_DO_LEDGER`) e à mão pelo
-- coordenador (`consulta = 6a-conferir-79-a-82`).
--
-- `to_regprocedure('esquema.funcao(tipos)')` em vez de `proname` cru: um
-- subselect `WHERE proname = 'admin_devolucao_liberar_vinculo_reverso'`
-- devolveria MAIS DE UMA LINHA se o overload de 1 argumento (rodadas 2/3 da
-- 79, que o próprio arquivo dropa) sobrevivesse num banco aplicado fora de
-- ordem — e o Postgres reclamaria "more than one row returned by a subquery
-- used as an expression" em vez de dar um resultado. `to_regprocedure`
-- resolve para UM oid (ou NULL) pela assinatura exata, sempre.
--
-- 79 (runbook docs/runbooks/publicar-painel-cartao-devolucoes.md §7.2):
-- `admin_devolucao_liberar_vinculo_reverso(uuid,boolean)` existe; o corpo de
-- `cancelar_devolucao` e o da RPC nova batem md5(replace(prosrc, E'\r', ''))
-- com o que a 20261179000000 deixa; as duas são SECURITY DEFINER com
-- search_path fixo; a RPC nova sai de anon mas continua para authenticated.
-- 80: `update_order_status_atomic` bate com o corpo que a 20261180000000
-- deixa (o preflight dela mesma aceita esse hash ou o da 75 — aqui só o da
-- 80, porque esta consulta roda DEPOIS de a 80 estar aplicada).
-- 81 (bloco `DO $$ ... END $$` final da 20261181000000): `get_orders_by_
-- whatsapp_v3` sem EXECUTE para anon nem authenticated; `get_orders_by_
-- otp_v1` continua com EXECUTE para anon (a rota legítima de convidado).
-- 82: nenhum pedido deveria sobrar com a chave `cpf` dentro de
-- `customer_data.address` — só contagem, nunca projeta o CPF.
SELECT checagem, valor, esperado, COALESCE(valor = esperado, false) AS ok FROM (VALUES
  ('79 admin_devolucao_liberar_vinculo_reverso existe', (to_regprocedure('public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean)') IS NOT NULL)::text, 'true'),
  ('79 cancelar_devolucao: corpo novo', COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.cancelar_devolucao(uuid)')), '(função ausente)'), '74fd42d04f8ea55257a0aec73bfcabc1'),
  ('79 admin_devolucao_liberar_vinculo_reverso: corpo', COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean)')), '(função ausente)'), '83144be5ac2bc52f07f02274023a83ab'),
  ('79 as duas SECURITY DEFINER', (SELECT count(*)::text FROM pg_proc WHERE oid IN (to_regprocedure('public.cancelar_devolucao(uuid)'), to_regprocedure('public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean)')) AND prosecdef), '2'),
  ('79 as duas com search_path fixo', (SELECT count(*)::text FROM pg_proc WHERE oid IN (to_regprocedure('public.cancelar_devolucao(uuid)'), to_regprocedure('public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean)')) AND proconfig @> ARRAY['search_path=public']), '2'),
  ('79 rpc nova SAI de anon', has_function_privilege('anon', 'public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean)', 'EXECUTE')::text, 'false'),
  ('79 rpc nova executa p/ authenticated', has_function_privilege('authenticated', 'public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean)', 'EXECUTE')::text, 'true'),
  ('80 update_order_status_atomic: corpo da 80', COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.update_order_status_atomic(uuid,text,text,boolean)')), '(função ausente)'), 'ed2f7fd3e0177c027720049b2fe55d3b'),
  ('81 get_orders_by_whatsapp_v3 SAI de anon', has_function_privilege('anon', 'public.get_orders_by_whatsapp_v3(text,text,text)', 'EXECUTE')::text, 'false'),
  ('81 get_orders_by_whatsapp_v3 SAI de authenticated', has_function_privilege('authenticated', 'public.get_orders_by_whatsapp_v3(text,text,text)', 'EXECUTE')::text, 'false'),
  ('81 get_orders_by_otp_v1 continua p/ anon', has_function_privilege('anon', 'public.get_orders_by_otp_v1(text,text)', 'EXECUTE')::text, 'true'),
  ('82 zero pedidos com cpf no endereco', (SELECT count(*)::text FROM public.marketplace_orders o WHERE jsonb_typeof(o.customer_data -> 'address') = 'object' AND (o.customer_data -> 'address') ? 'cpf'), '0')
) AS c(checagem, valor, esperado)
ORDER BY ok, checagem;

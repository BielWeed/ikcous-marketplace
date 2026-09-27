-- 7a — Confere se a migration 83 (O CRM VÊ TODO MUNDO) foi aplicada com o
-- corpo/ACL que ela promete. Mesmo desenho de 6a (79-82): uma consulta só,
-- porque 83 mexe em 4 funções relacionadas (2 novas, 2 redefinidas). Usada
-- como pré-checagem do ledger 83 (`conferir-banco.cjs`,
-- `CONSULTAS_DA_PRE_CHECAGEM_DO_LEDGER`) e à mão pelo coordenador
-- (`consulta = 7a-conferir-83`).
--
-- `to_regprocedure('esquema.funcao(tipos)')` em vez de `proname` cru — mesmo
-- motivo do 6a: resolve para UM oid (ou NULL) pela assinatura exata, sempre.
--
-- 83: `crm__pedidos_nao_pagos(timestamptz)` e `crm__nunca_comprou(timestamptz)`
-- existem, com o corpo que a 20261183000000 deixa, e SAEM de
-- PUBLIC/anon/authenticated (mesma régua de crm__vendas/crm__clientes_rfm,
-- migration 78 — quem autoriza é o REVOKE, ninguém chama estas duas direto).
-- `crm_clientes`/`crm_visao` batem com o corpo NOVO (união de 3 grupos; os 2
-- segmentos novos no jsonb_agg de `segmentos`) e continuam EXECUTE só para
-- authenticated — nenhum GRANT amplo novo para anon.
SELECT checagem, valor, esperado, COALESCE(valor = esperado, false) AS ok FROM (VALUES
  ('83 crm__pedidos_nao_pagos existe', (to_regprocedure('public.crm__pedidos_nao_pagos(timestamptz)') IS NOT NULL)::text, 'true'),
  ('83 crm__nunca_comprou existe', (to_regprocedure('public.crm__nunca_comprou(timestamptz)') IS NOT NULL)::text, 'true'),
  ('83 crm__pedidos_nao_pagos: corpo', COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.crm__pedidos_nao_pagos(timestamptz)')), '(função ausente)'), '706d3cbaffc77d4b15ac06cc4c244256'),
  ('83 crm__nunca_comprou: corpo', COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.crm__nunca_comprou(timestamptz)')), '(função ausente)'), '3e069334090dd819a036dd2dc546a184'),
  ('83 crm_clientes: corpo novo (3 grupos)', COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.crm_clientes(text, text, integer, integer)')), '(função ausente)'), 'f31396c2f583756da56ae63a44cf09dc'),
  ('83 crm_visao: corpo novo (2 segmentos a mais)', COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.crm_visao(date, date)')), '(função ausente)'), '0e76e93760b7db349c294c40b4477c18'),
  ('83 crm__pedidos_nao_pagos SAI de anon', has_function_privilege('anon', 'public.crm__pedidos_nao_pagos(timestamptz)', 'EXECUTE')::text, 'false'),
  ('83 crm__pedidos_nao_pagos SAI de authenticated', has_function_privilege('authenticated', 'public.crm__pedidos_nao_pagos(timestamptz)', 'EXECUTE')::text, 'false'),
  ('83 crm__nunca_comprou SAI de anon', has_function_privilege('anon', 'public.crm__nunca_comprou(timestamptz)', 'EXECUTE')::text, 'false'),
  ('83 crm__nunca_comprou SAI de authenticated', has_function_privilege('authenticated', 'public.crm__nunca_comprou(timestamptz)', 'EXECUTE')::text, 'false'),
  ('83 crm_clientes continua p/ authenticated', has_function_privilege('authenticated', 'public.crm_clientes(text, text, integer, integer)', 'EXECUTE')::text, 'true'),
  ('83 crm_clientes SAI de anon', has_function_privilege('anon', 'public.crm_clientes(text, text, integer, integer)', 'EXECUTE')::text, 'false'),
  ('83 crm_visao continua p/ authenticated', has_function_privilege('authenticated', 'public.crm_visao(date, date)', 'EXECUTE')::text, 'true'),
  ('83 crm_visao SAI de anon', has_function_privilege('anon', 'public.crm_visao(date, date)', 'EXECUTE')::text, 'false')
) AS c(checagem, valor, esperado)
ORDER BY ok, checagem;

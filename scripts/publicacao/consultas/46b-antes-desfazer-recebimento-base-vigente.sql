-- 46b — ANTES de aplicar a migration 20261243000000 (desfazer o recebimento recusa pedido com devolucao viva): confirma,
-- POR OBJETO, a base de antes: a funcao `registrar_pagamento_recebido(uuid, boolean)` existe (uma assinatura so) com o corpo
-- VIGENTE (md5 da 20261197000000, o que NAO recusa o desfazer com devolucao viva) e com os atributos de sempre; o EXECUTE
-- esta como esta hoje (authenticated e service_role sim; PUBLIC e anon nao: o CREATE OR REPLACE o preserva e o pre-voo da
-- migration recusa o apply com a ACL diferente); as duas funcoes que o corpo chama (`is_admin()` e `is_admin_atual()`)
-- existem; e as tabelas e colunas que o corpo novo le existem. E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote
-- em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 46a negativa so vira "aplique" se esta for positiva (a
-- loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_class, pg_attribute, aclexplode):
-- nenhuma linha de pedido, de pagamento ou de devolucao e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas em qualquer
-- estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = a loja esta na base
-- de antes; uma loja que JA tem a migration reprova aqui de proposito, na linha do corpo.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF).
--   * atributos  -- SECURITY DEFINER + `search_path=public` + plpgsql, VOLATILE, retorno jsonb, dois argumentos, e UMA
--                   assinatura so por nome.
--   * EXECUTE    -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                   has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por
--                   has_function_privilege (papel ausente conta como sem EXECUTE).
--   * colunas    -- as 14 colunas que o corpo le ou grava (marketplace_orders: id, status, payment_status, payment_method,
--                   pagamento_recebido_em, pagamento_recebido_por, updated_at; marketplace_order_payment_history:
--                   order_id, acao, payment_status_antes, payment_status_depois, created_by; devolucoes: order_id,
--                   status), por pg_attribute.
--
-- tests/banco/desfazer-recebimento-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do rollback,
-- negativa depois do apply, um negativo por linha). O md5 vem do ARQUIVO da migration 20261197000000, nao de uma loja: o
-- valor VIVO de cada loja so esta consulta mede. LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
WITH fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         COALESCE(p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset AND NOT p.proisstrict
            AND p.pronargs = 2
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = 'jsonb'
            AND (SELECT count(*) FROM pg_proc q
                  WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'registrar_pagamento_recebido') = 1, false) AS atributos_ok,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec,
         CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS svc_exec
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.registrar_pagamento_recebido(uuid,boolean)')
), lidas AS (
  SELECT count(*) AS n
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'public'::regnamespace
     AND a.attnum > 0 AND NOT a.attisdropped
     AND ((c.relname = 'marketplace_orders' AND a.attname IN ('id', 'status', 'payment_status', 'payment_method', 'pagamento_recebido_em', 'pagamento_recebido_por', 'updated_at'))
       OR (c.relname = 'marketplace_order_payment_history' AND a.attname IN ('order_id', 'acao', 'payment_status_antes', 'payment_status_depois', 'created_by'))
       OR (c.relname = 'devolucoes' AND a.attname IN ('order_id', 'status')))
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'registrar_pagamento_recebido: corpo e o vigente da 20261197000000, sem a recusa da devolucao viva (md5)',
         '6584d62da7815a913b1e0cb86c108b0f',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_pagamento_recebido: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb, dois argumentos)',
         'atributos de sempre',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT f.atributos_ok FROM fn f) THEN 'atributos de sempre'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'registrar_pagamento_recebido: EXECUTE so de authenticated e service_role (PUBLIC e anon nao)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT 'PUBLIC=' || CASE WHEN f.public_exec THEN 'sim' ELSE 'nao' END
                          || ' anon=' || CASE WHEN f.anon_exec THEN 'sim' ELSE 'nao' END
                          || ' authenticated=' || CASE WHEN f.auth_exec THEN 'sim' ELSE 'nao' END
                          || ' service_role=' || CASE WHEN f.svc_exec THEN 'sim' ELSE 'nao' END
                     FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'is_admin() e is_admin_atual() existem (o corpo as chama)',
         'ambas',
         CASE WHEN to_regprocedure('public.is_admin()') IS NOT NULL
               AND to_regprocedure('public.is_admin_atual()') IS NOT NULL THEN 'ambas' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'as 14 colunas que o corpo le ou grava existem (pedidos, historico de pagamento e devolucoes)',
         '14',
         (SELECT l.n::text FROM lidas l)
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

-- 81a-conferir-compra-online-trava-preco-e-chave-aplicado: DEPOIS da 20261350000000; SO LEITURA, catalogo, rol fechado de 7 linhas.
-- Exige a 20261244000000 ANTES da 350: o pre-voo dela recusa corpo anterior de create_marketplace_order_v23 e v24.
-- Nao ler pedido nem dado de cliente. Hash = md5(replace(prosrc, chr(13), '')); desconhecido ou ausente recusa.
-- As tres edicoes da 350 em cada corpo: `FOR NO KEY UPDATE OF v, p;` (uma vez; e nenhuma `OF v;` sozinha), as travas da ordem
-- global antes do laco do passo 3 (`ORDER BY v.id` e `ORDER BY p.id`, cada uma seguida de FOR NO KEY UPDATE; contam 2) e o
-- advisory lock da chave de idempotencia `pedido_online:` (uma vez). Depois do rollback reprovam os hashes e as contagens.
WITH alvo(nome, assinatura) AS (
  VALUES ('create_marketplace_order_v23', 'public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)'),
         ('create_marketplace_order_v24', 'public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)')
), fn AS (
  SELECT t.nome, p.oid, md5(replace(p.prosrc, chr(13), '')) AS m,
         (SELECT count(*) FROM regexp_matches(p.prosrc, 'FOR NO KEY UPDATE OF v, p;', 'g')) AS n_trava_v_p,
         (SELECT count(*) FROM regexp_matches(p.prosrc, 'FOR NO KEY UPDATE OF v;', 'g')) AS n_trava_so_v,
         (SELECT count(*) FROM regexp_matches(p.prosrc, 'ORDER BY [vp]\.id\s+FOR NO KEY UPDATE;', 'g')) AS n_ordem,
         (SELECT count(*) FROM regexp_matches(p.prosrc, 'pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(''pedido_online:'' \|\| p_idempotency_key::text, 0\)\);', 'g')) AS n_lock,
         COALESCE(p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset AND NOT p.proisstrict
           AND p.pronargs = 13
           AND p.proconfig = ARRAY['search_path=public']::text[]
           AND pg_get_function_result(p.oid) = 'uuid'
           AND (SELECT count(*) FROM pg_proc q
                 WHERE q.pronamespace = 'public'::regnamespace AND q.proname = t.nome) = 1, false) AS atributos_ok,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec,
         CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS svc_exec
    FROM alvo t JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'create_marketplace_order_v23: corpo e o da 20261350000000, com a ordem global das travas, a trava do produto e a espera da mesma chave (md5)', '6b71cb823967518955407b532904ae91',
         COALESCE((SELECT m FROM fn WHERE nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: corpo e o da 20261350000000, com a ordem global das travas, a trava do produto e a espera da mesma chave (md5)', 'e3c124d25632aaa9bcf1995153bc5a7e',
         COALESCE((SELECT m FROM fn WHERE nome = 'create_marketplace_order_v24'), 'AUSENTE')
  UNION ALL
  SELECT 'as duas compras: as travas do carrinho saem em ordem global (variacoes por id, depois produtos por id) e a leitura do passo 3 tranca a variacao e o produto (ordem 2 vezes; OF v, p uma vez; nenhuma OF v sozinha)', 'v23=2/1/0 v24=2/1/0',
         CASE WHEN (SELECT count(*) FROM fn) < 2 THEN 'AUSENTE'
              ELSE (SELECT string_agg(CASE f.nome WHEN 'create_marketplace_order_v23' THEN 'v23' ELSE 'v24' END
                                      || '=' || f.n_ordem || '/' || f.n_trava_v_p || '/' || f.n_trava_so_v, ' ' ORDER BY f.nome) FROM fn f) END
  UNION ALL
  SELECT 'as duas compras: a mesma chave de idempotencia espera a primeira (advisory lock pedido_online:, uma vez)', 'v23=1 v24=1',
         CASE WHEN (SELECT count(*) FROM fn) < 2 THEN 'AUSENTE'
              ELSE (SELECT string_agg(CASE f.nome WHEN 'create_marketplace_order_v23' THEN 'v23' ELSE 'v24' END
                                      || '=' || f.n_lock, ' ' ORDER BY f.nome) FROM fn f) END
  UNION ALL
  SELECT 'as duas compras: uma assinatura so cada e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)', 'atributos de sempre',
         CASE WHEN (SELECT count(*) FROM fn) < 2 THEN 'AUSENTE'
              WHEN (SELECT bool_and(f.atributos_ok) FROM fn f) THEN 'atributos de sempre'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'as duas compras: EXECUTE como sempre (PUBLIC nao; anon, authenticated e service_role sim)',
         'v23: PUBLIC=nao anon=sim authenticated=sim service_role=sim | v24: PUBLIC=nao anon=sim authenticated=sim service_role=sim',
         CASE WHEN (SELECT count(*) FROM fn) < 2 THEN 'AUSENTE'
              ELSE (SELECT string_agg(CASE f.nome WHEN 'create_marketplace_order_v23' THEN 'v23' ELSE 'v24' END
                                      || ': PUBLIC=' || CASE WHEN f.public_exec THEN 'sim' ELSE 'nao' END
                                      || ' anon=' || CASE WHEN f.anon_exec THEN 'sim' ELSE 'nao' END
                                      || ' authenticated=' || CASE WHEN f.auth_exec THEN 'sim' ELSE 'nao' END
                                      || ' service_role=' || CASE WHEN f.svc_exec THEN 'sim' ELSE 'nao' END,
                                      ' | ' ORDER BY f.nome)
                      FROM fn f) END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

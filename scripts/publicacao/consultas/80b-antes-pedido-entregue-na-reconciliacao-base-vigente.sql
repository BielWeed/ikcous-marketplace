-- 80b-antes-pedido-entregue-na-reconciliacao-base-vigente: ANTES da 20261349000000; SO LEITURA, catalogo, rol fechado de 4 linhas.
-- Exige a 20261270000000 ANTES da 349: o corpo vigente da fila tem de ser exatamente o dela. Nao ler pedido nem dado de cliente.
-- Hash = md5(replace(prosrc, chr(13), '')); desconhecido ou ausente recusa.
-- O 'delivered' conta as ocorrencias da palavra entre aspas no corpo (nas duas listas de status): 2 depois, 0 antes.
WITH alvo(nome, assinatura, lingua, retorna_conjunto, retorno, argumentos, padroes) AS (
  VALUES ('pagamentos_a_reconciliar', 'public.pagamentos_a_reconciliar()', 'sql', true, 'TABLE(order_id uuid, gateway_payment_id text)', 0, 0)
), fn AS (
  SELECT t.nome, p.oid, md5(replace(p.prosrc, chr(13), '')) AS m,
         (SELECT count(*) FROM regexp_matches(p.prosrc, '''delivered''', 'g')) AS n_delivered,
         COALESCE(p.prosecdef AND l.lanname = t.lingua AND p.provolatile = 'v'
           AND p.proretset = t.retorna_conjunto AND NOT p.proisstrict
           AND p.pronargs = t.argumentos AND p.pronargdefaults = t.padroes
           AND p.proconfig = ARRAY['search_path=public']::text[]
           AND pg_get_function_result(p.oid) = t.retorno
           AND (SELECT count(*) FROM pg_proc q
                 WHERE q.pronamespace = 'public'::regnamespace AND q.proname = t.nome) = 1, false) AS atributos_ok,
         NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND CASE WHEN to_regrole('anon') IS NULL THEN false ELSE NOT has_function_privilege('anon', p.oid, 'EXECUTE') END
           AND CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') END
           AND CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS acl_ok
    FROM alvo t JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'pagamentos_a_reconciliar: corpo exato (md5)', 'aed09ec910825168a3217b2e308824c5',
         COALESCE((SELECT m FROM fn WHERE nome = 'pagamentos_a_reconciliar'), 'AUSENTE')
  UNION ALL
  SELECT 'pagamentos_a_reconciliar: delivered nas duas listas de status', '0',
         COALESCE((SELECT n_delivered::text FROM fn WHERE nome = 'pagamentos_a_reconciliar'), 'AUSENTE')
  UNION ALL
  SELECT 'pagamentos_a_reconciliar: assinatura, atributos e EXECUTE so do servidor', 'sim',
         CASE WHEN COALESCE((SELECT count(*) = 1 AND bool_and(atributos_ok AND acl_ok) FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

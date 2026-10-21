-- 57a-conferir-pagamento-adiantado-e-estorno-aplicado: DEPOIS da 20261270000000; SO LEITURA, catalogo, rol fechado de 5 linhas.
-- Exige a 20261241 (e portanto a 20261226) ANTES da 270: as duas preflights
-- ancestrais recusam concluir_estorno novo. Nao ler pedido, refund nem dado de cliente.
-- Hash = md5(replace(prosrc, chr(13), '')); desconhecido ou ausente recusa.
WITH alvo(nome, assinatura, lingua, retorna_conjunto, retorno, argumentos, padroes) AS (
  VALUES ('concluir_estorno', 'public.concluir_estorno(uuid,text,text,text)', 'plpgsql', false, 'jsonb', 4, 3),
         ('pagamentos_a_reconciliar', 'public.pagamentos_a_reconciliar()', 'sql', true, 'TABLE(order_id uuid, gateway_payment_id text)', 0, 0)
), fn AS (
  SELECT t.nome, p.oid, md5(replace(p.prosrc, chr(13), '')) AS m,
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
  SELECT 'concluir_estorno: corpo exato (md5)', '1738457c2b95c5c3709beed42e656394',
         COALESCE((SELECT m FROM fn WHERE nome = 'concluir_estorno'), 'AUSENTE')
  UNION ALL
  SELECT 'pagamentos_a_reconciliar: corpo exato (md5)', 'aed09ec910825168a3217b2e308824c5',
         -- 2 hashes aceitos: o corpo da 20261270000000 OU o da SUCESSORA dele, a 20261349000000 (o pedido entregue
         -- antes da confirmacao do PIX entra na fila: o mesmo corpo com 'delivered' nas duas listas). O `vivo` mostra o esperado.
         COALESCE((SELECT CASE WHEN m IN ('aed09ec910825168a3217b2e308824c5', '350e732dbae6ba45bede77c08e0db6d8')
                               THEN 'aed09ec910825168a3217b2e308824c5'
                               ELSE m END
                     FROM fn WHERE nome = 'pagamentos_a_reconciliar'), 'AUSENTE')
  UNION ALL
  SELECT 'as duas funcoes: assinaturas, atributos e EXECUTE so do servidor', 'sim',
         CASE WHEN COALESCE((SELECT count(*) = 2 AND bool_and(atributos_ok AND acl_ok) FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'dependencia 20261241: marcas e corpos do saldo em duvida presentes', 'sim',
         CASE WHEN COALESCE((to_regclass('public.order_refund_prova') IS NOT NULL
           AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
                 WHERE oid = to_regprocedure('public.order_refund__pode_ter_saido(uuid)')) = 'bdbb28b3d91588c8b10283d57bfb73d6'
           AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
                 WHERE oid = to_regprocedure('public.pedido__saldo_a_estornar(uuid)')) = '99741b4cdbf1e8d8340f80440e6da094'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

-- 129b-antes-o-cancelamento-e-o-avanco-conferem-base-vigente: ANTES do lote de cancelamento e avanco.
-- SO LEITURA, so catalogo; rol fechado de 18 linhas. Nao le pedidos nem historico.
-- Hash = md5(replace(prosrc, chr(13), '')); corpo desconhecido ou ausente recusa.
WITH alvo(nome, assinatura, argumentos, acesso) AS (
  VALUES ('avancar_status_do_pedido', 'public.avancar_status_do_pedido(uuid,text,text,text)',
          'p_order_id uuid, p_status_esperado text, p_new_status text, p_notes text DEFAULT NULL::text', 'authenticated'),
         ('pedido__mudar_status', 'public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)',
          'p_order_id uuid, p_new_status text, p_notes text, p_ator uuid, p_ator_admin boolean, p_pela_edge boolean', 'nenhum'),
         ('cancelar_pedido_com_cobranca', 'public.cancelar_pedido_com_cobranca(uuid,uuid,text,text,text)',
          'p_order_id uuid, p_ator uuid, p_vaga_esperada text, p_pagamento_esperado text, p_notes text DEFAULT NULL::text', 'service_role')
), fn AS (
  SELECT t.nome, p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
     AND NOT p.proisstrict AND NOT p.proretset AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_arguments(p.oid) = t.argumentos
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = t.nome) = 1) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE') = (t.acesso = 'authenticated')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE') = (t.acesso = 'service_role')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM alvo t JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
  JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'avancar_status_do_pedido: corpo exato (md5)', 'fa38bcea0cc69ffff200d8e2c81bd0d3',
    COALESCE((SELECT h FROM fn WHERE nome = 'avancar_status_do_pedido'), 'AUSENTE')
  UNION ALL
  SELECT 'avancar_status_do_pedido: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'avancar_status_do_pedido'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'avancar_status_do_pedido: EXECUTE so authenticated, sem PUBLIC, anon ou service_role', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'avancar_status_do_pedido'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'pedido__mudar_status: corpo exato (md5)', '4623b27a07468553d6ac00a888e04db4',
    COALESCE((SELECT h FROM fn WHERE nome = 'pedido__mudar_status'), 'AUSENTE')
  UNION ALL
  SELECT 'pedido__mudar_status: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'pedido__mudar_status'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'pedido__mudar_status: sem EXECUTE para PUBLIC, anon, authenticated ou service_role', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'pedido__mudar_status'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'cancelar_pedido_com_cobranca: corpo exato (md5)', 'e924c8fd33bb87e86a4a3fbd4fefde4e',
    COALESCE((SELECT h FROM fn WHERE nome = 'cancelar_pedido_com_cobranca'), 'AUSENTE')
  UNION ALL
  SELECT 'cancelar_pedido_com_cobranca: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'cancelar_pedido_com_cobranca'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'cancelar_pedido_com_cobranca: EXECUTE so service_role, sem PUBLIC, anon ou authenticated', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'cancelar_pedido_com_cobranca'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'is_admin_atual(): existe', 'sim',
    CASE WHEN to_regprocedure('public.is_admin_atual()') IS NOT NULL THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'cancelar_pedido_na_etapa: ausente em todas as assinaturas', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                         AND proname = 'cancelar_pedido_na_etapa') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'cancelar_pedido_com_cobranca_na_etapa: ausente em todas as assinaturas', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                         AND proname = 'cancelar_pedido_com_cobranca_na_etapa') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_orders.payment_status: coluna existe', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.marketplace_orders')
                      AND attname = 'payment_status' AND attnum > 0 AND NOT attisdropped) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_orders.status: coluna existe', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.marketplace_orders')
                      AND attname = 'status' AND attnum > 0 AND NOT attisdropped) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_orders.user_id: coluna existe', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.marketplace_orders')
                      AND attname = 'user_id' AND attnum > 0 AND NOT attisdropped) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_orders.stock_returned_at: coluna existe', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.marketplace_orders')
                      AND attname = 'stock_returned_at' AND attnum > 0 AND NOT attisdropped) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_orders.estorno_manual_registrado_em: coluna existe', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.marketplace_orders')
                      AND attname = 'estorno_manual_registrado_em' AND attnum > 0 AND NOT attisdropped) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

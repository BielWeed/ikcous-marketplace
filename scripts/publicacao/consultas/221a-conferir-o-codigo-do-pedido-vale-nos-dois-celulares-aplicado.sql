-- 221a-conferir-o-codigo-do-pedido-vale-nos-dois-celulares-aplicado: DEPOIS da 20261665000000.
-- SO LEITURA, so catalogo. Nao chama a emissao, a consulta nem le dados de pedidos.
-- Rol fechado: corpo exato, assinatura, atributos e ACL de cada porta.
WITH alvo(nome, assinatura, argumentos, visitante) AS (
  VALUES ('generate_order_otp_v2', 'public.generate_order_otp_v2(text,text,text)',
           'p_email text, p_whatsapp text, p_order_fragment text', false),
         ('get_orders_by_otp_v2', 'public.get_orders_by_otp_v2(text,text,text,text)',
           'p_email text, p_whatsapp text, p_fragmento text, p_otp text', true)
), fn AS (
  SELECT t.nome, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
     AND NOT p.proisstrict AND NOT p.proretset AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_arguments(p.oid) = t.argumentos
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = t.nome) = 1) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE') = t.visitante
     AND has_function_privilege('anon', p.oid, 'EXECUTE') = t.visitante
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM alvo t JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
  JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'generate_order_otp_v2: corpo exato (md5)', '133ed543a1ab73a235b059c8a4d8f87b',
    COALESCE((SELECT h FROM fn WHERE nome = 'generate_order_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'generate_order_otp_v2: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'generate_order_otp_v2'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'generate_order_otp_v2: EXECUTE esperado', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'generate_order_otp_v2'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_orders_by_otp_v2: corpo exato (md5)', '95d6957283869602683047a97d608074',
    COALESCE((SELECT h FROM fn WHERE nome = 'get_orders_by_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v2: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'get_orders_by_otp_v2'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_orders_by_otp_v2: EXECUTE esperado', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'get_orders_by_otp_v2'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

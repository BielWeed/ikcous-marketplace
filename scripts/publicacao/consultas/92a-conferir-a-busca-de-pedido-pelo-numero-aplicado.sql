-- 92a-conferir-a-busca-de-pedido-pelo-numero-aplicado: DEPOIS da 20261387000000.
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhuma linha de pedido, cliente ou devolucao.
-- O comportamento da busca (numero do pedido x telefone) NAO sai daqui (a funcao exige admin logado): ver a ficha da migration e a prova viva.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
     AND NOT p.proisstrict AND NOT p.proretset AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_identity_arguments(p.oid) = 'p_search text, p_status text, p_start_date text, p_end_date text, p_page integer, p_page_size integer, p_payment_status text, p_canal text'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'get_admin_orders_paged') = 1) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_admin_orders_paged: corpo exato (md5)', 'f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6',
    -- A 20261399900000 (a busca de Pedidos acha o telefone colado com o +55) sucede este corpo: so o corte do 55 e' novo. Aceita os dois corpos
    -- EXATOS; normaliza ao esperado historico do rol. A 20261399980000 (o desempate pelo id no ORDER BY) sucede a 3999: o corpo dela tambem vale.
    COALESCE((SELECT CASE WHEN h = 'b404a8397a6490c86fb192d85fd5b6c9' THEN 'f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6' WHEN h IN ('f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6', 'bf08545275eaa451a65e15feceb0ed8d') THEN 'f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6' ELSE h END FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_orders_paged: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_admin_orders_paged: EXECUTE authenticated e service_role, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

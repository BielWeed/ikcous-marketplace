-- 218b-antes-o-frete-de-ida-so-sai-do-lucro-quando-foi-devolvido-base-vigente: ANTES da 20261662000000. SO LEITURA, somente catalogo,
-- rol fechado de 6 linhas (o mesmo da 218a). A base vigente e' o corpo da 20261659000000 de get_admin_analytics_v2
-- (1624212a7096b6f49a80370b30191a15); aceita tambem o corpo desta (b6cb9b487fdc4b603ce9313b46184897) para uma reaplicacao idempotente.
-- Confere as premissas do pre-voo: atributos e ACL de sempre e as colunas que a conta le. NAO le nenhuma linha de pedido nem de
-- devolucao e NAO chama funcao nenhuma. Tudo true = pode aplicar; qualquer false = PARE (o pre-voo da migration recusaria).
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h, p.oid,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 'v' AND NOT p.proretset AND NOT p.proisstrict
           AND pg_get_function_result(p.oid) = 'json'
           AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90'
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND has_function_privilege('service_role', p.oid, 'EXECUTE') AS comum
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'get_admin_analytics_v2'
), atributos AS (
  SELECT count(*) = 1 AND bool_and(f.comum) AS certos
  FROM fn f
), colunas AS (
  SELECT count(*) FILTER (WHERE a.attrelid = to_regclass('public.devolucoes')) = 7 AS devolucoes,
         count(*) FILTER (WHERE a.attrelid = to_regclass('public.devolucao_itens')) = 4 AS itens,
         count(*) FILTER (WHERE a.attrelid = to_regclass('public.order_refunds')) = 2 AS ledger
    FROM pg_catalog.pg_attribute a
   WHERE NOT a.attisdropped AND a.attnum > 0
     AND ((a.attrelid = to_regclass('public.devolucoes')
           AND a.attname IN ('id', 'status', 'resolucao_final', 'valor_reembolso', 'valor_frete_ida', 'refund_id', 'reembolso_manual'))
       OR (a.attrelid = to_regclass('public.devolucao_itens')
           AND a.attname IN ('devolucao_id', 'quantidade', 'valor_unitario', 'condicao'))
       OR (a.attrelid = to_regclass('public.order_refunds')
           AND a.attname IN ('id', 'status')))
), itens(item, esperado, vivo, ok) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END,
         EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace)
  UNION ALL
  SELECT 'get_admin_analytics_v2: corpo esperado (md5)', '1624212a7096b6f49a80370b30191a15 ou b6cb9b487fdc4b603ce9313b46184897',
         COALESCE((SELECT h FROM fn LIMIT 1), 'AUSENTE'),
         COALESCE((SELECT h FROM fn LIMIT 1) IN ('1624212a7096b6f49a80370b30191a15', 'b6cb9b487fdc4b603ce9313b46184897'), false)
  UNION ALL
  SELECT 'get_admin_analytics_v2: uma so, plpgsql SECURITY DEFINER VOLATILE, search_path=public, assinatura e EXECUTE de sempre',
         'sim',
         CASE WHEN atributos.certos THEN 'sim' ELSE 'nao' END,
         COALESCE(atributos.certos, false)
  FROM atributos
  UNION ALL
  SELECT 'devolucoes (id, status, resolucao_final, valor_reembolso, valor_frete_ida, refund_id, reembolso_manual): as colunas que a conta le',
         'sim',
         CASE WHEN colunas.devolucoes THEN 'sim' ELSE 'nao' END,
         colunas.devolucoes
  FROM colunas
  UNION ALL
  SELECT 'devolucao_itens (devolucao_id, quantidade, valor_unitario, condicao): as colunas que a conta do frete le',
         'sim',
         CASE WHEN colunas.itens THEN 'sim' ELSE 'nao' END,
         colunas.itens
  FROM colunas
  UNION ALL
  SELECT 'order_refunds (id, status): a linha ligada diz se o reembolso saiu',
         'sim',
         CASE WHEN colunas.ledger THEN 'sim' ELSE 'nao' END,
         colunas.ledger
  FROM colunas
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;

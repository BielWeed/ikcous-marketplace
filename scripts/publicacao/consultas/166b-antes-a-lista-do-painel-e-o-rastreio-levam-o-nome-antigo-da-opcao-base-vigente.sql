-- ANTES da 20261410000000. So catalogo: nao chama as funcoes nem le dados de pedidos.
-- Tambem aceita os corpos novos para permitir reaplicacao.
WITH alvo(nome, assinatura, argumentos, config, anon_pode, h_esperado, hashes) AS (VALUES
  ('get_admin_orders_paged', 'public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)',
   'p_search text DEFAULT ''''::text, p_status text DEFAULT ''all''::text, p_start_date text DEFAULT ''''::text, p_end_date text DEFAULT ''''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_payment_status text DEFAULT ''all''::text, p_canal text DEFAULT ''all''::text',
   ARRAY['search_path=public, extensions']::text[], false,
   'b404a8397a6490c86fb192d85fd5b6c9 ou bfef98c2eeeaf9014d92d3e4cd97764d', ARRAY['b404a8397a6490c86fb192d85fd5b6c9', 'bfef98c2eeeaf9014d92d3e4cd97764d']::text[]),
  ('get_orders_by_otp_v2', 'public.get_orders_by_otp_v2(text,text,text,text)',
   'p_email text, p_whatsapp text, p_fragmento text, p_otp text',
   ARRAY['search_path=public']::text[], true,
   '02208ac9d2abe2e8b03790349d491ecb ou 96f080db2a488d8887a2dfd959bd9862', ARRAY['02208ac9d2abe2e8b03790349d491ecb', '96f080db2a488d8887a2dfd959bd9862']::text[])
), fn AS (
  SELECT a.*, md5(replace(p.prosrc, chr(13), '')) AS h,
    COALESCE(p.prokind = 'f' AND p.prosecdef AND p.provolatile = 'v'
      AND NOT p.proisstrict AND NOT p.proretset AND l.lanname = 'plpgsql'
      AND p.proconfig = a.config
      AND pg_get_function_arguments(p.oid) = a.argumentos
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND (SELECT count(*) FROM pg_catalog.pg_proc q
           WHERE q.pronamespace = 'public'::regnamespace AND q.proname = a.nome) = 1,
      false) AS atributos,
    COALESCE(has_function_privilege('anon', p.oid, 'EXECUTE') = a.anon_pode
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
        WHERE g.grantee = 0 AND g.privilege_type = 'EXECUTE'
      ), false) AS acl
  FROM alvo a
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(a.assinatura)
  LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
), colunas AS (
  SELECT NOT EXISTS (
    SELECT 1
    FROM (VALUES ('variacao_nome_na_compra'), ('variacao_valor_na_compra')) AS e(nome)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('public.marketplace_order_items')
        AND a.attname = e.nome AND NOT a.attisdropped AND a.attnum > 0
        AND a.atttypid = 'text'::regtype AND NOT a.attnotnull AND NOT a.atthasdef
    )
  ) AS ok
), itens(item, esperado, vivo, ok) AS (
  SELECT 'historico da opcao: colunas de destino conhecidas', 'sim',
    CASE WHEN ok THEN 'sim' ELSE 'nao' END, ok FROM colunas
  UNION ALL
  SELECT nome || ': corpo exato (md5)', h_esperado,
    COALESCE(h, 'AUSENTE'), COALESCE(h = ANY(hashes), false) FROM fn
  UNION ALL
  SELECT nome || ': assinatura e atributos conhecidos', 'sim',
    CASE WHEN atributos THEN 'sim' ELSE 'nao' END, atributos FROM fn
  UNION ALL
  SELECT nome || ': EXECUTE preservado', 'sim',
    CASE WHEN acl THEN 'sim' ELSE 'nao' END, acl FROM fn
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;

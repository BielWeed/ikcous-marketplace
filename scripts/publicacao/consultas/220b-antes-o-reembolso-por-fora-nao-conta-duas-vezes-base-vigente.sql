-- 220b: antes da 1664. Somente catálogo: não lê pedidos, estornos ou devoluções e não chama RPC.
-- Rol fechado idêntico ao par; 'AUSENTE' é esperado nas quatro funções novas antes da migration.
WITH alvo(nome, assinatura, hash_esperado, lingua, vol, definer, autenticado, so_dono) AS (
  VALUES
    ('fin__movimentos', 'public.fin__movimentos(date,date)', '26473edd94ad6547d95de43433088304', 'sql', 's', false, false, false),
    ('pedido__saldo_a_estornar', 'public.pedido__saldo_a_estornar(uuid)', '99741b4cdbf1e8d8340f80440e6da094', 'sql', 's', true, false, true),
    ('admin_devolucao_reembolso_por_fora_apos_espera', 'public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)', '92dd1608d02ef5e9fd9fe34e0bd7c49f', 'plpgsql', 'v', true, true, false),
    ('pedido_reembolsos_e_saldo', 'public.pedido_reembolsos_e_saldo(uuid)', '86dd0eaaaa571a4d5e85622e90442bc0', 'plpgsql', 's', true, true, false),
    ('get_admin_analytics_v2', 'public.get_admin_analytics_v2(integer)', '1624212a7096b6f49a80370b30191a15', 'plpgsql', 'v', true, true, false),
    ('order_refund__valor_coberto_por_fora', 'public.order_refund__valor_coberto_por_fora(uuid)', 'AUSENTE', 'sql', 's', false, false, true),
    ('order_refund__suspeitas_do_pedido', 'public.order_refund__suspeitas_do_pedido(uuid)', 'AUSENTE', 'sql', 's', false, false, true),
    ('admin_devolucao_confirmar_mesmo_dinheiro', 'public.admin_devolucao_confirmar_mesmo_dinheiro(uuid,uuid)', 'AUSENTE', 'plpgsql', 'v', true, true, false),
    ('admin_devolucao_confirmar_dois_reembolsos', 'public.admin_devolucao_confirmar_dois_reembolsos(uuid,uuid)', 'AUSENTE', 'plpgsql', 'v', true, true, false)
), funcoes AS (
  SELECT a.*, p.oid, md5(replace(p.prosrc, chr(13), '')) AS hash_vivo,
         (p.prokind = 'f' AND p.prosecdef = a.definer AND p.provolatile::text = a.vol
          AND l.lanname::text = a.lingua AND p.proconfig = ARRAY['search_path=public']::text[]
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = a.autenticado
          AND (NOT a.so_dono OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
          AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) e
                           WHERE e.grantee = 0 AND e.privilege_type = 'EXECUTE')) AS atributos_ok,
         (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
            AND q.proname::text = a.nome) AS quantidade
    FROM alvo a LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.assinatura)
    LEFT JOIN pg_language l ON l.oid = p.prolang
), colunas AS (
  SELECT a.attnum, a.attrelid, a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull
    FROM pg_attribute a
   WHERE NOT a.attisdropped AND a.attnum > 0
     AND ((a.attrelid = to_regclass('public.order_refunds') AND a.attname IN ('cobre_devolucao_id', 'dobro_conferido_em'))
       OR (a.attrelid = to_regclass('public.order_refund_prova') AND a.attname = 'devolucao_id'))
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT f.nome || ': corpo exato (md5)', f.hash_esperado, COALESCE(f.hash_vivo, 'AUSENTE') FROM funcoes f
  UNION ALL
  SELECT f.nome || ': assinatura, atributos e EXECUTE', 'sim',
    CASE WHEN (f.hash_esperado = 'AUSENTE' AND f.quantidade = 0)
           OR (f.hash_esperado <> 'AUSENTE' AND f.quantidade = 1 AND f.atributos_ok) THEN 'sim' ELSE 'nao' END
    FROM funcoes f
  UNION ALL
  SELECT '1664: colunas, chaves e indices da conferencia', 'sim',
    CASE WHEN
      NOT EXISTS (SELECT 1 FROM colunas)
      AND to_regclass('public.uq_order_refunds_cobre_devolucao') IS NULL
      AND to_regclass('public.idx_order_refund_prova_devolucao') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.order_refunds')
                       AND c.conname = 'order_refunds_conferencia_exclusiva')
    THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'order_refund_prova: RLS e acesso fechado', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.order_refund_prova') AND c.relrowsecurity
         AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee = 0)
         AND NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
         AND NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
         AND NOT has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))
         AND NOT has_table_privilege('authenticated', 'public.order_refunds', 'INSERT,UPDATE,DELETE')
         THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

-- 220a: depois da 1664. Somente catálogo: não lê pedidos, estornos ou devoluções e não chama RPC.
-- Rol fechado idêntico ao par; 'AUSENTE' é esperado nas quatro funções novas antes da migration.
WITH alvo(nome, assinatura, hash_esperado, lingua, vol, definer, autenticado, so_dono) AS (
  VALUES
    ('fin__movimentos', 'public.fin__movimentos(date,date)', '17127ad84b6eb71e8cd1714d47855a68', 'sql', 's', false, false, false),
    ('pedido__saldo_a_estornar', 'public.pedido__saldo_a_estornar(uuid)', '7f0c83c80b5f26df9cbc19e92384453d', 'sql', 's', true, false, true),
    ('admin_devolucao_reembolso_por_fora_apos_espera', 'public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)', '32c2bc1d99162e0450a11431fa8ae411', 'plpgsql', 'v', true, true, false),
    ('pedido_reembolsos_e_saldo', 'public.pedido_reembolsos_e_saldo(uuid)', '801b199196120f82c4b57ab7abbc9c11', 'plpgsql', 's', true, true, false),
    ('get_admin_analytics_v2', 'public.get_admin_analytics_v2(integer)', '3853f60efad86f22deb368ed791d76cb', 'plpgsql', 'v', true, true, false),
    ('order_refund__valor_coberto_por_fora', 'public.order_refund__valor_coberto_por_fora(uuid)', 'b02ca216bd69262ba5f5ca4034d6db4a', 'sql', 's', false, false, true),
    ('order_refund__suspeitas_do_pedido', 'public.order_refund__suspeitas_do_pedido(uuid)', 'ecf3eb8ffbe6926ef78678f51ca3f24f', 'sql', 's', false, false, true),
    ('admin_devolucao_confirmar_mesmo_dinheiro', 'public.admin_devolucao_confirmar_mesmo_dinheiro(uuid,uuid)', 'a17c0572552eaef549ff3b0dfab76622', 'plpgsql', 'v', true, true, false),
    ('admin_devolucao_confirmar_dois_reembolsos', 'public.admin_devolucao_confirmar_dois_reembolsos(uuid,uuid)', '7d8a4faa9bd8954cf9cb9851bf8dfde5', 'plpgsql', 'v', true, true, false)
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
      (SELECT count(*) FROM colunas WHERE NOT attnotnull AND
        (CASE WHEN attname = 'dobro_conferido_em' THEN tipo = 'timestamp with time zone' ELSE tipo = 'uuid' END)) = 3
      AND (SELECT count(*) FROM colunas a JOIN pg_constraint c ON c.conrelid = a.attrelid
        WHERE a.attname <> 'dobro_conferido_em' AND c.contype = 'f' AND c.convalidated AND c.confdeltype = 'n'
          AND c.conkey = ARRAY[a.attnum]::smallint[] AND c.confrelid = to_regclass('public.devolucoes')
          AND c.confkey = ARRAY[(SELECT d.attnum FROM pg_attribute d WHERE d.attrelid = c.confrelid
                                   AND d.attname = 'id' AND NOT d.attisdropped)]::smallint[]) = 2
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.order_refunds')
                   AND c.conname = 'order_refunds_conferencia_exclusiva' AND c.contype = 'c' AND c.convalidated
                   AND pg_get_expr(c.conbin, c.conrelid) = '((cobre_devolucao_id IS NULL) OR (dobro_conferido_em IS NULL))')
      AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.uq_order_refunds_cobre_devolucao')
                   AND i.indrelid = to_regclass('public.order_refunds') AND i.indisunique AND i.indisvalid
                   AND pg_get_indexdef(i.indexrelid) LIKE '%(cobre_devolucao_id) WHERE (cobre_devolucao_id IS NOT NULL)')
      AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_order_refund_prova_devolucao')
                   AND i.indrelid = to_regclass('public.order_refund_prova') AND i.indisvalid
                   AND pg_get_indexdef(i.indexrelid) LIKE '%(devolucao_id) WHERE (devolucao_id IS NOT NULL)')
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

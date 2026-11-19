-- DEPOIS da 20261406000000. So catalogo, sem ler dados de cliente.
WITH itens(item, ok) AS (
  VALUES
    ('historico da opcao: tabelas, RLS dos itens e colunas de origem', (EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.marketplace_order_items')
        AND c.relkind = 'r' AND c.relrowsecurity)
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES
          ('public.product_variants', 'id', 'uuid'::regtype, true),
          ('public.product_variants', 'name', 'text'::regtype, true),
          ('public.product_variants', 'value', 'text'::regtype, true),
          ('public.marketplace_order_items', 'variant_id', 'uuid'::regtype, false)
        ) AS e(tabela, coluna, tipo, obrigatoria)
        WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(e.tabela)
          AND a.attname = e.coluna AND NOT a.attisdropped AND a.atttypid = e.tipo
          AND a.attnotnull = e.obrigatoria)
      ))),
    ('historico da opcao: colunas de destino', ((SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_order_items')
          AND a.attname IN ('variacao_nome_na_compra', 'variacao_valor_na_compra')
          AND NOT a.attisdropped
          AND a.atttypid = 'text'::regtype AND NOT a.attnotnull AND NOT a.atthasdef
          AND a.attidentity = '' AND a.attgenerated = '' AND a.attacl IS NULL) = 2)),
    ('historico da opcao: funcao interna', ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname = 'guardar_rotulo_da_opcao_no_pedido') = 1
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname = 'guardar_rotulo_da_opcao_no_pedido'
        AND p.oid = to_regprocedure('public.guardar_rotulo_da_opcao_no_pedido()')
        AND p.proretset = false AND p.prorettype = 'trigger'::regtype
        AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
        AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
        AND p.provolatile = 'v' AND NOT p.proisstrict
        AND md5(replace(p.prosrc, E'\r', '')) = '66e9a87eeb9e63fe6337daab90941cf7'
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        )
      ))),
    ('historico da opcao: gatilho de nome ou valor', (EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.product_variants')
        AND t.tgname = 'tr_product_variants_guarda_rotulo_no_pedido'
        AND t.tgfoid = to_regprocedure('public.guardar_rotulo_da_opcao_no_pedido()')
        AND t.tgenabled = 'O' AND NOT t.tgisinternal AND t.tgtype = 17
        AND t.tgattr::text = (
          SELECT string_agg(a.attnum::text, ' ' ORDER BY a.attname)
          FROM pg_attribute a WHERE a.attrelid = t.tgrelid
            AND a.attname IN ('name', 'value') AND NOT a.attisdropped
        )
        AND pg_get_triggerdef(t.oid) LIKE '%WHEN (((old.name IS DISTINCT FROM new.name) OR (old.value IS DISTINCT FROM new.value)))%'
      )))
)
SELECT item, 'sim' AS esperado, CASE WHEN ok THEN 'sim' ELSE 'nao' END AS vivo,
       COALESCE(ok, false) AS ok
FROM itens ORDER BY ok, item;

-- DEPOIS da 20261408000000. Só catálogo; não lê dado de cliente.
WITH objetos AS (
  SELECT to_regclass('public.public_profiles') AS perfis,
         to_regprocedure('public.nome_publico_de(text)') AS funcao
), views_esperadas(nome, corpo) AS (
  VALUES
    ('vw_reviews_public', $$SELECT r.id, r.product_id, r.rating, r.comment, r.created_at,
      r.helpful, r.verified, r.merchant_reply, r.merchant_reply_at,
      COALESCE(pp.nome_publico, 'Cliente'::text) AS author_name, pp.avatar_url AS author_avatar_url FROM reviews r
      LEFT JOIN public_profiles pp ON pp.id = r.user_id WHERE r.status = 'publicada'::text;$$),
    ('vw_questions_public', $$SELECT q.id, q.product_id, q.question, q.created_at,
      COALESCE(pp.nome_publico, 'Cliente'::text) AS author_name, pp.avatar_url AS author_avatar_url FROM questions q
      LEFT JOIN public_profiles pp ON pp.id = q.user_id;$$)
), itens(item, ok) AS (
  SELECT 'nome publico: perfil de origem', EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.oid = o.perfis AND c.relkind = 'r' AND c.relrowsecurity
      AND a.attname = 'full_name' AND a.atttypid = 'text'::regtype AND NOT a.attisdropped
  ) FROM objetos o
  UNION ALL
  SELECT 'nome publico: coluna gerada', EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = o.perfis AND a.attname = 'nome_publico' AND NOT a.attisdropped
      AND a.atttypid = 'text'::regtype AND a.attgenerated = 's' AND a.attnotnull
      AND replace(pg_get_expr(d.adbin, d.adrelid), 'public.', '') = 'nome_publico_de(full_name)'
  ) FROM objetos o
  UNION ALL
  SELECT 'nome publico: funcao pura', EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = o.funcao AND p.provolatile = 'i' AND NOT p.prosecdef
      AND NOT p.proretset AND p.prorettype = 'text'::regtype
      AND p.proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND md5(replace(p.prosrc, E'\r', '')) = 'affba4f695c21e6ce364afade5347732'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) FROM objetos o
  UNION ALL
  SELECT 'nome publico: ' || e.nome, EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = to_regclass('public.' || e.nome) AND c.relkind = 'v' AND c.reloptions IS NULL
      AND regexp_replace(pg_get_viewdef(c.oid, true), '[[:space:]()]|public[.]', '', 'g') =
          regexp_replace(e.corpo, '[[:space:]()]', '', 'g')
      AND has_table_privilege('anon', c.oid, 'SELECT')
      AND has_table_privilege('authenticated', c.oid, 'SELECT')
      AND has_table_privilege('service_role', c.oid, 'SELECT')
  ) FROM views_esperadas e
)
SELECT item, 'sim' AS esperado, CASE WHEN ok THEN 'sim' ELSE 'nao' END AS vivo,
       coalesce(ok, false) AS ok
FROM itens ORDER BY ok, item;

-- 163a-conferir-chaves-de-frete-so-o-servidor-aplicado: DEPOIS da 20261407000000.
-- SO LEITURA, so catalogo: nunca le o conteudo da tabela. Rol fechado de seis linhas.
-- A ACL padrao do dono enumera os privilegios de tabela da versao instalada do Postgres.
WITH tb AS (
  SELECT c.oid, c.relacl, c.relowner, c.relrowsecurity
  FROM pg_class c
  WHERE c.oid = to_regclass('public.store_shipping_credentials') AND c.relkind = 'r'
), privilegios AS (
  SELECT x.privilege_type
  FROM tb CROSS JOIN LATERAL aclexplode(acldefault('r', tb.relowner)) x
), acl_tabela AS (
  SELECT x.*
  FROM tb CROSS JOIN LATERAL aclexplode(COALESCE(tb.relacl, acldefault('r', tb.relowner))) x
), acl_colunas AS (
  SELECT x.grantee
  FROM tb JOIN pg_attribute a ON a.attrelid = tb.oid AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN LATERAL aclexplode(a.attacl) x
), papeis(item, papel, esperado) AS (
  VALUES
    ('store_shipping_credentials: anon', 'anon', 'nenhum'),
    ('store_shipping_credentials: authenticated', 'authenticated', 'nenhum'),
    ('store_shipping_credentials: service_role', 'service_role', 'todos'),
    ('store_shipping_credentials: postgres', 'postgres', 'todos')
), itens(item, esperado, vivo) AS (
  SELECT p.item, p.esperado,
    COALESCE((SELECT CASE
      WHEN to_regrole(p.papel) IS NULL THEN 'PAPEL AUSENTE'
      WHEN NOT EXISTS (
        SELECT 1 FROM privilegios v WHERE NOT has_table_privilege(to_regrole(p.papel), tb.oid, v.privilege_type)
      ) THEN 'todos'
      WHEN NOT EXISTS (
        SELECT 1 FROM privilegios v WHERE has_table_privilege(to_regrole(p.papel), tb.oid, v.privilege_type)
      ) AND NOT has_any_column_privilege(to_regrole(p.papel), tb.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
        THEN 'nenhum'
      ELSE 'divergente'
    END FROM tb), 'AUSENTE')
  FROM papeis p
  UNION ALL
  SELECT 'store_shipping_credentials: PUBLIC sem privilegio de tabela ou coluna', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM tb)
          AND NOT EXISTS (SELECT 1 FROM acl_tabela WHERE grantee = 0)
          AND NOT EXISTS (SELECT 1 FROM acl_colunas WHERE grantee = 0)
         THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'store_shipping_credentials: RLS ligada', 'sim',
    CASE WHEN (SELECT relrowsecurity FROM tb) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

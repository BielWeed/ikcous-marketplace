-- 51a-conferir-notes-do-pedido-fechada-aplicado: somente catalogo, 6 linhas fixas; nenhum pedido e lido.
-- Exige a coluna marketplace_orders.notes FECHADA para gravacao do painel: authenticated, anon e PUBLIC sem
-- UPDATE nela (por coluna, por tabela inteira ou por heranca de papel); authenticated atualiza so tracking_code;
-- service_role atualiza notes e tracking_code.
WITH ord AS (
  SELECT c.oid FROM pg_class c WHERE c.oid = to_regclass('public.marketplace_orders')
), pap AS (
  SELECT (SELECT oid FROM pg_roles WHERE rolname = 'anon') AS anon, (SELECT oid FROM pg_roles WHERE rolname = 'authenticated') AS auth, (SELECT oid FROM pg_roles WHERE rolname = 'service_role') AS srv
), col AS (
  SELECT (SELECT attnum FROM pg_attribute WHERE attrelid = (SELECT oid FROM ord) AND attname = 'notes' AND NOT attisdropped) AS notes,
         (SELECT attnum FROM pg_attribute WHERE attrelid = (SELECT oid FROM ord) AND attname = 'tracking_code' AND NOT attisdropped) AS rastreio
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN COALESCE(((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'notes: sem UPDATE para authenticated, anon e PUBLIC (coluna, tabela inteira ou heranca)', 'sim', CASE WHEN COALESCE((NOT has_column_privilege((SELECT auth FROM pap), (SELECT oid FROM ord), (SELECT notes FROM col), 'UPDATE')
    AND NOT has_column_privilege((SELECT anon FROM pap), (SELECT oid FROM ord), (SELECT notes FROM col), 'UPDATE')
    AND NOT EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
                     WHERE a.attrelid = (SELECT oid FROM ord) AND a.attname = 'notes' AND NOT a.attisdropped
                       AND g.privilege_type = 'UPDATE' AND g.grantee IN (0, (SELECT anon FROM pap), (SELECT auth FROM pap)))
    AND NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                     WHERE c.oid = (SELECT oid FROM ord) AND g.privilege_type = 'UPDATE' AND g.grantee IN (0, (SELECT anon FROM pap), (SELECT auth FROM pap)))), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tracking_code: authenticated atualiza so ele (sem GRANT OPTION), nenhuma outra coluna', 'sim', CASE WHEN COALESCE((has_column_privilege((SELECT auth FROM pap), (SELECT oid FROM ord), (SELECT rastreio FROM col), 'UPDATE')
    AND (SELECT string_agg(a.attname::text, ',' ORDER BY a.attname)
           FROM pg_attribute a
          WHERE a.attrelid = (SELECT oid FROM ord) AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege((SELECT auth FROM pap), (SELECT oid FROM ord), a.attnum, 'UPDATE')) = 'tracking_code'
    AND NOT EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
                     WHERE a.attrelid = (SELECT oid FROM ord) AND a.attnum > 0 AND NOT a.attisdropped
                       AND g.privilege_type = 'UPDATE' AND g.grantee = (SELECT auth FROM pap) AND g.is_grantable)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'anon e PUBLIC: sem UPDATE em coluna alguma de marketplace_orders', 'sim', CASE WHEN COALESCE((NOT EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = (SELECT oid FROM ord) AND a.attnum > 0 AND NOT a.attisdropped
                       AND (has_column_privilege((SELECT anon FROM pap), (SELECT oid FROM ord), a.attnum, 'UPDATE')
                            OR has_column_privilege('public'::name, (SELECT oid FROM ord), a.attnum, 'UPDATE')))
    AND NOT has_table_privilege((SELECT anon FROM pap), (SELECT oid FROM ord), 'UPDATE')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'service_role: atualiza notes e tracking_code', 'sim', CASE WHEN COALESCE((has_column_privilege((SELECT srv FROM pap), (SELECT oid FROM ord), (SELECT notes FROM col), 'UPDATE')
    AND has_column_privilege((SELECT srv FROM pap), (SELECT oid FROM ord), (SELECT rastreio FROM col), 'UPDATE')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'dependencias: marketplace_orders (notes e tracking_code) e os papeis anon, authenticated e service_role', 'sim', CASE WHEN COALESCE(((SELECT relkind = 'r' FROM pg_class WHERE oid = (SELECT oid FROM ord))
    AND (SELECT count(*) FROM pg_attribute WHERE attrelid = (SELECT oid FROM ord) AND attname IN ('notes', 'tracking_code') AND attnum > 0 AND NOT attisdropped) = 2
    AND (SELECT anon FROM pap) IS NOT NULL AND (SELECT auth FROM pap) IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

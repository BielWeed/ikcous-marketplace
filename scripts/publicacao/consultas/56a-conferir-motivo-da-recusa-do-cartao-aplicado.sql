-- 56a-conferir-motivo-da-recusa-do-cartao-aplicado: somente catalogo, 7 linhas fixas; nenhuma tentativa de cartao e lida.
-- Exige a tabela privada do diagnostico do cartao: so o servidor (service_role) a toca, RLS ligada e nenhuma politica.
WITH ord AS (
  SELECT c.oid, c.relowner AS dono FROM pg_class c WHERE c.oid = to_regclass('public.marketplace_orders')
), tb AS (
  SELECT c.oid FROM pg_class c WHERE c.oid = to_regclass('public.tentativas_cartao_diagnostico')
), checks AS (
  -- Canoniza so a apresentacao do catalogo; literais ficam INTACTOS (inclusive espacos e parenteses).
  SELECT k.conname, (
    SELECT string_agg(
      CASE WHEN left(pedaco[1], 1) = '''' THEN pedaco[1]
        ELSE regexp_replace(regexp_replace(pedaco[1],
          '::(text|numeric|integer|smallint)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g')
      END, '' ORDER BY ordem)
    FROM regexp_matches(pg_get_constraintdef(k.oid), '(''([^'']|'''')*''|[^'']+)', 'g')
      WITH ORDINALITY AS partes(pedaco, ordem)
  ) AS definicao
  FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tb) AND k.contype = 'c'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN COALESCE(((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tentativas_cartao_diagnostico: forma conhecida (colunas, restricoes, valores padrao, comentario)', 'sim', CASE WHEN COALESCE(((SELECT relkind = 'r' AND relpersistence = 'p' FROM pg_class WHERE oid = (SELECT oid FROM tb))
    AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
         FROM pg_attribute a WHERE a.attrelid = (SELECT oid FROM tb) AND a.attnum > 0 AND NOT a.attisdropped)
      = 'pedido_id:uuid:true,mp_order_id:text:true,mp_payment_id:text:true,status:text:true,status_detail:text:false,parcelas:smallint:false,valor:numeric(10,2):true,registrado_em:timestamp with time zone:true'
    AND (SELECT count(*) FROM pg_constraint WHERE conrelid = (SELECT oid FROM tb) AND contype NOT IN ('n')) = 8
    AND (SELECT count(*) FROM pg_constraint WHERE conrelid = (SELECT oid FROM tb) AND contype = 'c') = 6
    AND (SELECT count(*) FROM pg_constraint WHERE conrelid = (SELECT oid FROM tb) AND contype = 'p') = 0
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = (SELECT oid FROM tb) AND contype = 'f'
            AND conname = 'tentativas_cartao_diagnostico_pedido_id_fkey'
            AND replace(pg_get_constraintdef(oid), 'public.', '') = 'FOREIGN KEY (pedido_id) REFERENCES marketplace_orders(id)')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = (SELECT oid FROM tb) AND contype = 'u'
            AND conname = 'tentativas_cartao_diagnostico_order_payment_key'
            AND pg_get_constraintdef(oid) = 'UNIQUE (mp_order_id, mp_payment_id)')
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('tentativas_cartao_diagnostico_mp_order_id_check', 'CHECKmp_order_id~''^[A-Za-z0-9_-]{1,100}$'''),
        ('tentativas_cartao_diagnostico_mp_payment_id_check', 'CHECKmp_payment_id~''^[A-Za-z0-9_-]{1,100}$'''),
        ('tentativas_cartao_diagnostico_status_check', 'CHECKstatus=ANYARRAY[''failed'',''rejected'',''processing'',''in_process'',''pending'',''action_required'']'),
        ('tentativas_cartao_diagnostico_status_detail_check', 'CHECKstatus_detail~''^[a-z][a-z0-9_]{0,119}$'''),
        ('tentativas_cartao_diagnostico_parcelas_check', 'CHECKparcelas>=1ANDparcelas<=12'),
        ('tentativas_cartao_diagnostico_valor_check', 'CHECKvalor>0')
      ) AS esperado_check(nome, definicao)
      WHERE NOT EXISTS (
        SELECT 1 FROM checks k
        WHERE k.conname = esperado_check.nome AND k.definicao = esperado_check.definicao))
    AND (SELECT count(*) FROM pg_attrdef WHERE adrelid = (SELECT oid FROM tb)) = 1
    AND EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                 WHERE d.adrelid = (SELECT oid FROM tb) AND a.attname = 'registrado_em' AND pg_get_expr(d.adbin, d.adrelid) = 'now()')
    AND obj_description((SELECT oid FROM tb), 'pg_class') = 'cartao_diagnostico_20261260000000'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tentativas_cartao_diagnostico: indices (o unico do par mp_order_id e mp_payment_id e o da consulta por pedido), todos validos', 'sim', CASE WHEN COALESCE(((SELECT count(*) FROM pg_index WHERE indrelid = (SELECT oid FROM tb)) = 2
    AND NOT EXISTS (SELECT 1 FROM pg_index WHERE indrelid = (SELECT oid FROM tb) AND NOT (indisvalid AND indisready))
    AND EXISTS (SELECT 1 FROM pg_index i JOIN pg_constraint k ON k.conindid = i.indexrelid
             WHERE i.indrelid = (SELECT oid FROM tb) AND i.indisunique AND NOT i.indisprimary
               AND k.conrelid = (SELECT oid FROM tb) AND k.conname = 'tentativas_cartao_diagnostico_order_payment_key')
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tentativas_cartao_diagnostico'
             AND indexname = 'tentativas_cartao_diagnostico_pedido_idx'
             AND left(indexdef, 13) = 'CREATE INDEX '
             AND position('(pedido_id, registrado_em DESC)' IN indexdef) > 0)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tentativas_cartao_diagnostico: so servidor (service_role com SELECT, INSERT e UPDATE; nada a anon, authenticated e PUBLIC)', 'sim', CASE WHEN COALESCE(((SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = (SELECT oid FROM tb) AND g.grantee <> c.relowner) = 3
    AND (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = (SELECT oid FROM tb) AND g.grantee <> c.relowner
           AND g.grantee = 'service_role'::regrole AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE') AND NOT g.is_grantable) = 3
    AND NOT has_table_privilege('anon', (SELECT oid FROM tb), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_table_privilege('authenticated', (SELECT oid FROM tb), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND has_table_privilege('service_role', (SELECT oid FROM tb), 'SELECT')
    AND has_table_privilege('service_role', (SELECT oid FROM tb), 'INSERT')
    AND has_table_privilege('service_role', (SELECT oid FROM tb), 'UPDATE')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tentativas_cartao_diagnostico: RLS ligada (sem FORCE) e nenhuma politica', 'sim', CASE WHEN COALESCE(((SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid = (SELECT oid FROM tb))
    AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = (SELECT oid FROM tb))), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tentativas_cartao_diagnostico: dono certo, sem gatilho, fora do realtime e sem ACL de coluna', 'sim', CASE WHEN COALESCE(((SELECT relowner = (SELECT dono FROM ord) FROM pg_class WHERE oid = (SELECT oid FROM tb))
    AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = (SELECT oid FROM tb) AND NOT tgisinternal)
    AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = (SELECT oid FROM tb) AND attacl IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'tentativas_cartao_diagnostico')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'dependencias: marketplace_orders (id uuid) e os papeis anon, authenticated e service_role', 'sim', CASE WHEN COALESCE(((SELECT relkind = 'r' FROM pg_class WHERE oid = to_regclass('public.marketplace_orders'))
    AND (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'id' AND NOT a.attisdropped) = 'uuid'
    AND (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

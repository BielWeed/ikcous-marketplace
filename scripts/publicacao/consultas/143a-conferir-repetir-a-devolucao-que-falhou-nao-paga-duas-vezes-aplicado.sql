-- 143a-conferir-repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-aplicado: DEPOIS da 20261399991000 (a funcao solicitar_estorno_repetindo(uuid, text) e a tabela order_refund_repeticao,
-- md5 do corpo 018d9480bacfc4776b6f3424d303a3ee). SO LEITURA, somente catalogo; rol fechado de 5 linhas. Nao le nenhuma devolucao, nenhum pedido e nenhuma marca e nao chama a funcao.
-- Antes do apply responde "AUSENTE" ou "nao" nas linhas da migration (a 143a negativa e' esperada), nunca erro.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql'
     AND p.prokind = 'f'
     AND p.prosecdef
     AND p.provolatile = 'v'
     AND NOT p.proisstrict
     AND NOT p.proretset
     AND p.pronargs = 2
     AND p.prorettype = 'jsonb'::regtype
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'solicitar_estorno_repetindo') = 1) AS atributos
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_repetindo'
), tab AS (
  SELECT c.oid, c.relrowsecurity AS rls,
         (SELECT count(*) FROM pg_policy po WHERE po.polrelid = c.oid) AS politicas,
         (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attname)
            FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
         EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary
                  AND (SELECT array_agg(a.attname::text) FROM pg_attribute a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['refund_id']) AS pk,
         EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisunique AND NOT i.indisprimary AND i.indpred IS NULL AND i.indnatts = 1
                  AND (SELECT array_agg(a.attname::text) FROM pg_attribute a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['nova_refund_id']) AS uniq,
         (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f' AND k.confrelid = to_regclass('public.order_refunds') AND k.confdeltype = 'c') AS fks,
         (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
          OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
          OR has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
          OR EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee = 0)) AS aberta
    FROM pg_class c
   WHERE c.oid = to_regclass('public.order_refund_repeticao')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'solicitar_estorno_repetindo: corpo exato (md5)', '018d9480bacfc4776b6f3424d303a3ee',
         COALESCE((SELECT h FROM fn LIMIT 1), 'AUSENTE')
  UNION ALL
  SELECT 'solicitar_estorno_repetindo: uma so, atributos conhecidos (SECURITY DEFINER, plpgsql, VOLATILE, retorno jsonb, search_path=public) e EXECUTE so do authenticated (nem PUBLIC, anon ou service_role)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT atributos FROM fn LIMIT 1)
                   AND NOT EXISTS (SELECT 1 FROM fn f2, aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = f2.oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = f2.oid)))) g
                                    WHERE g.privilege_type = 'EXECUTE' AND g.grantee = 0)
                   AND NOT has_function_privilege('anon', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND NOT has_function_privilege('service_role', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND has_function_privilege('authenticated', (SELECT oid FROM fn LIMIT 1), 'EXECUTE') THEN 'sim'
              ELSE 'nao' END
  UNION ALL
  SELECT 'order_refund_repeticao: so do servidor (RLS ligada, nenhuma policy, nenhum acesso de PUBLIC, anon, authenticated e service_role)',
         'rls=sim politicas=0 aberta=nao',
         COALESCE((SELECT 'rls=' || CASE WHEN t.rls THEN 'sim' ELSE 'nao' END
                          || ' politicas=' || t.politicas::text
                          || ' aberta=' || CASE WHEN t.aberta THEN 'sim' ELSE 'nao' END
                     FROM tab t), 'AUSENTE')
  UNION ALL
  SELECT 'order_refund_repeticao: tres colunas (refund_id, nova_refund_id, created_at), PK em refund_id, UNIQUE em nova_refund_id e duas chaves estrangeiras ON DELETE CASCADE',
         'created_at:timestamp with time zone,nova_refund_id:uuid,refund_id:uuid pk=sim uniq=sim fks=2',
         COALESCE((SELECT t.colunas || ' pk=' || CASE WHEN t.pk THEN 'sim' ELSE 'nao' END
                          || ' uniq=' || CASE WHEN t.uniq THEN 'sim' ELSE 'nao' END
                          || ' fks=' || t.fks::text
                     FROM tab t), 'AUSENTE')
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY (vivo = esperado), item;

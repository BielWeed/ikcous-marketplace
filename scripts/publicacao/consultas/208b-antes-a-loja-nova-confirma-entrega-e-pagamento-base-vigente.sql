-- 208b-antes-a-loja-nova-confirma-entrega-e-pagamento-base-vigente: ANTES da 20261652000000; prova que a loja esta na base
-- que o pre-voo dela aceita: upsert_store_config com o corpo da 20261643000000 (ou o desta, reaplicacao), atributos e ACL
-- de sempre, as colunas de confirmacao ausentes as duas (ou as duas com a forma desta, reaplicacao) e as guardas de admin
-- existentes. Positiva antes e depois do apply; depois do rollback-manual tambem.
-- SO LEITURA: apenas catalogo, rol fechado de 4 linhas; nenhum dado de loja ou de cliente e lido, nenhuma funcao e chamada.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS m,
         p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
           AND NOT p.proretset
           AND p.proconfig = ARRAY['search_path=public']::text[]
           AND pg_get_function_result(p.oid) = 'jsonb'
           AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = p.proname) = 1
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND has_function_privilege('service_role', p.oid, 'EXECUTE') AS atributos_ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.upsert_store_config(jsonb)')
), colunas AS (
  SELECT count(*) AS todas,
         count(*) FILTER (WHERE a.atttypid = 'timestamptz'::regtype AND NOT a.attnotnull AND NOT a.atthasdef) AS na_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.store_config') AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('entrega_confirmada_em', 'pagamento_confirmado_em')
), itens(item, esperado, vivo) AS (
  SELECT 'upsert_store_config: corpo da 20261643000000 ou desta (md5)', '2f772ffd1370359ba6c64540b71c35b2',
         COALESCE((SELECT CASE WHEN m = '3c62896ca905200f1a931ac6ccfed297' THEN '2f772ffd1370359ba6c64540b71c35b2' ELSE m END
                     FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: uma assinatura so, SECURITY DEFINER plpgsql VOLATILE com search_path=public, retorno jsonb, EXECUTE de authenticated e service_role (nem anon nem PUBLIC)', 'sim',
         CASE WHEN COALESCE((SELECT atributos_ok FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'store_config: colunas de confirmacao ausentes as duas, ou as duas timestamptz anulaveis sem default (reaplicacao)', 'sim',
         CASE WHEN (SELECT todas = 0 OR (todas = 2 AND na_forma = 2) FROM colunas) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'is_admin() e is_admin_atual() existem', 'sim',
         CASE WHEN to_regprocedure('public.is_admin()') IS NOT NULL AND to_regprocedure('public.is_admin_atual()') IS NOT NULL
              THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

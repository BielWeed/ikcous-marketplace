-- 208a-conferir-a-loja-nova-confirma-entrega-e-pagamento-aplicado: DEPOIS da 20261652000000; exige o corpo novo de
-- upsert_store_config (aceita as chaves de confirmacao), a mesma assinatura, atributos e ACL de sempre, e as duas colunas
-- de confirmacao em store_config (timestamptz, anulaveis, sem default). Antes do apply responde o corpo vivo, nunca erro.
-- SO LEITURA: apenas catalogo, rol fechado de 4 linhas; nenhum dado de loja ou de cliente e lido (nem a ficha id = 1),
-- nenhuma funcao e chamada.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS m,
         p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
           AND NOT p.proretset AND NOT p.proisstrict
           AND p.pronargs = 1 AND p.pronargdefaults = 0
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
  SELECT count(*) AS n FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.store_config') AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('entrega_confirmada_em', 'pagamento_confirmado_em')
     AND a.atttypid = 'timestamptz'::regtype AND NOT a.attnotnull AND NOT a.atthasdef
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'upsert_store_config: corpo exato (md5), aceita as chaves de confirmacao', '3c62896ca905200f1a931ac6ccfed297',
         COALESCE((SELECT m FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: uma assinatura so, SECURITY DEFINER plpgsql VOLATILE com search_path=public, retorno jsonb, EXECUTE de authenticated e service_role (nem anon nem PUBLIC)', 'sim',
         CASE WHEN COALESCE((SELECT atributos_ok FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'store_config: entrega_confirmada_em e pagamento_confirmado_em timestamptz, anulaveis, sem default', '2',
         (SELECT n::text FROM colunas)
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

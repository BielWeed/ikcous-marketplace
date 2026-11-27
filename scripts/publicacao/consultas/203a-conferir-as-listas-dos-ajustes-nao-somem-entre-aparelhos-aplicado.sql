-- 203a-conferir-as-listas-dos-ajustes-nao-somem-entre-aparelhos-aplicado: DEPOIS da 20261643000000; exige os dois corpos novos
-- (upsert_store_config e salvar_politica_de_devolucao, que conferem a lista vista e recusam com LST01) e a mesma assinatura,
-- atributos e ACL de sempre. Antes do apply responde o corpo vivo, nunca erro.
-- SO LEITURA: apenas catalogo, rol fechado de 4 linhas; nenhum dado de loja ou de cliente e lido, nenhuma funcao e chamada.
WITH fn AS (
  SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS m,
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
   WHERE p.oid IN (to_regprocedure('public.upsert_store_config(jsonb)'), to_regprocedure('public.salvar_politica_de_devolucao(jsonb)'))
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'upsert_store_config: corpo exato (md5)', '2f772ffd1370359ba6c64540b71c35b2',
         COALESCE((SELECT m FROM fn WHERE proname = 'upsert_store_config'), 'AUSENTE')
  UNION ALL
  SELECT 'salvar_politica_de_devolucao: corpo exato (md5)', '976f05a67ca929ace608a62391588bcd',
         COALESCE((SELECT m FROM fn WHERE proname = 'salvar_politica_de_devolucao'), 'AUSENTE')
  UNION ALL
  SELECT 'as duas RPCs: uma assinatura so cada, SECURITY DEFINER plpgsql VOLATILE com search_path=public, retorno jsonb, EXECUTE de authenticated e service_role (nem anon nem PUBLIC)', 'sim',
         CASE WHEN (SELECT count(*) FROM fn WHERE atributos_ok) = 2 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

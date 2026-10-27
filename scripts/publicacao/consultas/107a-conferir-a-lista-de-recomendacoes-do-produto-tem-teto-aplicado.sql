-- 107a-conferir-a-lista-de-recomendacoes-do-produto-tem-teto-aplicado: DEPOIS da 20261394100000 (o desta migration, md5 5e5bbe7bc7f12738a9082232ee6cfee6).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhum produto e nao chama a get_product_recommendations.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
     AND pg_get_function_arguments(p.oid) = 'p_product_id uuid, p_limit integer DEFAULT 4'
     AND pg_get_function_result(p.oid) = 'SETOF produtos'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'get_product_recommendations') = 1) AS atributos,
    (length(p.prosrc) - length(replace(p.prosrc, 'LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50);', '')))
      / length('LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50);') AS n_teto
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_product_recommendations'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_product_recommendations: corpo exato (md5)', '5e5bbe7bc7f12738a9082232ee6cfee6',
         COALESCE((SELECT h FROM fn LIMIT 1), 'AUSENTE')
  UNION ALL
  SELECT 'get_product_recommendations: o corpo traz o teto do limite (uma vez)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT n_teto FROM fn LIMIT 1) = 1 THEN 'sim'
              WHEN (SELECT n_teto FROM fn LIMIT 1) = 0 THEN 'nao'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'get_product_recommendations: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, SETOF produtos; anon, authenticated e service_role, sem PUBLIC)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT atributos FROM fn LIMIT 1)
                   AND NOT EXISTS (SELECT 1 FROM fn f2, aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = f2.oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = f2.oid)))) g
                                    WHERE g.privilege_type = 'EXECUTE' AND g.grantee = 0)
                   AND has_function_privilege('anon', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND has_function_privilege('authenticated', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND has_function_privilege('service_role', (SELECT oid FROM fn LIMIT 1), 'EXECUTE') THEN 'sim'
              ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY (vivo = esperado), item;

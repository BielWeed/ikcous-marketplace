-- 109a-conferir-a-grade-antiga-nao-ressuscita-variacao-excluida-aplicado: DEPOIS da 20261395100000 (o corpo desta migration, md5 10fc8c0f1e305666b39e5f1f383815e2).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhuma linha de dado e nao chama a salvar_produto_com_grade.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql'
     AND p.prokind = 'f'
     AND p.prosecdef
     AND p.provolatile = 'v'
     AND NOT p.proisstrict
     AND p.pronargs = 5
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND pg_get_function_arguments(p.oid) = 'p_produto_id uuid, p_base_atualizado_em timestamp with time zone, p_produto jsonb, p_variantes jsonb, p_apagar uuid[]'
     AND pg_get_function_result(p.oid) = 'jsonb'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'salvar_produto_com_grade') = 1) AS atributos,
    (length(p.prosrc) - length(replace(p.prosrc, '20261395100000: variacao que alguem excluiu', '')))
      / length('20261395100000: variacao que alguem excluiu') AS n_marca
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'salvar_produto_com_grade'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'salvar_produto_com_grade: corpo exato (md5)', '10fc8c0f1e305666b39e5f1f383815e2',
         COALESCE((SELECT h FROM fn LIMIT 1), 'AUSENTE')
  UNION ALL
  SELECT 'salvar_produto_com_grade: o corpo traz a recusa de ressuscitar variacao (uma vez)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT n_marca FROM fn LIMIT 1) = 1 THEN 'sim'
              WHEN (SELECT n_marca FROM fn LIMIT 1) = 0 THEN 'nao'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'salvar_produto_com_grade: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT atributos FROM fn LIMIT 1)
                   AND NOT EXISTS (SELECT 1 FROM fn f2, aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = f2.oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = f2.oid)))) g
                                    WHERE g.privilege_type = 'EXECUTE' AND g.grantee = 0)
                   AND NOT has_function_privilege('anon', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND has_function_privilege('authenticated', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND has_function_privilege('service_role', (SELECT oid FROM fn LIMIT 1), 'EXECUTE') THEN 'sim'
              ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY (vivo = esperado), item;

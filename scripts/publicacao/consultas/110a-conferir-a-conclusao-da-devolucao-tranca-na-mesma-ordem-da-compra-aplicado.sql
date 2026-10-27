-- 110a-conferir-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-aplicado: DEPOIS da 20261395200000 (o corpo desta migration, md5 a152c8dcd7cf6d1e05e5aff128d6c45e).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhuma linha de dado e nao chama a admin_devolucao_concluir.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql'
     AND p.prokind = 'f'
     AND p.prosecdef
     AND p.provolatile = 'v'
     AND NOT p.proisstrict
     AND p.pronargs = 5
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND pg_get_function_arguments(p.oid) = 'p_id uuid, p_resolucao text, p_itens jsonb, p_valor_reembolso numeric DEFAULT NULL::numeric, p_observacao text DEFAULT NULL::text'
     AND pg_get_function_result(p.oid) = 'jsonb'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'admin_devolucao_concluir') = 1) AS atributos,
    (length(p.prosrc) - length(replace(p.prosrc, '>>> ordem global das travas (20261395200000)', '')))
      / length('>>> ordem global das travas (20261395200000)') AS n_marca
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_devolucao_concluir'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'admin_devolucao_concluir: corpo exato (md5)', 'a152c8dcd7cf6d1e05e5aff128d6c45e',
         COALESCE((SELECT h FROM fn LIMIT 1), 'AUSENTE')
  UNION ALL
  SELECT 'admin_devolucao_concluir: o corpo traz a ordem global das travas (uma vez)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT n_marca FROM fn LIMIT 1) = 1 THEN 'sim'
              WHEN (SELECT n_marca FROM fn LIMIT 1) = 0 THEN 'nao'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'admin_devolucao_concluir: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)', 'sim',
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

-- 108b-antes-a-busca-de-devolucao-acha-o-numero-do-pedido-base-vigente: ANTES da 20261395000000 (o vigente, o da 20261199000000, md5 5a632e0a239104598dcdc4eb323c09b1).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhuma linha de dado e nao chama a admin_devolucoes_listar.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql'
     AND p.prokind = 'f'
     AND p.prosecdef
     AND p.provolatile = 's'
     AND NOT p.proisstrict
     AND p.pronargs = 4
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND pg_get_function_arguments(p.oid) = 'p_status text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0'
     AND pg_get_function_result(p.oid) = 'jsonb'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'admin_devolucoes_listar') = 1) AS atributos,
    (length(p.prosrc) - length(replace(p.prosrc, '20261395000000: o numero que o painel mostra', '')))
      / length('20261395000000: o numero que o painel mostra') AS n_marca
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_devolucoes_listar'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'admin_devolucoes_listar: corpo exato (md5)', '5a632e0a239104598dcdc4eb323c09b1',
         COALESCE((SELECT h FROM fn LIMIT 1), 'AUSENTE')
  UNION ALL
  SELECT 'admin_devolucoes_listar: o corpo traz a busca pelo numero do pedido (uma vez)', 'nao',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT n_marca FROM fn LIMIT 1) = 1 THEN 'sim'
              WHEN (SELECT n_marca FROM fn LIMIT 1) = 0 THEN 'nao'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'admin_devolucoes_listar: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, STABLE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)', 'sim',
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

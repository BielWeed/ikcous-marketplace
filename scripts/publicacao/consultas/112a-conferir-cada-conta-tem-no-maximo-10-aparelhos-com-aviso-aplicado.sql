-- 112a-conferir-cada-conta-tem-no-maximo-10-aparelhos-com-aviso-aplicado: DEPOIS da 20261396000000 (a funcao push_inscricoes_limite_por_conta e o gatilho
-- tr_push_inscricoes_limite_por_conta em public.push_subscriptions, md5 do corpo 4c716de5f5ccb38f93db187dcf64bf00).
-- SO LEITURA, somente catalogo; rol fechado de 4 linhas. Nao le nenhuma inscricao e nao chama a funcao. Antes do apply responde "AUSENTE" ou "nao"
-- nas linhas da migration (a 112a negativa e' esperada), nunca erro.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql'
     AND p.prokind = 'f'
     AND p.prosecdef
     AND p.provolatile = 'v'
     AND NOT p.proisstrict
     AND NOT p.proretset
     AND p.pronargs = 0
     AND p.prorettype = 'trigger'::regtype
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'push_inscricoes_limite_por_conta') = 1) AS atributos
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'push_inscricoes_limite_por_conta'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'push_inscricoes_limite_por_conta: corpo exato (md5)', '4c716de5f5ccb38f93db187dcf64bf00',
         COALESCE((SELECT h FROM fn LIMIT 1), 'AUSENTE')
  UNION ALL
  SELECT 'push_inscricoes_limite_por_conta: uma so, atributos conhecidos (SECURITY DEFINER, plpgsql, VOLATILE, retorno trigger, search_path=public) e fechada a PUBLIC, anon, authenticated e service_role', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT atributos FROM fn LIMIT 1)
                   AND NOT EXISTS (SELECT 1 FROM fn f2, aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = f2.oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = f2.oid)))) g
                                    WHERE g.privilege_type = 'EXECUTE' AND g.grantee = 0)
                   AND NOT has_function_privilege('anon', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND NOT has_function_privilege('authenticated', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND NOT has_function_privilege('service_role', (SELECT oid FROM fn LIMIT 1), 'EXECUTE') THEN 'sim'
              ELSE 'nao' END
  UNION ALL
  SELECT 'push_subscriptions: gatilho tr_push_inscricoes_limite_por_conta BEFORE INSERT por linha, ligado, sem WHEN, chamando a funcao', 'sim',
         CASE WHEN COALESCE(
           (SELECT count(*) = 1 AND bool_and(t.tgtype = 7 AND t.tgenabled = 'O' AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgattr::text = ''
                    AND t.tgfoid = to_regprocedure('public.push_inscricoes_limite_por_conta()'))
              FROM pg_trigger t
             WHERE t.tgname = 'tr_push_inscricoes_limite_por_conta' AND t.tgrelid = to_regclass('public.push_subscriptions') AND NOT t.tgisinternal), false)
              AND (SELECT count(*) FROM pg_trigger t2 WHERE t2.tgname = 'tr_push_inscricoes_limite_por_conta') = 1 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY (vivo = esperado), item;

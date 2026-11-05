-- 116a-conferir-o-inicio-compara-o-mes-anterior-ate-a-mesma-hora-aplicado: DEPOIS da 20261398000000 (o desta migration, md5 01d29aedf98b7f95851c1a1001b5c7ca).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhum pedido, lancamento nem cliente e nao chama a painel_inicio.
-- A painel_inicio tem uma SUCESSORA, a 20261399300000 (o estorno em andamento nao e conta vencida; md5 8d58e15e7410afe0d254f37f38251df4): a linha do
-- corpo aceita os DOIS corpos exatos e, aceito o da sucessora, o `vivo` mostra o `esperado` (quem distingue os dois e a 119a).
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.proretset
     AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_arguments(p.oid) = ''
     AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'painel_inicio') = 1) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.painel_inicio()')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'painel_inicio: corpo exato (md5)', '01d29aedf98b7f95851c1a1001b5c7ca',
    COALESCE((SELECT CASE WHEN h IN ('01d29aedf98b7f95851c1a1001b5c7ca', '8d58e15e7410afe0d254f37f38251df4') THEN '01d29aedf98b7f95851c1a1001b5c7ca' ELSE h END FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'painel_inicio: EXECUTE authenticated e service_role, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

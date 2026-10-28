-- 97a-conferir-o-lucro-do-inicio-conta-o-mes-inteiro-aplicado: DEPOIS da 20261390000000 (o desta migration, md5 b4aa318b777824bd49aab4175d9133f8).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhum pedido, lancamento nem cliente e nao chama a painel_inicio.
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
  SELECT 'painel_inicio: corpo exato (md5)', 'b4aa318b777824bd49aab4175d9133f8',
    -- A 20261398000000 (o Inicio compara o mes anterior ate a mesma hora: o mesmo corpo com o ultimo dia do mes anterior cortado na hora)
    -- sucede a 390: aceita os dois corpos EXATOS; normaliza ao esperado desta migration. O `vivo` mostra o esperado (quem distingue e a 116a).
    COALESCE((SELECT CASE WHEN h IN ('b4aa318b777824bd49aab4175d9133f8', '01d29aedf98b7f95851c1a1001b5c7ca') THEN 'b4aa318b777824bd49aab4175d9133f8' ELSE h END FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'painel_inicio: EXECUTE authenticated e service_role, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

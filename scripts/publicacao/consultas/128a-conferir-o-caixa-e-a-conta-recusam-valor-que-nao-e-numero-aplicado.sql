-- 128a-conferir-o-caixa-e-a-conta-recusam-valor-que-nao-e-numero-aplicado: DEPOIS da 20261399930000.
-- SO LEITURA, so catalogo; rol fechado de 7 linhas. Nao le nenhuma linha financeira.
-- Hash = md5(replace(prosrc, chr(13), '')); corpo desconhecido ou ausente recusa.
WITH alvo(nome, assinatura, argumentos) AS (
  VALUES ('fin_caixa_abrir', 'public.fin_caixa_abrir(numeric,uuid)', 'p_valor_abertura numeric, p_conta_id uuid DEFAULT NULL::uuid'),
         ('fin_conta_salvar', 'public.fin_conta_salvar(jsonb)', 'p jsonb')
), fn AS (
  SELECT t.nome, p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
     AND NOT p.proisstrict AND NOT p.proretset AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_arguments(p.oid) = t.argumentos
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = t.nome) = 1) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM alvo t JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
  JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_abrir: corpo exato (md5)', '367d298dcc78bc2829fc4e0048005a0c',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_caixa_abrir'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_caixa_abrir: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_caixa_abrir'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_abrir: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_caixa_abrir'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_conta_salvar: corpo exato (md5)', '1dc6cfdb075e3a1a0882398e1220d0f1',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_conta_salvar'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_conta_salvar: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_conta_salvar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_conta_salvar: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_conta_salvar'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

-- 219a-conferir-a-despesa-nao-entra-no-caixa-fechado-aplicado: DEPOIS da 20261663000000 (a despesa nao entra no caixa fechado).
-- SO LEITURA, so catalogo; rol fechado de 7 linhas. Nao le nenhuma linha financeira nem chama funcao da loja.
-- Hash = md5(replace(prosrc, chr(13), '')); corpo desconhecido ou ausente recusa. Espera os dois corpos desta
-- (fin_lancamento_salvar e fin_lancamento_baixar, com a leitura da sessao aberta travada), com os atributos e a ACL de sempre.
WITH alvo(nome, assinatura, argumentos) AS (
  VALUES ('fin_lancamento_salvar', 'public.fin_lancamento_salvar(jsonb)', 'p jsonb'),
         ('fin_lancamento_baixar', 'public.fin_lancamento_baixar(uuid,date,uuid)', 'p_id uuid, p_data date DEFAULT NULL::date, p_conta_id uuid DEFAULT NULL::uuid')
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
  SELECT 'fin_lancamento_salvar: corpo exato (md5)', '729fc6e3e4a643459df835d214fa082e',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_lancamento_salvar'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_lancamento_salvar: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_lancamento_salvar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_salvar: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_lancamento_salvar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_baixar: corpo exato (md5)', '0abf8da5b460d8b8236ffb5ffc111524',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_lancamento_baixar'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_lancamento_baixar: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_lancamento_baixar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_baixar: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_lancamento_baixar'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

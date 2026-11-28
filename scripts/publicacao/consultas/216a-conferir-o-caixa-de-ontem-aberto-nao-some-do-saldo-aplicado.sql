-- 216a-conferir-o-caixa-de-ontem-aberto-nao-some-do-saldo-aplicado: DEPOIS da 20261660000000 (o caixa de ontem aberto nao some do saldo).
-- SO LEITURA, so catalogo; rol fechado de 10 linhas. Nao le nenhuma linha financeira nem chama funcao da loja.
-- Hash = md5(replace(prosrc, chr(13), '')); corpo desconhecido ou ausente recusa. Espera os tres corpos desta
-- (fin_conta_salvar, fin_caixa_movimentar_com_chave e fin_lancamento_cancelar), com os atributos e a ACL de sempre.
WITH alvo(nome, assinatura, argumentos) AS (
  VALUES ('fin_conta_salvar', 'public.fin_conta_salvar(jsonb)', 'p jsonb'),
         ('fin_caixa_movimentar_com_chave', 'public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)', 'p_sessao_id uuid, p_chave uuid, p_tipo text, p_valor numeric, p_descricao text, p_conta_contrapartida uuid DEFAULT NULL::uuid'),
         ('fin_lancamento_cancelar', 'public.fin_lancamento_cancelar(uuid,text)', 'p_id uuid, p_motivo text')
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
  SELECT 'fin_conta_salvar: corpo exato (md5)', 'd29894a41940ec4f5bc55ca2b103b69a',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_conta_salvar'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_conta_salvar: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_conta_salvar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_conta_salvar: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_conta_salvar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_movimentar_com_chave: corpo exato (md5)', 'b7df8a8d11d64ab2cc2bd1dc31a57ae3',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_caixa_movimentar_com_chave'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_caixa_movimentar_com_chave: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_caixa_movimentar_com_chave'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_movimentar_com_chave: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_caixa_movimentar_com_chave'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_cancelar: corpo exato (md5)', 'ee75614cd65e5a7339045320e8a855c3',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_lancamento_cancelar'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_lancamento_cancelar: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_lancamento_cancelar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_cancelar: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_lancamento_cancelar'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

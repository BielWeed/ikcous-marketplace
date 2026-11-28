-- 216b-antes-o-caixa-de-ontem-aberto-nao-some-do-saldo-base-vigente: ANTES da 20261660000000 (o caixa de ontem aberto nao some do saldo).
-- SO LEITURA, so catalogo; rol fechado de 10 linhas (o mesmo da 216a). Nao le nenhuma linha financeira nem chama funcao da loja.
-- Hash = md5(replace(prosrc, chr(13), '')); espera os corpos vigentes de antes: fin_conta_salvar da 20261399930000,
-- fin_caixa_movimentar_com_chave da 20261654000000 e fin_lancamento_cancelar da 20261199000000.
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
  SELECT 'fin_conta_salvar: corpo exato (md5)', '1dc6cfdb075e3a1a0882398e1220d0f1',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_conta_salvar'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_conta_salvar: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_conta_salvar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_conta_salvar: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_conta_salvar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_movimentar_com_chave: corpo exato (md5)', 'f1b22fd85f7a4ae2200d37001c9e1ffb',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_caixa_movimentar_com_chave'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_caixa_movimentar_com_chave: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_caixa_movimentar_com_chave'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_movimentar_com_chave: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_caixa_movimentar_com_chave'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_cancelar: corpo exato (md5)', 'a0b036d6d16d323dc806732b85b8b1cf',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_lancamento_cancelar'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_lancamento_cancelar: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_lancamento_cancelar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_cancelar: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_lancamento_cancelar'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

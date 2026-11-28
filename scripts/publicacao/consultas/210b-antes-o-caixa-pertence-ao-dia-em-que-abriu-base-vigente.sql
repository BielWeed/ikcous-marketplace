-- 210b-antes-o-caixa-pertence-ao-dia-em-que-abriu-base-vigente: ANTES da 20261654000000 (o caixa pertence ao dia em que abriu).
-- SO LEITURA, so catalogo; rol fechado de 13 linhas. Nao le nenhuma linha financeira.
-- Hash = md5(replace(prosrc, chr(13), '')); corpo desconhecido ou ausente recusa.
WITH alvo(nome, assinatura, argumentos) AS (
  VALUES ('fin_lancamento_salvar', 'public.fin_lancamento_salvar(jsonb)', 'p jsonb'),
         ('fin_lancamento_baixar', 'public.fin_lancamento_baixar(uuid,date,uuid)', 'p_id uuid, p_data date DEFAULT NULL::date, p_conta_id uuid DEFAULT NULL::uuid'),
         ('fin_caixa_fechar_sessao', 'public.fin_caixa_fechar_sessao(uuid,numeric,text)', 'p_sessao_id uuid, p_valor_contado numeric, p_observacao text DEFAULT NULL::text'),
         ('fin_caixa_movimentar_com_chave', 'public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)', 'p_sessao_id uuid, p_chave uuid, p_tipo text, p_valor numeric, p_descricao text, p_conta_contrapartida uuid DEFAULT NULL::uuid')
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
  SELECT 'fin_lancamento_salvar: corpo exato (md5)', '1356dbfc037a9202ef163ba598854891',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_lancamento_salvar'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_lancamento_salvar: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_lancamento_salvar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_salvar: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_lancamento_salvar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_baixar: corpo exato (md5)', 'e59bc12ea20182da4209a257df0be8c1',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_lancamento_baixar'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_lancamento_baixar: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_lancamento_baixar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_lancamento_baixar: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_lancamento_baixar'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_fechar_sessao: corpo exato (md5)', 'f10208ba223450fd25af3c9e11dca073',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_caixa_fechar_sessao'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_caixa_fechar_sessao: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_caixa_fechar_sessao'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_fechar_sessao: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_caixa_fechar_sessao'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_movimentar_com_chave: corpo exato (md5)', '134bd5b7c5872bf30041601725fc37ba',
    COALESCE((SELECT h FROM fn WHERE nome = 'fin_caixa_movimentar_com_chave'), 'AUSENTE')
  UNION ALL
  SELECT 'fin_caixa_movimentar_com_chave: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'fin_caixa_movimentar_com_chave'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_movimentar_com_chave: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'fin_caixa_movimentar_com_chave'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

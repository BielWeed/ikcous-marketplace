-- 214a-conferir-o-frete-de-ida-so-volta-com-reembolso-aplicado: DEPOIS da 20261658000000 (o frete de ida so volta com reembolso).
-- SO LEITURA, so catalogo; rol fechado de 7 linhas. Nao le nenhuma devolucao, pedido ou item e nao chama nenhuma das duas funcoes.
-- Hash = md5(replace(prosrc, chr(13), '')); corpo desconhecido ou ausente recusa.
WITH alvo(nome, assinatura, argumentos, volatilidade) AS (
  VALUES ('devolucao_elegibilidade', 'public.devolucao_elegibilidade(uuid)', 'p_order_id uuid', 's'),
         ('solicitar_devolucao', 'public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])', 'p_order_id uuid, p_itens jsonb, p_motivo text, p_detalhe text, p_resolucao text, p_metodo text, p_fotos text[] DEFAULT ''{}''::text[]', 'v')
), fn AS (
  SELECT t.nome, p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile::text = t.volatilidade
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
  SELECT 'devolucao_elegibilidade: corpo exato (md5)', '4776618e9ccd401f7c7eb9518ceaa62d',
    COALESCE((SELECT h FROM fn WHERE nome = 'devolucao_elegibilidade'), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao_elegibilidade: uma so, assinatura e atributos conhecidos (plpgsql, SECURITY DEFINER, STABLE, search_path=public, retorno jsonb)', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'devolucao_elegibilidade'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'devolucao_elegibilidade: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'devolucao_elegibilidade'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'solicitar_devolucao: corpo exato (md5)', 'e3f83a07f0a4909fb879ac653c115871',
    COALESCE((SELECT h FROM fn WHERE nome = 'solicitar_devolucao'), 'AUSENTE')
  UNION ALL
  SELECT 'solicitar_devolucao: uma so, assinatura e atributos conhecidos (plpgsql, SECURITY DEFINER, VOLATILE, search_path=public, retorno jsonb)', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE nome = 'solicitar_devolucao'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'solicitar_devolucao: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE nome = 'solicitar_devolucao'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

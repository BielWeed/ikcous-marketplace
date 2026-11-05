-- 120a-conferir-a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-aplicado: DEPOIS da 20261399400000 (a cliente e avisada no sino quando a loja responde a avaliacao dela: reply_review_atomic, as duas sobrecargas, md5 f617966c37037537410c3c78d85b8785 e 08569f17f477dea9ff87709ca3edd218).
-- Cada corpo e o vigente da 20261360000000 MAIS o passo 3 (aviso em notificacoes, um por avaliacao, best-effort); a linha do log de push segue sendo gravada (a consulta 27m depende dela).
-- SO LEITURA, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode); rol fechado de 8 linhas, as mesmas em qualquer estado do banco (funcao ausente vira AUSENTE na propria linha, nunca some uma linha).
-- Nao le nenhuma avaliacao, notificacao, produto nem cliente e nao chama nenhuma das duas funcoes.
WITH fn AS (
  SELECT 'dois' AS k, p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
     AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset AND p.proparallel = 'u' AND p.procost = 100
     AND p.prorettype = 'void'::regtype
     AND pg_get_function_arguments(p.oid) = 'p_review_id uuid, p_reply text'
     AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.reply_review_atomic(uuid,text)')
  UNION ALL
  SELECT 'tres', p.oid, md5(replace(p.prosrc, chr(13), '')),
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
     AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset AND p.proparallel = 'u' AND p.procost = 100
     AND p.prorettype = 'void'::regtype
     AND pg_get_function_arguments(p.oid) = 'p_review_id uuid, p_reply text, p_admin_id uuid'
     AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))),
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.reply_review_atomic(uuid,text,uuid)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'reply_review_atomic: exatamente duas sobrecargas', '2',
    (SELECT count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'reply_review_atomic')
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text): corpo exato (md5)', 'f617966c37037537410c3c78d85b8785',
    COALESCE((SELECT h FROM fn WHERE k = 'dois'), 'AUSENTE')
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text): assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE k = 'dois'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text): EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE k = 'dois'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text,uuid): corpo exato (md5)', '08569f17f477dea9ff87709ca3edd218',
    COALESCE((SELECT h FROM fn WHERE k = 'tres'), 'AUSENTE')
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text,uuid): assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE k = 'tres'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text,uuid): EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE k = 'tres'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

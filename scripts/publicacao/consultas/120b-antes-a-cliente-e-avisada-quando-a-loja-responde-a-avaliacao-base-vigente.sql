-- 120b-antes-a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-base-vigente: ANTES da 20261399400000 (os corpos vigentes de reply_review_atomic, os da 20261360000000: md5 0e58549366e4b4be17ae070a8fc622dc e 64b337eb3ec5dd1431e0dbf9d12a49ac).
-- Mesmo rol de 8 linhas da 120a: a 120b e positiva ANTES do apply e negativa so nas duas linhas de corpo DEPOIS; reaplicar a 120a a seguir.
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
  SELECT 'reply_review_atomic(uuid,text): corpo exato (md5)', '0e58549366e4b4be17ae070a8fc622dc',
    COALESCE((SELECT h FROM fn WHERE k = 'dois'), 'AUSENTE')
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text): assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE k = 'dois'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text): EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE k = 'dois'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text,uuid): corpo exato (md5)', '64b337eb3ec5dd1431e0dbf9d12a49ac',
    COALESCE((SELECT h FROM fn WHERE k = 'tres'), 'AUSENTE')
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text,uuid): assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn WHERE k = 'tres'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'reply_review_atomic(uuid,text,uuid): EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn WHERE k = 'tres'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;

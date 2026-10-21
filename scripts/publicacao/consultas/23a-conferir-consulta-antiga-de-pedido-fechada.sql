-- 23a — DEPOIS de aplicar a migration 20261220000000 (a consulta antiga de pedido por codigo,
-- `get_orders_by_otp_v1`, fecha para o visitante e para a conta logada): confirma, POR OBJETO, que a
-- v1 esta FECHADA (PUBLIC, anon e authenticated sem EXECUTE; service_role com EXECUTE), com o MESMO
-- corpo de antes (o corte so mexe na ACL), e que a v2, a porta do convidado, segue ABERTA para anon e
-- authenticated com o corpo de sempre. E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 23b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, aclexplode): nenhuma linha de
-- pedido ou de codigo e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 5 linhas,
-- as mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some
-- uma linha). Tudo `true` = o corte esta aplicado; qualquer `false` = PARE e leia a linha. Depois do
-- rollback-manual (um GRANT) so a linha de EXECUTE da v1 reprova.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o que a 20261217000000
--                deixou, igual antes e depois do corte.
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e
--                service_role por has_function_privilege (herdam o que o papel herda).
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts, e
-- tests/banco/consulta-antiga-de-pedido-portao-viva.cjs roda esta consulta num Postgres real
-- (positiva depois do apply, negativa depois do rollback, um negativo por linha). LIMITES: nao prova o
-- COMPORTAMENTO (isso e' de tests/banco/consulta-antiga-de-pedido-viva.cjs). Evidencia LOCAL nao prova
-- a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(nome, assinatura) AS (
  VALUES ('get_orders_by_otp_v1', 'public.get_orders_by_otp_v1(text,text)'),
         ('get_orders_by_otp_v2', 'public.get_orders_by_otp_v2(text,text,text,text)')
), fn AS (
  SELECT t.nome,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN p.oid IS NULL THEN NULL
              ELSE 'PUBLIC=' || CASE WHEN EXISTS (
                       SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                       WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                                WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   || ' service_role=' || CASE WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
                                               WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
         END AS acl
    FROM alvo t
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_orders_by_otp_v1: corpo e o da 20261217000000 (md5)',
         '277776acaf395fa864cc3e2cb0638237',
         COALESCE((SELECT f.m FROM fn f WHERE f.nome = 'get_orders_by_otp_v1'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v1: EXECUTE fechado para anon e authenticated',
         'PUBLIC=nao anon=nao authenticated=nao service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'get_orders_by_otp_v1'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v2: corpo e o da 20261217000000 (md5)',
         '53b5e632657b82206daa6aa992a50c0d',
         -- Aceita tambem os corpos das SUCESSORAS 20261341000000 (trava de linha) e 20261342000000 (sem a nota do
         -- retorno): a 23a e' o DEPOIS da 20261220000000 e continua certa depois delas; o `vivo` mostra o `esperado`.
         COALESCE((SELECT CASE WHEN f.m IN ('53b5e632657b82206daa6aa992a50c0d',
                                            '34199947ecded0fd9400b5fd0276ea47',
                                            '02208ac9d2abe2e8b03790349d491ecb')
                               THEN '53b5e632657b82206daa6aa992a50c0d'
                               ELSE f.m END
                     FROM fn f WHERE f.nome = 'get_orders_by_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v2: EXECUTE aberto para anon e authenticated',
         'PUBLIC=nao anon=sim authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'get_orders_by_otp_v2'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

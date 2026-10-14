-- 23b — ANTES de aplicar a migration 20261220000000 (a consulta antiga de pedido por codigo,
-- `get_orders_by_otp_v1`, fecha para o visitante e para a conta logada): confirma que a loja esta na
-- base de antes: a 20261217000000 aplicada (os corpos da v1 e da v2 sao os dela), a v1 ABERTA como
-- sempre (PUBLIC nao; anon, authenticated e service_role sim) e a v2, a porta que o front usa, aberta
-- para anon e authenticated. E' a consulta de AUSENCIA do lote (`ausenciaConfirmadaPor` em
-- scripts/frota/canais-de-backend.json): so com a 23a NEGATIVA e esta POSITIVA (da mesma janela ou
-- mais nova) o portao (scripts/frota/publicar-release.mjs) imprime o apply do arquivo.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, aclexplode): nenhuma linha de
-- pedido ou de codigo e' lida nem devolvida.
--
-- POR OBJETO, nunca por `schema_migrations`: o registro do ledger nao prova o que esta no banco.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 5 linhas,
-- as mesmas em qualquer estado do banco. Tudo `true` = a loja esta na base de antes e a migration
-- pode ser aplicada; qualquer `false` = PARE e leia a linha (aplicada assim, a migration abortaria no
-- pre-voo `B1_BASELINE_DIVERGENT` -- aqui a gente descobre ANTES, por leitura). Uma loja que ja tem o
-- corte reprova aqui de proposito, na linha de EXECUTE da v1. Depois do rollback-manual esta consulta
-- volta a ser POSITIVA. Uma loja SEM a 20261217000000 reprova nas linhas de corpo e na v2: aplique a
-- 20261217000000 antes (lote 21).
--
-- md5 = md5 do corpo sem `\r`; tests/ci_conferir_banco_test.ts recalcula os valores dos ARQUIVOS das
-- migrations desta arvore. Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta
-- contra o ref de cada loja.
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
  SELECT 'get_orders_by_otp_v1: EXECUTE aberto para anon e authenticated',
         'PUBLIC=nao anon=sim authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'get_orders_by_otp_v1'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v2: corpo e o da 20261217000000 (md5)',
         '53b5e632657b82206daa6aa992a50c0d',
         COALESCE((SELECT f.m FROM fn f WHERE f.nome = 'get_orders_by_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v2: EXECUTE aberto para anon e authenticated',
         'PUBLIC=nao anon=sim authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'get_orders_by_otp_v2'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

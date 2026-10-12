-- 21a — DEPOIS de aplicar a migration 20261217000000 (o e-mail da loja tem teto e o codigo do
-- convidado nao se queima): confirma, POR OBJETO, que as tres funcoes trocadas
-- (`generate_order_otp_v2`, `reivindicar_email_de_confirmacao`, `get_orders_by_otp_v1`) e as tres
-- novas (`get_orders_by_otp_v2`, `reservar_vaga_de_email`, `chave_do_destinatario`) estao com o
-- corpo DESTA migration, com o EXECUTE certo, e que a tabela de contadores tem a RLS ligada e nenhum
-- privilegio para anon/authenticated. E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 21b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_class, aclexplode): nenhuma
-- linha de pedido, de codigo ou de contador e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 14 linhas,
-- as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some
-- uma linha). Tudo `true` = a migration esta aplicada; qualquer `false` = PARE e leia a linha. Depois
-- do rollback-manual so as tres linhas de corpo das funcoes TROCADAS reprovam (as novas ficam).
--
--   * corpo   -- o sha256 do corpo vivo e' o desta migration (LF ou CRLF).
--   * EXECUTE -- as tres de servidor e as duas de apoio: so service_role
--                (`PUBLIC=nao anon=nao authenticated=nao service_role=sim`); as duas portas do
--                rastreio do convidado (v1 e v2): `PUBLIC=nao anon=sim authenticated=sim`.
--                PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                has_function_privilege nao tem o pseudo-papel PUBLIC.
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'); tests/ci_conferir_banco_test.ts os
-- recalcula dos ARQUIVOS da migration desta arvore, e tests/banco/teto-de-email-portao-viva.cjs roda
-- esta consulta num Postgres real (positiva depois do apply, negativa depois do rollback, um
-- negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/teto-de-email-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
WITH alvo(nome, assinatura) AS (
  VALUES ('generate_order_otp_v2', 'public.generate_order_otp_v2(text,text,text)'),
         ('reivindicar_email_de_confirmacao', 'public.reivindicar_email_de_confirmacao(uuid)'),
         ('get_orders_by_otp_v1', 'public.get_orders_by_otp_v1(text,text)'),
         ('get_orders_by_otp_v2', 'public.get_orders_by_otp_v2(text,text,text,text)'),
         ('reservar_vaga_de_email', 'public.reservar_vaga_de_email(text,integer)'),
         ('chave_do_destinatario', 'public.chave_do_destinatario(text)')
), fn AS (
  SELECT t.nome,
         encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h,
         CASE WHEN p.oid IS NULL THEN NULL
              ELSE 'PUBLIC=' || CASE WHEN EXISTS (
                       SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                       WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                                WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
         END AS acl,
         CASE WHEN p.oid IS NULL OR to_regrole('service_role') IS NULL THEN NULL
              WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS servico
    FROM alvo t
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
), tab AS (
  SELECT c.oid, c.relrowsecurity AS rls
    FROM pg_class c
   WHERE c.oid = to_regclass('public.email_da_loja_contadores')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'generate_order_otp_v2: corpo e o da 20261217000000 (sha256)',
         '4050356f6b186f7bb50aa4b4b090113072d0976933c90d8fd5d67a3a86535e52',
         COALESCE((SELECT CASE WHEN f.h IN ('4050356f6b186f7bb50aa4b4b090113072d0976933c90d8fd5d67a3a86535e52',
                                            'ebd86579c5c7e6533956acfc0a31d2129687348dcbccda5d3e0648f89e929b3a')
                               THEN '4050356f6b186f7bb50aa4b4b090113072d0976933c90d8fd5d67a3a86535e52'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'generate_order_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'generate_order_otp_v2: EXECUTE', 'PUBLIC=nao anon=nao authenticated=nao service_role=sim',
         COALESCE((SELECT f.acl || ' service_role=' || COALESCE(f.servico, 'papel ausente')
                     FROM fn f WHERE f.nome = 'generate_order_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'reivindicar_email_de_confirmacao: corpo e o da 20261217000000 (sha256)',
         'bc31a13e49d13a9f90a279d55cdb50b65d8377b127f62fbb58c1b26d6c276b8d',
         COALESCE((SELECT CASE WHEN f.h IN ('bc31a13e49d13a9f90a279d55cdb50b65d8377b127f62fbb58c1b26d6c276b8d',
                                            'f5b76a61814f6b8774698a42b5655179749acb7be03a172ee0cbaab61eebc1fb')
                               THEN 'bc31a13e49d13a9f90a279d55cdb50b65d8377b127f62fbb58c1b26d6c276b8d'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'reivindicar_email_de_confirmacao'), 'AUSENTE')
  UNION ALL
  SELECT 'reivindicar_email_de_confirmacao: EXECUTE', 'PUBLIC=nao anon=nao authenticated=nao service_role=sim',
         COALESCE((SELECT f.acl || ' service_role=' || COALESCE(f.servico, 'papel ausente')
                     FROM fn f WHERE f.nome = 'reivindicar_email_de_confirmacao'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v1: corpo e o da 20261217000000 (sha256)',
         '37a4dcf371a89343b7cd5daf2809a548653c9237ba11d1d2823f19f1473f7299',
         COALESCE((SELECT CASE WHEN f.h IN ('37a4dcf371a89343b7cd5daf2809a548653c9237ba11d1d2823f19f1473f7299',
                                            '631ac2e657483663f6e248f9695fe35be9e38a65148077c62ecc983bd42233df')
                               THEN '37a4dcf371a89343b7cd5daf2809a548653c9237ba11d1d2823f19f1473f7299'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'get_orders_by_otp_v1'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v1: EXECUTE', 'PUBLIC=nao anon=sim authenticated=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'get_orders_by_otp_v1'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v2: corpo e o da 20261217000000 (sha256)',
         '36af86dd3249fb2da812afaff1a5edc4d0e8e1e09017f3be0ca4eac9f0c07862',
         COALESCE((SELECT CASE WHEN f.h IN ('36af86dd3249fb2da812afaff1a5edc4d0e8e1e09017f3be0ca4eac9f0c07862',
                                            'e7b964ac748f0304d9fa66d14a40211df9549809f4577e04de6bb02623e77034')
                               THEN '36af86dd3249fb2da812afaff1a5edc4d0e8e1e09017f3be0ca4eac9f0c07862'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'get_orders_by_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v2: EXECUTE', 'PUBLIC=nao anon=sim authenticated=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'get_orders_by_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'reservar_vaga_de_email: corpo e o da 20261217000000 (sha256)',
         '39f42ed884dce3c81dc3f315e7037a001d5bf335e41e921d94505af22ee559a1',
         COALESCE((SELECT CASE WHEN f.h IN ('39f42ed884dce3c81dc3f315e7037a001d5bf335e41e921d94505af22ee559a1',
                                            'a9298d879200e6ce8136e4e7d6658dfb92dd7e0eefa4f4bad4f0713a12c1fdcf')
                               THEN '39f42ed884dce3c81dc3f315e7037a001d5bf335e41e921d94505af22ee559a1'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'reservar_vaga_de_email'), 'AUSENTE')
  UNION ALL
  SELECT 'reservar_vaga_de_email: EXECUTE', 'PUBLIC=nao anon=nao authenticated=nao service_role=sim',
         COALESCE((SELECT f.acl || ' service_role=' || COALESCE(f.servico, 'papel ausente')
                     FROM fn f WHERE f.nome = 'reservar_vaga_de_email'), 'AUSENTE')
  UNION ALL
  SELECT 'chave_do_destinatario: corpo e o da 20261217000000 (sha256)',
         '331379715af89f3565d790da7c0e8deff6c81f9290d3663d4911b6055ca7369c',
         COALESCE((SELECT CASE WHEN f.h IN ('331379715af89f3565d790da7c0e8deff6c81f9290d3663d4911b6055ca7369c',
                                            'c2aac39e3f95043bb6b197eda4b371eaee9d50ea227b8084bd9a2deafa0edaec')
                               THEN '331379715af89f3565d790da7c0e8deff6c81f9290d3663d4911b6055ca7369c'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'chave_do_destinatario'), 'AUSENTE')
  UNION ALL
  SELECT 'chave_do_destinatario: EXECUTE', 'PUBLIC=nao anon=nao authenticated=nao service_role=sim',
         COALESCE((SELECT f.acl || ' service_role=' || COALESCE(f.servico, 'papel ausente')
                     FROM fn f WHERE f.nome = 'chave_do_destinatario'), 'AUSENTE')
  UNION ALL
  SELECT 'email_da_loja_contadores: RLS ligada e nada para anon/authenticated', 'sim',
         COALESCE((SELECT CASE WHEN t.rls
                                    AND to_regrole('anon') IS NOT NULL AND to_regrole('authenticated') IS NOT NULL
                                    AND NOT has_table_privilege('anon', t.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                                    AND NOT has_table_privilege('authenticated', t.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                               THEN 'sim' ELSE 'nao' END
                     FROM tab t), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

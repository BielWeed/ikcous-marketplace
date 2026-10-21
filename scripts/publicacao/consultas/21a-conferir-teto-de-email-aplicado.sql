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
--                rastreio do convidado (v1 e v2): `PUBLIC=nao anon=sim authenticated=sim`. A v1 tambem
--                vale FECHADA (`PUBLIC=nao anon=nao authenticated=nao`): e' o estado que a
--                20261220000000 (lote 23) deixa, e esta consulta continua certa depois dele; a coluna
--                `esperado` dessa linha mostra qual dos dois estados validos o `vivo` ocupa.
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
         '30d5e84347fb2f3654b016433eab5bd19a7a4ea78ac6d431927e6eecc48478f9',
         COALESCE((SELECT CASE WHEN f.h IN ('30d5e84347fb2f3654b016433eab5bd19a7a4ea78ac6d431927e6eecc48478f9',
                                            'e924bbb0fdd5c3e314a516c0ef769088e14490bde66ac823e6138cb081bbd73b')
                               THEN '30d5e84347fb2f3654b016433eab5bd19a7a4ea78ac6d431927e6eecc48478f9'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'generate_order_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'generate_order_otp_v2: EXECUTE', 'PUBLIC=nao anon=nao authenticated=nao service_role=sim',
         COALESCE((SELECT f.acl || ' service_role=' || COALESCE(f.servico, 'papel ausente')
                     FROM fn f WHERE f.nome = 'generate_order_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'reivindicar_email_de_confirmacao: corpo e o da 20261217000000 (sha256)',
         '67ccd76f26f9731c63ba04e4ad8f383e7d731c4a2081ef157611ba631be0a29e',
         COALESCE((SELECT CASE WHEN f.h IN ('67ccd76f26f9731c63ba04e4ad8f383e7d731c4a2081ef157611ba631be0a29e',
                                            '746d0e5ddd4bb66b0bc5028abc0ee7a1bd32f7eb7370b5ed8e62f31ed04dfc85')
                               THEN '67ccd76f26f9731c63ba04e4ad8f383e7d731c4a2081ef157611ba631be0a29e'
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
  -- Os DOIS estados validos da v1: aberta (so este lote) ou FECHADA (depois da 20261220000000, o
  -- lote 23). `esperado` mostra o estado valido que o `vivo` ocupa; qualquer outra combinacao
  -- (PUBLIC aberto, so um dos dois papeis, funcao ausente) fica com o esperado de "aberta" e reprova.
  SELECT 'get_orders_by_otp_v1: EXECUTE',
         CASE WHEN (SELECT f.acl FROM fn f WHERE f.nome = 'get_orders_by_otp_v1')
                   = 'PUBLIC=nao anon=nao authenticated=nao'
              THEN 'PUBLIC=nao anon=nao authenticated=nao'
              ELSE 'PUBLIC=nao anon=sim authenticated=sim' END,
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'get_orders_by_otp_v1'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v2: corpo e o da 20261217000000 (sha256)',
         '36af86dd3249fb2da812afaff1a5edc4d0e8e1e09017f3be0ca4eac9f0c07862',
         -- Aceita tambem os corpos das SUCESSORAS que so acrescentam a trava de linha e tiram a nota do retorno
         -- (20261341000000 e 20261342000000, LF e CRLF): o `vivo` mostra o `esperado` da 20261217000000.
         COALESCE((SELECT CASE WHEN f.h IN ('36af86dd3249fb2da812afaff1a5edc4d0e8e1e09017f3be0ca4eac9f0c07862',
                                            'e7b964ac748f0304d9fa66d14a40211df9549809f4577e04de6bb02623e77034',
                                            '7d9975446c2d09e51a07bf4d9ba7819b3dbdef85b80506ea5fd980badc27757c',
                                            'c1e5374e9ab92fa8cc23491bd3e132d018e85ae0b6be64438dc9c63945e41121',
                                            'a830cf0730526d73ef1c09b0036c9694e58d20edab17cb21ffb59b4b632b2212',
                                            '196021b99e1f020356e31a72d9832e81ea074065613305833e06bb082dd594e6')
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

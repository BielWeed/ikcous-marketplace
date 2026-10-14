-- 21b — ANTES de aplicar a migration 20261217000000 (o e-mail da loja tem teto e o codigo do
-- convidado nao se queima): confirma que as tres funcoes que a migration troca estao com o corpo
-- VIGENTE de antes (`generate_order_otp_v2` da 20260820000000, `reivindicar_email_de_confirmacao` da
-- 20260821000000, `get_orders_by_otp_v1` da 20261181000000), com o EXECUTE de sempre, e que as
-- colunas que os corpos novos leem EXISTEM. E' a consulta de AUSENCIA do lote
-- (`ausenciaConfirmadaPor` em scripts/frota/canais-de-backend.json): so com a 21a NEGATIVA e esta
-- POSITIVA (da mesma janela ou mais nova) o portao (scripts/frota/publicar-release.mjs) imprime o
-- apply do arquivo.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_attribute, aclexplode):
-- nenhuma linha de pedido, de codigo ou de cliente e' lida nem devolvida.
--
-- POR OBJETO, nunca por `schema_migrations`: o registro do ledger nao prova o que esta no banco.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 8 linhas,
-- as mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true`
-- = a loja esta na base de antes e a migration pode ser aplicada; qualquer `false` = PARE e leia a
-- linha (aplicada assim, a migration abortaria no pre-voo `B1_BASELINE_DIVERGENT` -- aqui a gente
-- descobre ANTES, por leitura). Uma loja que ja tem a migration reprova aqui de proposito, nas tres
-- linhas de corpo. Depois do rollback-manual esta consulta volta a ser POSITIVA (a tabela e as
-- funcoes novas que ficam nao entram aqui) -- SE a v1 estiver aberta: uma loja que ja recebeu a
-- 20261220000000 (lote 23, a v1 fecha para o visitante) reprova tambem na linha `get_orders_by_otp_v1:
-- EXECUTE`, de proposito (antes do lote 21 a v1 e' aberta). Por isso o rollback da 20261220 vem SEMPRE
-- antes de qualquer rollback ou reaplicacao da 20261217.
--
--   * corpo   -- o sha256 do corpo vivo e' o do ANTES (LF ou CRLF).
--   * EXECUTE -- `generate_order_otp_v2` e `reivindicar_email_de_confirmacao`: so service_role (a
--                20260820000000 e a 20260821000000 fixam); `get_orders_by_otp_v1`: anon e
--                authenticated, sem PUBLIC (a 20261090500000 e a 20261181000000). CREATE OR REPLACE
--                PRESERVA a ACL: uma loja fora disto continua fora depois do apply.
--   * colunas -- plpgsql so resolve coluna ao EXECUTAR: uma coluna renomeada nao barra o apply,
--                quebra o codigo e o comprovante depois.
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'); tests/ci_conferir_banco_test.ts os
-- recalcula dos ARQUIVOS das migrations e do rollback-manual desta arvore. Evidencia LOCAL nao prova a
-- IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(nome, assinatura) AS (
  VALUES ('generate_order_otp_v2', 'public.generate_order_otp_v2(text,text,text)'),
         ('reivindicar_email_de_confirmacao', 'public.reivindicar_email_de_confirmacao(uuid)'),
         ('get_orders_by_otp_v1', 'public.get_orders_by_otp_v1(text,text)')
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
), faltam AS (
  SELECT v.item AS coluna
    FROM unnest(ARRAY[
           'auth.users.email', 'auth.users.id',
           'public.marketplace_orders.confirmation_email_sent_at', 'public.marketplace_orders.customer_data',
           'public.marketplace_orders.customer_phone', 'public.marketplace_orders.id',
           'public.marketplace_orders.payment_status', 'public.marketplace_orders.user_id',
           'public.otp_verifications.attempts', 'public.otp_verifications.created_at',
           'public.otp_verifications.expires_at', 'public.otp_verifications.order_id',
           'public.otp_verifications.otp_code', 'public.otp_verifications.verified'
         ]) AS v(item)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = to_regclass(split_part(v.item, '.', 1) || '.' || split_part(v.item, '.', 2))
              AND a.attname = split_part(v.item, '.', 3)
              AND a.attnum > 0 AND NOT a.attisdropped)
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'pedidos, codigos e contas: colunas que os corpos novos leem', 'EXISTEM',
         COALESCE((SELECT 'AUSENTES: ' || string_agg(f.coluna, ', ' ORDER BY f.coluna) FROM faltam f),
                  'EXISTEM')
  UNION ALL
  SELECT 'generate_order_otp_v2: corpo e o da 20260820000000 (sha256)',
         '12371ac3247fa35197baacd4deaca2b4852c420aa1bd41a42fe30e54589c3c47',
         COALESCE((SELECT CASE WHEN f.h IN ('12371ac3247fa35197baacd4deaca2b4852c420aa1bd41a42fe30e54589c3c47',
                                            '3a1a70b1f2cfd73ff3447caf907de5c898b36a0e4ab12707e72ecff416698431')
                               THEN '12371ac3247fa35197baacd4deaca2b4852c420aa1bd41a42fe30e54589c3c47'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'generate_order_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'generate_order_otp_v2: EXECUTE', 'PUBLIC=nao anon=nao authenticated=nao service_role=sim',
         COALESCE((SELECT f.acl || ' service_role=' || COALESCE(f.servico, 'papel ausente')
                     FROM fn f WHERE f.nome = 'generate_order_otp_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'reivindicar_email_de_confirmacao: corpo e o da 20260821000000 (sha256)',
         '98345fb9256c1acef4705c8b30082dd5716f9ab88c41c5d8e7c7105181eb67a5',
         COALESCE((SELECT CASE WHEN f.h IN ('98345fb9256c1acef4705c8b30082dd5716f9ab88c41c5d8e7c7105181eb67a5',
                                            '2f9f4851b384f82194dbe4627ac0485550c1155db425d814a1e591d7be19c327')
                               THEN '98345fb9256c1acef4705c8b30082dd5716f9ab88c41c5d8e7c7105181eb67a5'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'reivindicar_email_de_confirmacao'), 'AUSENTE')
  UNION ALL
  SELECT 'reivindicar_email_de_confirmacao: EXECUTE', 'PUBLIC=nao anon=nao authenticated=nao service_role=sim',
         COALESCE((SELECT f.acl || ' service_role=' || COALESCE(f.servico, 'papel ausente')
                     FROM fn f WHERE f.nome = 'reivindicar_email_de_confirmacao'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v1: corpo e o da 20261181000000 (sha256)',
         'c496234c5f4fa049b8e59036496f7282fa546423d693b1e84395bfe144bf904d',
         COALESCE((SELECT CASE WHEN f.h IN ('c496234c5f4fa049b8e59036496f7282fa546423d693b1e84395bfe144bf904d',
                                            '9c71ca4ffb128e8e9833e10af9e26992270ac3078f3aee2ff1114a4a95a56eea')
                               THEN 'c496234c5f4fa049b8e59036496f7282fa546423d693b1e84395bfe144bf904d'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'get_orders_by_otp_v1'), 'AUSENTE')
  UNION ALL
  SELECT 'get_orders_by_otp_v1: EXECUTE', 'PUBLIC=nao anon=sim authenticated=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'get_orders_by_otp_v1'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;

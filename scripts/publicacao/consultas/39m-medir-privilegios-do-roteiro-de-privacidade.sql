-- 39m — MEDICAO, so leitura, SO DE CATALOGO, de o que o papel `postgres` PODE fazer nas tabelas de LOGIN (schema auth) que o
-- roteiro manual de privacidade toca (docs/runbooks/atender-pedido-de-privacidade.md, o bloco de SQL das linhas ~264-323:
-- a anonimizacao de uma conta atualiza auth.users, auth.identities e auth.audit_log_entries e apaga de auth.identities,
-- auth.sessions, auth.one_time_tokens e auth.mfa_factors). Molde da 34m/32m/27m: UM SELECT de ROL ABERTO, sem coluna `ok`;
-- nunca e' prova do portao da release. Quem decide e' a pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e
-- Savy) ANTES de o dono rodar o roteiro pela primeira vez (e nao precisa ser antes do apply: a migration 20261238000000 nao
-- toca o schema auth), so para saber se o `postgres` da loja alcanca o que o roteiro pede -- a Supabase tem schema auth
-- administrado e o `postgres` NAO e' superusuario la.
-- ESTA CONSULTA NAO ESCREVE NADA e nao roda o roteiro: o roteiro APAGA dado real de login e fica com o DONO, caso a caso (pedido
-- por pedido, depois do ensaio `v_confirmar := false`); nada aqui o dispensa nem o antecipa.
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?) e se o papel `postgres` existe e tem USAGE no schema auth.
--   privilegio uma linha por tabela do roteiro, `UPDATE=sim|nao` e `DELETE=sim|nao` do papel `postgres` (a tabela
--              ausente diz `tabela ausente`) e `roteiro=` o que o roteiro faz nela (UPDATE, DELETE ou os dois). Um `nao`
--              no que o roteiro usa quer dizer que o passo correspondente do roteiro FALHA nessa loja (e a transacao dele
--              desfaz tudo) -- nao e' defeito da migration.
-- has_table_privilege mede o papel NOMEADO (`postgres`), nao o de quem pergunta; num Postgres em que `postgres` e'
-- superusuario tudo sai `sim`.
-- NENHUM DADO PESSOAL: so catalogo, nenhuma linha de nenhuma tabela e' lida; nem a contagem delas.
-- tests/ci_conferir_banco_privacidade_test.ts prende essas regras no texto desta consulta.
WITH papel AS (
  SELECT to_regrole('postgres') AS p
), tabelas(nome, roteiro) AS (
  VALUES ('auth.users', 'UPDATE'),
         ('auth.identities', 'UPDATE e DELETE'),
         ('auth.audit_log_entries', 'UPDATE'),
         ('auth.sessions', 'DELETE'),
         ('auth.one_time_tokens', 'DELETE'),
         ('auth.mfa_factors', 'DELETE')
)
SELECT 'controle' AS tipo, 'quem leu' AS objeto,
       'superusuario=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
       || '|bypassrls=' || (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text
       || '|papel_postgres_existe=' || ((SELECT p FROM papel) IS NOT NULL)::text
       || '|usage_no_schema_auth=' || COALESCE(
            (CASE WHEN (SELECT p FROM papel) IS NULL THEN NULL
                  ELSE has_schema_privilege('postgres'::name, 'auth', 'USAGE') END)::text, 'papel ausente') AS detalhe
UNION ALL
SELECT 'privilegio', t.nome,
       'UPDATE=' || CASE WHEN (SELECT p FROM papel) IS NULL THEN 'papel ausente'
                         WHEN to_regclass(t.nome) IS NULL THEN 'tabela ausente'
                         WHEN has_table_privilege('postgres'::name, to_regclass(t.nome), 'UPDATE') THEN 'sim' ELSE 'nao' END
       || '|DELETE=' || CASE WHEN (SELECT p FROM papel) IS NULL THEN 'papel ausente'
                             WHEN to_regclass(t.nome) IS NULL THEN 'tabela ausente'
                             WHEN has_table_privilege('postgres'::name, to_regclass(t.nome), 'DELETE') THEN 'sim' ELSE 'nao' END
       || '|roteiro=' || t.roteiro
  FROM tabelas t;

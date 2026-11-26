-- 185-privilegios-padrao-em-public: SO LEITURA, somente catalogo (pg_default_acl, pg_roles, pg_class), rol fechado de 8 linhas. Nao le
-- nenhuma linha de tabela. Mede a regra de FABRICA que as migrations pressupoem (a baseline nao tem GRANT): o que um objeto NOVO do schema
-- public criado pelo papel postgres recebe pelo ALTER DEFAULT PRIVILEGES. Desde 30/05/2026 projeto Supabase novo nasce SEM ela (changelog
-- oficial). O banco do CI (provisionar-efemero.cjs) e o instalador da loja nova (instalador-banco.mjs) aplicam o MESMO conjunto
-- (scripts/ci/banco/privilegios-padrao.cjs: ALL em tabela e sequencia, EXECUTE em funcao, para anon, authenticated e service_role).
-- Linhas 2 a 7: tabelas dao SELECT/INSERT/UPDATE/DELETE e sequencias dao USAGE/SELECT a cada papel? "nao" = tabela nova de migration nasce
-- sem acesso nesta loja (42501 na vitrine ou no painel) se a migration nao tiver GRANT proprio. Linha 8 e SO REGISTRO: quem recebe EXECUTE
-- em funcao nova (esperado = o que o provisionador define, PUBLIC pelo padrao embutido do Postgres mais os tres papeis); "nao" ali descreve
-- a loja, nao reprova nada sozinho. Efetivo = a entrada global do postgres (defaclnamespace 0) ou, sem ela, o padrao embutido, SOMADA a
-- entrada do schema public.
WITH dono AS (
  SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'postgres'
), efetivo AS (
  SELECT t.tipo, g.grantee, g.privilege_type
  FROM (VALUES ('r', 'r'), ('S', 's'), ('f', 'f')) AS t(tipo, tipo_acl)
  CROSS JOIN dono u
  CROSS JOIN LATERAL aclexplode(COALESCE(
    (SELECT d.defaclacl FROM pg_catalog.pg_default_acl d
      WHERE d.defaclrole = u.oid AND d.defaclnamespace = 0 AND d.defaclobjtype = t.tipo::"char"),
    acldefault(t.tipo_acl::"char", u.oid))) g
  UNION
  SELECT d.defaclobjtype::text, g.grantee, g.privilege_type
  FROM pg_catalog.pg_default_acl d
  CROSS JOIN dono u
  CROSS JOIN LATERAL aclexplode(d.defaclacl) g
  WHERE d.defaclrole = u.oid AND d.defaclnamespace = to_regnamespace('public')::oid
), recebe AS (
  SELECT e.tipo, e.grantee, array_agg(e.privilege_type) AS privs FROM efetivo e GROUP BY e.tipo, e.grantee
), executa AS (
  SELECT DISTINCT CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE e.grantee::regrole::text END AS quem
  FROM efetivo e WHERE e.tipo = 'f' AND e.privilege_type = 'EXECUTE'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'tabelas novas de public criadas pelo postgres: anon recebe SELECT, INSERT, UPDATE e DELETE', 'sim', CASE WHEN COALESCE((SELECT
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] <@ x.privs FROM recebe x WHERE x.tipo = 'r' AND x.grantee = to_regrole('anon')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'tabelas novas de public criadas pelo postgres: authenticated recebe SELECT, INSERT, UPDATE e DELETE', 'sim', CASE WHEN COALESCE((SELECT
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] <@ x.privs FROM recebe x WHERE x.tipo = 'r' AND x.grantee = to_regrole('authenticated')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'tabelas novas de public criadas pelo postgres: service_role recebe SELECT, INSERT, UPDATE e DELETE', 'sim', CASE WHEN COALESCE((SELECT
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] <@ x.privs FROM recebe x WHERE x.tipo = 'r' AND x.grantee = to_regrole('service_role')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'sequencias novas de public criadas pelo postgres: anon recebe USAGE e SELECT', 'sim', CASE WHEN COALESCE((SELECT
    ARRAY['USAGE', 'SELECT'] <@ x.privs FROM recebe x WHERE x.tipo = 'S' AND x.grantee = to_regrole('anon')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'sequencias novas de public criadas pelo postgres: authenticated recebe USAGE e SELECT', 'sim', CASE WHEN COALESCE((SELECT
    ARRAY['USAGE', 'SELECT'] <@ x.privs FROM recebe x WHERE x.tipo = 'S' AND x.grantee = to_regrole('authenticated')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'sequencias novas de public criadas pelo postgres: service_role recebe USAGE e SELECT', 'sim', CASE WHEN COALESCE((SELECT
    ARRAY['USAGE', 'SELECT'] <@ x.privs FROM recebe x WHERE x.tipo = 'S' AND x.grantee = to_regrole('service_role')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'funcoes novas de public criadas pelo postgres: quem recebe EXECUTE (so registro, esperado = o que o provisionador do CI define)',
    'PUBLIC,anon,authenticated,postgres,service_role',
    COALESCE((SELECT string_agg(q.quem, ',' ORDER BY q.quem COLLATE "C") FROM executa q), '(ninguem)')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;

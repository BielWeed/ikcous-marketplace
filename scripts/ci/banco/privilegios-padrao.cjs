/**
 * Os DEFAULT PRIVILEGES de fábrica do schema public — a fonte ÚNICA (26/11/2026).
 *
 * O QUE É: o Supabase provisionava todo projeto com `ALTER DEFAULT PRIVILEGES`
 * dando ALL em tabelas/sequências e EXECUTE em funções NOVAS de public a anon,
 * authenticated e service_role (a proteção vem da RLS, não do grant). As
 * migrations deste repositório foram escritas contando com isso: a baseline
 * (20260806000000) saiu com --no-privileges, 0 GRANT, e guardas como a da 114
 * reprovam um banco em que as funções nascem sem EXECUTE.
 *
 * POR QUE VIROU MÓDULO: desde 30/05/2026 projeto Supabase NOVO nasce SEM essa
 * regra (changelog oficial; "Automatically expose new tables and functions"
 * desmarcado). As lojas antigas ainda a têm. Para a loja nova ficar IGUAL às
 * antigas, o instalador do banco (scripts/frota/instalador-banco.mjs) aplica
 * este MESMO conjunto antes da 1ª migration — o mesmo que o banco efêmero do
 * CI (provisionar-efemero.cjs) sempre aplicou. Um conjunto, dois usuários: se
 * um mudar sem o outro, o CI prova um banco que nenhuma loja nova tem.
 *
 * SEM `FOR ROLE`: vale para o papel que RODA o comando — o mesmo que depois
 * cria as tabelas e funções das migrations (no CI, o superusuário do service;
 * na loja, o papel da Management API). É de propósito: o default privilege só
 * alcança objeto criado pelo papel para o qual foi gravado.
 *
 * Mudar este conjunto muda o banco de TODA loja nova e o do CI ao mesmo tempo
 * (tests/ci_banco_privilegios_padrao_test.ts congela os 9 comandos).
 */

"use strict";

const PAPEIS_DE_FABRICA = Object.freeze([
  "anon",
  "authenticated",
  "service_role",
]);

/** Os 9 comandos, na ordem em que o provisionador sempre os rodou: por papel,
 * tabelas, sequências, funções. Idempotentes (conceder de novo não muda nada).
 * Lista nova a cada chamada. */
function comandosDosPrivilegiosPadrao() {
  const comandos = [];
  for (const papel of PAPEIS_DE_FABRICA) {
    // Nomes vêm de lista fixa deste arquivo — nunca entrada externa.
    comandos.push(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${papel}"`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${papel}"`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO "${papel}"`,
    );
  }
  return comandos;
}

/**
 * Conferência SÓ LEITURA, numa linha: `papel_dono` (o current_user) e
 * `faltando` ('' quando tudo bate; senão "tipo:papel, …"). "Bate" = cada um dos
 * 3 papéis recebe, em objeto NOVO de public criado pelo current_user, TODOS os
 * privilégios que o dono teria naquele tipo (o conjunto de acldefault: em
 * tabela no PG17 arwdDxtm, em sequência rwU, em função X) — exatamente o que
 * os comandos acima concedem. Considera a entrada do schema public e a global
 * (defaclnamespace = 0), que somam. Papel inexistente ou public ausente = falta.
 */
const SQL_CONFERIR_PRIVILEGIOS_PADRAO = `SELECT current_user::text AS papel_dono,
       coalesce(string_agg(a.nome || ':' || a.papel, ', ' ORDER BY a.nome, a.papel) FILTER (WHERE NOT a.completo), '') AS faltando
  FROM (
    SELECT t.nome, p.papel,
           (SELECT coalesce(array_agg(x.privilege_type), '{}'::text[])
              FROM aclexplode(acldefault(t.tipo_acl::"char", u.oid)) x
             WHERE x.grantee = u.oid)
           <@
           (SELECT coalesce(array_agg(g.privilege_type), '{}'::text[])
              FROM pg_catalog.pg_default_acl d
              CROSS JOIN LATERAL aclexplode(d.defaclacl) g
             WHERE d.defaclrole = u.oid
               AND d.defaclobjtype = t.tipo::"char"
               AND d.defaclnamespace IN (0::oid, to_regnamespace('public')::oid)
               AND g.grantee = to_regrole(p.papel)) AS completo
      FROM (VALUES ('tabelas', 'r', 'r'), ('sequencias', 'S', 's'), ('funcoes', 'f', 'f')) AS t(nome, tipo, tipo_acl)
     CROSS JOIN (VALUES ${PAPEIS_DE_FABRICA.map((p) => `('${p}')`).join(", ")}) AS p(papel)
     CROSS JOIN (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS u
  ) a;`;

module.exports = {
  PAPEIS_DE_FABRICA,
  comandosDosPrivilegiosPadrao,
  SQL_CONFERIR_PRIVILEGIOS_PADRAO,
};

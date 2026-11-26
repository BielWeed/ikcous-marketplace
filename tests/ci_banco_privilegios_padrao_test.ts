// @ts-nocheck
// OS DEFAULT PRIVILEGES DE FÁBRICA do schema public — fonte ÚNICA em
// scripts/ci/banco/privilegios-padrao.cjs (26/11/2026).
//
// Por que existe: desde 30/05/2026 o projeto Supabase NOVO nasce sem o
// `ALTER DEFAULT PRIVILEGES` que dava acesso a anon/authenticated/service_role
// em toda tabela, sequência e função nova de public. As ~280 migrations foram
// escritas contando com essa regra (a baseline saiu com --no-privileges, 0
// GRANT). O banco efêmero do CI cria a regra antiga por conta própria
// (provisionar-efemero.cjs) e o instalador da loja nova
// (scripts/frota/instalador-banco.mjs) passa a aplicar EXATAMENTE o mesmo
// conjunto antes da 1ª migration — por isso um módulo só, usado pelos dois.
//
// O que se prova aqui, sem banco: o conjunto é o MESMO que o provisionador
// aplicava antes da extração (os 9 comandos, na ordem, byte a byte), o
// provisionador não tem mais cópia própria, e a consulta de conferência só lê
// catálogo. A sequência inteira do provisionador (antes == depois) está em
// tests/ci_banco_mains_test.ts; a prova viva no Postgres 17 é
// tests/banco/instalador-nova-loja-viva.cjs (db-ci.yml).
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  PAPEIS_DE_FABRICA,
  comandosDosPrivilegiosPadrao,
  SQL_CONFERIR_PRIVILEGIOS_PADRAO,
} = require("../scripts/ci/banco/privilegios-padrao.cjs");
const {
  contarStatements,
} = require("../scripts/publicacao/conferir-banco.cjs");

const PROVISIONADOR = new URL(
  "../scripts/ci/banco/provisionar-efemero.cjs",
  import.meta.url,
);

// Os 9 comandos que provisionar-efemero.cjs rodava ANTES da extração (laço por
// papel: tabelas, sequências, funções), copiados do arquivo como estava no
// commit f766778db. Mudar este conjunto muda o banco de TODA loja nova e o do
// CI ao mesmo tempo: não é edição casual.
const ANTES_DA_EXTRACAO = [
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "anon"',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "anon"',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO "anon"',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "authenticated"',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "authenticated"',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO "authenticated"',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "service_role"',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "service_role"',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO "service_role"',
];

Deno.test("privilégios padrão: os 9 comandos são EXATAMENTE os que o provisionador aplicava antes da extração, na mesma ordem", () => {
  assertEquals(PAPEIS_DE_FABRICA, ["anon", "authenticated", "service_role"]);
  assertEquals(comandosDosPrivilegiosPadrao(), ANTES_DA_EXTRACAO);
});

Deno.test("privilégios padrão: cada chamada devolve uma lista NOVA (quem chama não estraga a fonte)", () => {
  const a = comandosDosPrivilegiosPadrao();
  a.push("DROP SCHEMA public CASCADE");
  a[0] = "x";
  assertEquals(comandosDosPrivilegiosPadrao(), ANTES_DA_EXTRACAO);
  assert(Object.isFrozen(PAPEIS_DE_FABRICA), "a lista de papéis é congelada");
});

// Os DOIS provisionadores de CI (db-ci: provisionar-efemero.cjs; rpc-ci:
// tests/banco/provisionar.cjs) e o instalador da loja nova usam o módulo.
for (const [url, require_] of [
  [PROVISIONADOR, 'require("./privilegios-padrao.cjs")'],
  [
    new URL("../tests/banco/provisionar.cjs", import.meta.url),
    'require("../../scripts/ci/banco/privilegios-padrao.cjs")',
  ],
]) {
  const nome = url.pathname.split("/").slice(-2).join("/");
  Deno.test(`privilégios padrão: ${nome} usa o módulo e não tem mais cópia própria do ALTER DEFAULT PRIVILEGES`, () => {
    const texto = Deno.readTextFileSync(url);
    assertStringIncludes(texto, require_);
    assertStringIncludes(texto, "comandosDosPrivilegiosPadrao()");
    // Nenhum comando montado no próprio arquivo (comentário pode citar o nome).
    assert(
      !/`ALTER DEFAULT PRIVILEGES/.test(texto) &&
        !/"ALTER DEFAULT PRIVILEGES/.test(texto),
      `${nome} voltou a montar ALTER DEFAULT PRIVILEGES por conta própria`,
    );
    assert(
      !/const PAPEIS_DE_FABRICA\s*=/.test(texto),
      "a lista de papéis tem de vir do módulo, não de uma cópia",
    );
  });
}

Deno.test("privilégios padrão: a conferência é UMA leitura de catálogo, do papel que roda, em public, sem tocar dado", () => {
  const sql = SQL_CONFERIR_PRIVILEGIOS_PADRAO;
  assertEquals(contarStatements(sql), 1);
  assertMatch(sql.trimStart(), /^(SELECT|WITH)\b/);
  assertStringIncludes(sql, "pg_catalog.pg_default_acl");
  assertStringIncludes(sql, "current_user");
  assertStringIncludes(sql, "to_regnamespace('public')");
  assertStringIncludes(sql, "AS papel_dono");
  assertStringIncludes(sql, "AS faltando");
  for (const papel of PAPEIS_DE_FABRICA)
    assertStringIncludes(sql, `'${papel}'`);
  // tabelas ('r'), sequências ('S' no pg_default_acl, 's' no acldefault) e funções ('f')
  for (const t of [
    "('tabelas', 'r', 'r')",
    "('sequencias', 'S', 's')",
    "('funcoes', 'f', 'f')",
  ])
    assertStringIncludes(sql, t);
  assert(
    !/\b(INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|CREATE|DROP|TRUNCATE)\b/i.test(
      sql,
    ),
    "a conferência não pode escrever",
  );
});

Deno.test("privilégios padrão: mudar o módulo dispara o rpc-ci (provisionar.cjs depende dele) em pull_request e em push", () => {
  const yml = Deno.readTextFileSync(
    new URL("../.github/workflows/rpc-ci.yml", import.meta.url),
  );
  assertEquals(
    yml.split('\n      - "scripts/ci/banco/privilegios-padrao.cjs"\n').length -
      1,
    2,
  );
});

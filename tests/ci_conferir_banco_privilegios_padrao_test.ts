// @ts-nocheck
// A CONSULTA 185 (scripts/publicacao/consultas/185-privilegios-padrao-em-public.sql,
// 26/11/2026): SÓ LEITURA, mede nas lojas existentes a regra de fábrica que as
// migrations pressupõem — o que objeto NOVO de public criado pelo postgres
// recebe pelo ALTER DEFAULT PRIVILEGES (projeto Supabase novo não tem desde
// 30/05/2026; o instalador da loja nova a reaplica). Roda pelo workflow
// conferir-banco-da-loja.yml.
//
// Aqui: a forma (um statement, só catálogo, nada escrito, as colunas do rol,
// os itens == ROL_DA_185, o esperado de cada linha) e o registro no menu. A
// SEMÂNTICA é medida num Postgres 17 de verdade por
// tests/banco/instalador-nova-loja-viva.cjs (db-ci.yml): toda ok numa loja
// com a regra; 7 linhas "nao" num banco sem ela; toda ok de novo depois do
// instalador.
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { contarStatements, ROL_DA_185, estruturaDoRolFechado, listarConsultas } =
  require("../scripts/publicacao/conferir-banco.cjs");
const {
  comandosDosPrivilegiosPadrao,
} = require("../scripts/ci/banco/privilegios-padrao.cjs");

const NOME = "185-privilegios-padrao-em-public";
const SQL = Deno.readTextFileSync(
  new URL(`../scripts/publicacao/consultas/${NOME}.sql`, import.meta.url),
);
const SEM_COMENTARIO = SQL.split("\n")
  .filter((l) => !l.startsWith("--"))
  .join("\n");
const SEM_TEXTO = SEM_COMENTARIO.replace(/'(?:[^']|'')*'/g, "''");

Deno.test("185: um statement só, só catálogo, nada escrito, nenhuma linha de tabela lida", () => {
  assertEquals(contarStatements(SQL), 1);
  assert(/^WITH\b/.test(SEM_COMENTARIO.trimStart()));
  assert(
    !/\b(INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|CREATE|DROP|TRUNCATE|COPY|SET|CALL|DO)\b/i.test(
      SEM_TEXTO,
    ),
    "a 185 só lê",
  );
  // o que ela lê: só pg_catalog (pg_default_acl, pg_roles, pg_class) e os CTEs dela
  const lidos = [...SEM_TEXTO.matchAll(/\bFROM\s+([a-z_][a-z0-9_.]*)/gi)].map(
    (m) => m[1].toLowerCase(),
  );
  const permitidos = new Set([
    "pg_catalog.pg_default_acl",
    "pg_catalog.pg_roles",
    "pg_class",
    "efetivo",
    "recebe",
    "executa",
    "itens",
  ]);
  for (const l of lidos) assert(permitidos.has(l), `lê ${l}`);
  assertStringIncludes(
    SEM_COMENTARIO,
    "SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;",
  );
});

Deno.test("185: os itens do SQL são EXATAMENTE o ROL_DA_185, na ordem, e o esperado de cada um é o do provisionador", () => {
  const linhas = [
    ...SEM_COMENTARIO.matchAll(
      /(?:\(item, esperado, vivo\) AS \(\s*|UNION ALL )SELECT '([^']+)',\s*'([^']+)'/g,
    ),
  ].map((m) => [m[1], m[2]]);
  assertEquals(
    linhas.map(([i]) => i),
    ROL_DA_185,
  );
  assertEquals(ROL_DA_185.length, 8);
  assertEquals(new Set(ROL_DA_185).size, 8);
  const esperado = new Map(linhas);
  for (const item of ROL_DA_185.slice(0, 7))
    assertEquals(esperado.get(item), "sim", item);
  // a linha de registro: o que os 9 comandos de privilegios-padrao.cjs dão em
  // função nova (os 3 papéis) mais o padrão embutido do Postgres (PUBLIC e o dono)
  const papeisDoModulo = comandosDosPrivilegiosPadrao()
    .filter((c) => c.includes("ON FUNCTIONS"))
    .map((c) => /TO "([a-z_]+)"$/.exec(c)[1]);
  assertEquals(
    esperado.get(ROL_DA_185[7]),
    ["PUBLIC", "postgres", ...papeisDoModulo].sort().join(","),
  );
  // tabelas: o mínimo do bloco oficial da doc; sequências: USAGE e SELECT
  assertEquals(
    (
      SEM_COMENTARIO.match(
        /ARRAY\['SELECT', 'INSERT', 'UPDATE', 'DELETE'\]/g,
      ) ?? []
    ).length,
    3,
  );
  assertEquals(
    (SEM_COMENTARIO.match(/ARRAY\['USAGE', 'SELECT'\]/g) ?? []).length,
    3,
  );
  // o papel medido é o postgres (o dono das tabelas das lojas)
  assertStringIncludes(SEM_COMENTARIO, "WHERE r.rolname = 'postgres'");
});

Deno.test("185: resposta com o rol inteiro passa no conferidor de rol fechado; faltando ou repetindo, não", () => {
  const linhas = ROL_DA_185.map((item) => ({
    item,
    esperado: "sim",
    vivo: "sim",
    ok: true,
  }));
  assertEquals(estruturaDoRolFechado(linhas, ROL_DA_185), null);
  assert(estruturaDoRolFechado(linhas.slice(1), ROL_DA_185) !== null);
  assert(estruturaDoRolFechado([...linhas, linhas[0]], ROL_DA_185) !== null);
});

Deno.test("185: está no menu do workflow conferir-banco-da-loja e na lista de consultas do script", () => {
  const yaml = Deno.readTextFileSync(
    new URL("../.github/workflows/conferir-banco-da-loja.yml", import.meta.url),
  );
  assertStringIncludes(yaml, `\n          - ${NOME}\n`);
  assert(listarConsultas().includes(NOME));
});

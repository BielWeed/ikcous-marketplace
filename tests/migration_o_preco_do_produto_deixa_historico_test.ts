import { createHash } from "node:crypto";
import { createRequire } from "node:module";
// O COMPORTAMENTO do gatilho e' provado no Postgres efemero (tests/banco/o-preco-do-produto-deixa-historico-viva.cjs);
// o contrato dos arquivos da migration esta em tests/front/o-preco-do-produto-deixa-historico.test.ts.
// Aqui ficam as ancoras que ligam a migration ao resto da casa: as consultas 91a/91b (o md5 tem de ser o do corpo real da funcao),
// o rol fechado, o lote da release, o aplicador e os workflows.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const nome = "20261386000000_o_preco_do_produto_deixa_historico.sql";
const A = "91a-conferir-o-preco-do-produto-deixa-historico-aplicado";
const B = "91b-antes-o-preco-do-produto-deixa-historico-ausente";
const lerRaiz = (p: string) =>
  Deno.readTextFileSync(new URL(`../${p}`, import.meta.url)).replace(/\r/g, "");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// O corpo (prosrc) da funcao do gatilho: o texto entre os dois $function$ do CREATE OR REPLACE dela.
function corpo(sql: string): string {
  const i = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.registrar_historico_de_preco(",
  );
  assert(i >= 0, "a funcao nao esta na migration");
  const abre = sql.indexOf("$function$", i) + "$function$".length;
  return sql.slice(abre, sql.indexOf("$function$", abre));
}

Deno.test("1386: a consulta 91a confere o MESMO corpo (md5) que a migration grava, uma vez", () => {
  const sql = lerRaiz(`supabase/migrations/${nome}`);
  const h = md5(corpo(sql));
  const a = lerRaiz(`scripts/publicacao/consultas/${A}.sql`);
  assertEquals(a.split(`'${h}'`).length - 1, 1);
});

Deno.test("1386: as consultas 91a/91b sao so de leitura e a 91b nao le linha de dado", () => {
  for (const consulta of [A, B]) {
    const c = lerRaiz(`scripts/publicacao/consultas/${consulta}.sql`);
    // Sem comentarios e sem literais de texto (os rotulos citam nomes sem executar nada).
    const codigo = c.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/.test(
        codigo,
      ),
      `${consulta}: so leitura`,
    );
  }
  const b = lerRaiz(`scripts/publicacao/consultas/${B}.sql`).replace(
    /--.*$/gm,
    "",
  );
  assert(
    !/\bFROM\s+(public\.)?(produtos|produto_historico_preco)\b/i.test(b),
    "a 91b nao le linha de dado",
  );
  // A 91a le UMA contagem, dentro de um literal executado so se a tabela existe (antes do apply responde "nao", nunca erro):
  // nenhuma referencia estatica a tabela fora de to_regclass/regclass.
  const a = lerRaiz(`scripts/publicacao/consultas/${A}.sql`)
    .replace(/--.*$/gm, "")
    .replace(/'[^']*'/g, "''");
  assert(
    !/\bFROM\s+(public\.)?(produtos|produto_historico_preco)\b/i.test(a),
    "a 91a nao referencia a tabela estaticamente (daria erro antes do apply)",
  );
  assertStringIncludes(
    lerRaiz(`scripts/publicacao/consultas/${A}.sql`),
    "query_to_xml(",
  );
});

Deno.test("1386: rol fechado das 91a/91b, registro nos workflows e na release, lote unico e prova viva", () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  const roles = new Map<string, string[]>(
    Object.entries(conf.ROL_FECHADO_POR_CONSULTA),
  );
  assertEquals(roles.get(A)?.length, 8);
  assertEquals(roles.get(B)?.length, 4);
  for (const consulta of [A, B]) {
    const rol = roles.get(consulta) ?? [];
    assertEquals(new Set(rol).size, rol.length);
    // Cada item do rol esta no SQL, com o rotulo exato (o veredito compara por nome).
    const sql = lerRaiz(`scripts/publicacao/consultas/${consulta}.sql`);
    for (const item of rol) assertStringIncludes(sql, `'${item}'`);
    assertStringIncludes(
      lerRaiz(".github/workflows/conferir-banco-da-loja.yml"),
      `- ${consulta}\n`,
    );
    assertEquals(
      lerRaiz(".github/workflows/rpc-ci.yml").split(`consultas/${consulta}.sql`)
        .length - 1,
      2,
      "nas duas listas de paths do rpc-ci",
    );
    assertStringIncludes(
      lerRaiz("scripts/frota/publicar-release.mjs"),
      `"${consulta}"`,
    );
  }
  const canais = JSON.parse(lerRaiz("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter((x: { versoes?: string[] }) =>
    (x.versoes ?? []).includes("20261386000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].consulta, A);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B);
  assertEquals(lotes[0].versoes, ["20261386000000"]);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assertEquals(Object.hasOwn(lotes[0], campo), false, campo);
  assertStringIncludes(
    lerRaiz(".github/workflows/rpc-ci.yml"),
    "run: node tests/banco/rodar-isolado.cjs tests/banco/o-preco-do-produto-deixa-historico-viva.cjs",
  );
  assertStringIncludes(
    lerRaiz("tests/banco/LEIA-ME.md"),
    "o-preco-do-produto-deixa-historico-viva.cjs",
  );
});

Deno.test("1386: o aplicador confere o corpo da funcao do gatilho depois do apply", () => {
  const mapa = require("../scripts/db-apply.cjs");
  const entrada = new Map<string, { funcao: string }>(
    Object.entries(mapa.VERIFICACOES),
  ).get(nome);
  assertEquals(entrada?.funcao, "registrar_historico_de_preco");
});

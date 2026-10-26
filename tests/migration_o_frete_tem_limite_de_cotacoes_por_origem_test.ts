import { createHash } from "node:crypto";
import { createRequire } from "node:module";
// O COMPORTAMENTO do contador (teto, atomicidade, janela, limpeza, acesso) e' provado no Postgres efemero
// (tests/banco/o-frete-tem-limite-de-cotacoes-viva.cjs); o comportamento da EDGE (429, falha aberta, o que conta) esta em
// supabase/functions/calculate-shipping/limite_por_origem_test.ts. Aqui ficam as ancoras que ligam a migration ao resto da casa:
// as consultas 95a/95b (o md5 tem de ser o do corpo real da funcao), o rol fechado, o lote da release, o aplicador, os workflows e
// o CONTRATO entre a edge e a funcao (nome, argumentos e faixas que a edge manda).
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  COTACOES_POR_JANELA,
  JANELA_EM_SEGUNDOS,
} from "../supabase/functions/calculate-shipping/limite-por-origem.ts";

const require = createRequire(import.meta.url);
const nome = "20261389000000_o_frete_tem_limite_de_cotacoes_por_origem.sql";
const A = "95a-conferir-o-frete-tem-limite-de-cotacoes-aplicado";
const B = "95b-antes-o-frete-tem-limite-de-cotacoes-ausente";
const lerBruto = (p: string) =>
  Deno.readTextFileSync(new URL(`../${p}`, import.meta.url));
const lerRaiz = (p: string) => lerBruto(p).replace(/\r/g, "");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// O corpo (prosrc) da funcao: o texto entre os dois $function$ do CREATE OR REPLACE dela.
function corpo(sql: string): string {
  const i = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.frete_consumir_cota(",
  );
  assert(i >= 0, "a funcao nao esta na migration");
  const abre = sql.indexOf("$function$", i) + "$function$".length;
  return sql.slice(abre, sql.indexOf("$function$", abre));
}

const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

Deno.test("1389: arquivos em LF, so ASCII, sem BEGIN/COMMIT e com lock_timeout (o aplicador abre a transacao)", () => {
  for (const arq of [nome, `rollback-manual-${nome}`]) {
    const bruto = lerBruto(`supabase/migrations/${arq}`);
    assert(!bruto.includes("\r"), `${arq}: CRLF quebra o md5 dos pre-voos`);
    assert(
      [...bruto].every((ch) => ch.charCodeAt(0) < 128),
      `${arq}: so ASCII, como as vizinhas`,
    );
    const codigo = semComentarios(bruto);
    assert(
      !/^\s*(BEGIN|COMMIT)\s*;/im.test(codigo),
      `${arq}: sem BEGIN/COMMIT`,
    );
    assert(
      /SET LOCAL lock_timeout\s*=\s*'5s'/.test(codigo),
      `${arq}: lock_timeout`,
    );
  }
});

Deno.test("1389: a tabela nasce fechada (RLS, sem politica, sem grant) e a funcao so e' do service_role", () => {
  const codigo = semComentarios(lerRaiz(`supabase/migrations/${nome}`));
  assertStringIncludes(
    codigo,
    "CREATE TABLE IF NOT EXISTS public.frete_cota_por_origem",
  );
  assertStringIncludes(
    codigo,
    "ALTER TABLE public.frete_cota_por_origem ENABLE ROW LEVEL SECURITY;",
  );
  assertStringIncludes(
    codigo,
    "REVOKE ALL ON TABLE public.frete_cota_por_origem FROM PUBLIC, anon, authenticated, service_role;",
  );
  assert(!/CREATE POLICY/i.test(codigo), "tabela fechada: nenhuma politica");
  assert(
    !/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*frete_cota_por_origem/i.test(
      codigo,
    ),
    "nenhum grant na tabela",
  );
  assertStringIncludes(codigo, "SECURITY DEFINER");
  assertStringIncludes(codigo, "SET search_path = pg_catalog, pg_temp");
  assertStringIncludes(
    codigo,
    "REVOKE ALL ON FUNCTION public.frete_consumir_cota(text, integer, integer) FROM PUBLIC, anon, authenticated;",
  );
  assertStringIncludes(
    codigo,
    "GRANT EXECUTE ON FUNCTION public.frete_consumir_cota(text, integer, integer) TO service_role;",
  );
  // So um GRANT na migration inteira, e e' o do service_role.
  assertEquals((codigo.match(/\bGRANT\b/g) ?? []).length, 1);
});

Deno.test("1389: a consulta 95a confere o MESMO corpo (md5) que a migration grava; a migration o cita no pre-voo e no pos-voo", () => {
  const sql = lerRaiz(`supabase/migrations/${nome}`);
  const h = md5(corpo(sql));
  assertEquals(
    sql.split(`'${h}'`).length - 1,
    2,
    "pre-voo e pos-voo da migration",
  );
  const a = lerRaiz(`scripts/publicacao/consultas/${A}.sql`);
  assertEquals(a.split(`'${h}'`).length - 1, 1);
});

Deno.test("1389: as consultas 95a/95b sao so de leitura e nao leem linha de tabela nenhuma", () => {
  for (const consulta of [A, B]) {
    const c = lerRaiz(`scripts/publicacao/consultas/${consulta}.sql`);
    const codigo = c.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/.test(
        codigo,
      ),
      `${consulta}: so leitura`,
    );
    assert(
      !/\bFROM\s+(public\.)?frete_cota_por_origem\b/i.test(codigo),
      `${consulta}: nao le a tabela (daria erro antes do apply)`,
    );
  }
});

Deno.test("1389: rol fechado das 95a/95b, registro nos workflows e na release, lote unico e prova viva", () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  const roles = new Map<string, string[]>(
    Object.entries(conf.ROL_FECHADO_POR_CONSULTA),
  );
  assertEquals(roles.get(A)?.length, 6);
  assertEquals(roles.get(B)?.length, 3);
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
    (x.versoes ?? []).includes("20261389000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].consulta, A);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B);
  assertEquals(lotes[0].versoes, ["20261389000000"]);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"]) {
    assertEquals(Object.hasOwn(lotes[0], campo), false, campo);
  }
  assertStringIncludes(
    lerRaiz(".github/workflows/rpc-ci.yml"),
    "run: node tests/banco/rodar-isolado.cjs tests/banco/o-frete-tem-limite-de-cotacoes-viva.cjs",
  );
  assertStringIncludes(
    lerRaiz("tests/banco/LEIA-ME.md"),
    "o-frete-tem-limite-de-cotacoes-viva.cjs",
  );
});

Deno.test("1389: o aplicador confere o corpo da funcao depois do apply, e cada marcador esta no corpo uma vez", () => {
  const mapa = require("../scripts/db-apply.cjs");
  const entrada = new Map<
    string,
    { funcao: string; esperado: Array<{ texto: string; vezes: number }> }
  >(Object.entries(mapa.VERIFICACOES)).get(nome);
  assertEquals(entrada?.funcao, "frete_consumir_cota");
  const c = corpo(lerRaiz(`supabase/migrations/${nome}`));
  for (const { texto, vezes } of entrada?.esperado ?? []) {
    assertEquals(c.split(texto).length - 1, vezes, texto);
  }
});

Deno.test("1389: o CONTRATO edge x banco — nome, argumentos e faixas que a edge manda cabem no que a funcao aceita", () => {
  const sql = lerRaiz(`supabase/migrations/${nome}`);
  const edge = lerRaiz(
    "supabase/functions/calculate-shipping/limite-por-origem.ts",
  );
  assertStringIncludes(edge, "supabase.rpc('frete_consumir_cota', {");
  for (const arg of ["p_origem", "p_limite", "p_janela_segundos"]) {
    assertStringIncludes(edge, `${arg}:`);
    assertStringIncludes(sql, `${arg} `);
  }
  // As mesmas faixas que a funcao valida (limite 1..100000, janela 10..3600): o numero da edge nunca vira 22023.
  assert(COTACOES_POR_JANELA >= 1 && COTACOES_POR_JANELA <= 100000);
  assert(JANELA_EM_SEGUNDOS >= 10 && JANELA_EM_SEGUNDOS <= 3600);
  // A edge manda um hash de 32 hex minusculas, o formato do CHECK da tabela.
  assertStringIncludes(sql, "'^[0-9a-f]{32}$'");
  assertStringIncludes(edge, ".slice(0, 32)");
  // A edge usa a chave de servico (so ela executa) e a calculate-shipping segue publicavel pelo canal.
  assertStringIncludes(
    lerRaiz("supabase/functions/calculate-shipping/index.ts"),
    "createClient(supabaseUrl, supabaseServiceRole)",
  );
});

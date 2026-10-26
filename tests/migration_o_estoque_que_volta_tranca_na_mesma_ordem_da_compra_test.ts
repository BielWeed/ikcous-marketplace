import { createHash } from "node:crypto";
import { createRequire } from "node:module";
// O COMPORTAMENTO (o deadlock com a compra, o credito identico, pre e pos-voo, rollback) e' provado no Postgres efemero com duas conexoes
// reais (tests/banco/o-estoque-que-volta-tranca-na-mesma-ordem-viva.cjs). Aqui ficam as ancoras que ligam a migration ao resto da casa:
// o corpo novo e' o da 20261175000000 mais SO as duas edicoes marcadas, o rollback devolve o corpo da 175 byte a byte, as consultas
// 96a/96b citam o md5 certo, o rol fechado, o lote da release, o aplicador e os workflows.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const nome =
  "20261389100000_o_estoque_que_volta_tranca_na_mesma_ordem_da_compra.sql";
const A = "96a-conferir-o-estoque-que-volta-tranca-na-mesma-ordem-aplicado";
const B = "96b-antes-o-estoque-que-volta-tranca-na-mesma-ordem-base-vigente";
const lerBruto = (p: string) =>
  Deno.readTextFileSync(new URL(`../${p}`, import.meta.url));
const lerRaiz = (p: string) => lerBruto(p).replace(/\r/g, "");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// O corpo (prosrc) de devolver_estoque: o texto entre os dois $devolver$ do CREATE OR REPLACE dela.
function corpo(sql: string): string {
  const i = sql.indexOf("CREATE OR REPLACE FUNCTION public.devolver_estoque(");
  assert(i >= 0, "a funcao nao esta no arquivo");
  const abre = sql.indexOf("$devolver$", i) + "$devolver$".length;
  return sql.slice(abre, sql.indexOf("$devolver$", abre));
}

const migration = lerRaiz(`supabase/migrations/${nome}`);
const rollback = lerRaiz(`supabase/migrations/rollback-manual-${nome}`);
const corpo175 = corpo(
  lerRaiz("supabase/migrations/20261175000000_a_devolucao_nasce_no_pedido.sql"),
);
const H_VIGENTE = "05f6f7e6ac7a2fa7793298110cf17e96";

Deno.test("1389100: o corpo vigente que a migration troca e' mesmo o da 20261175000000 (md5)", () => {
  assertEquals(md5(corpo175), H_VIGENTE);
});

Deno.test("1389100: arquivos em LF, sem BEGIN/COMMIT, com lock_timeout (o aplicador abre a transacao)", () => {
  for (const arq of [nome, `rollback-manual-${nome}`]) {
    const bruto = lerBruto(`supabase/migrations/${arq}`);
    assert(!bruto.includes("\r"), `${arq}: CRLF quebra o md5 dos pre-voos`);
    const codigo = bruto
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
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

Deno.test("1389100: o corpo novo e' o da 175 MAIS SO as duas edicoes marcadas (declaracoes e bloco de travas)", () => {
  const novo = corpo(migration);
  assert(novo !== corpo175);
  const semEdicoes = novo
    .replace(
      / {4}-- 20261389100000: ids a trancar de uma vez[^\n]*\n {4}v_trava_variantes uuid\[\];\n {4}v_trava_produtos {2}uuid\[\];\n/,
      "",
    )
    .replace(
      / {4}-- >>> ordem global das travas \(20261389100000\)\n[\s\S]*? {4}-- <<< ordem global das travas \(20261389100000\)\n\n/,
      "",
    );
  assertEquals(
    semEdicoes,
    corpo175,
    "fora das duas edicoes o corpo e' o da 175, byte a byte",
  );
});

Deno.test("1389100: o rollback devolve o corpo da 175 byte a byte e a migration cita os dois md5 no pre e no pos-voo", () => {
  assertEquals(corpo(rollback), corpo175);
  const hNovo = md5(corpo(migration));
  assertEquals(
    migration.split(`'${hNovo}'`).length - 1,
    2,
    "pre-voo e conferencia da migration",
  );
  assertEquals(
    migration.split(`'${H_VIGENTE}'`).length - 1,
    1,
    "pre-voo aceita o corpo da 175",
  );
  assertEquals(
    rollback.split(`'${hNovo}'`).length - 1,
    1,
    "pre-voo do rollback aceita o desta",
  );
  assertEquals(
    rollback.split(`'${H_VIGENTE}'`).length - 1,
    2,
    "pre-voo e conferencia do rollback",
  );
  // O comentario da funcao volta ao da 175 no rollback.
  const comentario175 = lerRaiz(
    "supabase/migrations/20261175000000_a_devolucao_nasce_no_pedido.sql",
  );
  const c0 = comentario175.indexOf(
    "COMMENT ON FUNCTION public.devolver_estoque(uuid) IS",
  );
  const textoComentario = comentario175.slice(
    c0,
    comentario175.indexOf(";\n", c0) + 2,
  );
  assertStringIncludes(rollback, textoComentario);
});

Deno.test("1389100: variacoes ANTES de produtos, cada grupo ordenado por id, como na compra (20261350/20261384)", () => {
  const novo = corpo(migration);
  const iv = novo.indexOf("ORDER BY v.id");
  const ip = novo.indexOf("ORDER BY p.id");
  assert(iv > 0 && ip > iv, "variacoes trancadas antes dos produtos");
  assert(
    novo.indexOf("PERFORM 1") < novo.indexOf("FOR v_item IN"),
    "as travas vem antes do laco que credita",
  );
  assert(
    novo.indexOf("IF v_ganhou IS NOT TRUE THEN") < iv,
    "pedido ja devolvido sai ANTES de trancar qualquer coisa",
  );
  // A premissa: a compra tranca nessa mesma ordem. Se ela mudar, esta migration deixa de alinhar com ela.
  for (const compra of [
    "20261350000000_a_compra_online_trava_o_preco_e_espera_a_mesma_chave.sql",
    "20261384000000_o_pedido_pelo_app_exige_conta_e_nao_prende_estoque_de_visitante.sql",
  ]) {
    const c = lerRaiz(`supabase/migrations/${compra}`);
    const a = c.indexOf("ordem global das travas (20261350000000)");
    const v = c.indexOf("ORDER BY v.id", a);
    const p = c.indexOf("ORDER BY p.id", a);
    assert(
      a > 0 && v > a && p > v,
      `${compra}: variacoes por id, depois produtos por id`,
    );
  }
});

Deno.test("1389100: as consultas 96a/96b citam o md5 certo e sao so de leitura, sem ler linha de tabela", () => {
  const hNovo = md5(corpo(migration));
  assertEquals(
    lerRaiz(`scripts/publicacao/consultas/${A}.sql`).split(`'${hNovo}'`)
      .length - 1,
    1,
  );
  assertEquals(
    lerRaiz(`scripts/publicacao/consultas/${B}.sql`).split(`'${H_VIGENTE}'`)
      .length - 1,
    1,
  );
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
      !/\bFROM\s+(public\.)?(marketplace_orders|marketplace_order_items|produtos|product_variants)\b/i.test(
        codigo,
      ),
      `${consulta}: nao le linha de dado`,
    );
  }
});

Deno.test("1389100: rol fechado das 96a/96b, registro nos workflows e na release, lote unico e prova viva", () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  const roles = new Map<string, string[]>(
    Object.entries(conf.ROL_FECHADO_POR_CONSULTA),
  );
  assertEquals(roles.get(A)?.length, 3);
  assertEquals(roles.get(B)?.length, 4);
  for (const consulta of [A, B]) {
    const rol = roles.get(consulta) ?? [];
    assertEquals(new Set(rol).size, rol.length);
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
    (x.versoes ?? []).includes("20261389100000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].consulta, A);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B);
  assertEquals(lotes[0].versoes, ["20261389100000"]);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"]) {
    assertEquals(Object.hasOwn(lotes[0], campo), false, campo);
  }
  assertStringIncludes(
    lerRaiz(".github/workflows/rpc-ci.yml"),
    "run: node tests/banco/rodar-isolado.cjs tests/banco/o-estoque-que-volta-tranca-na-mesma-ordem-viva.cjs",
  );
  assertStringIncludes(
    lerRaiz("tests/banco/LEIA-ME.md"),
    "o-estoque-que-volta-tranca-na-mesma-ordem-viva.cjs",
  );
});

Deno.test("1389100: o aplicador confere o corpo depois do apply e cada marcador esta no corpo na contagem certa", () => {
  const mapa = require("../scripts/db-apply.cjs");
  const entrada = new Map<
    string,
    { funcao: string; esperado: Array<{ texto: string; vezes: number }> }
  >(Object.entries(mapa.VERIFICACOES)).get(nome);
  assertEquals(entrada?.funcao, "devolver_estoque");
  const c = corpo(migration);
  assert((entrada?.esperado ?? []).length >= 5);
  for (const { texto, vezes } of entrada?.esperado ?? []) {
    assertEquals(c.split(texto).length - 1, vezes, texto);
  }
});

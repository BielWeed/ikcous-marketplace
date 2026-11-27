// 20261643000000 — as listas dos ajustes nao somem entre aparelhos. Prova de TEXTO (o comportamento e da prova viva
// tests/banco/as-listas-dos-ajustes-viva.cjs, no Postgres efemero do CI): a migration troca SO o corpo das duas RPCs
// (o que entra e exatamente os blocos novos), sem BEGIN/COMMIT nem DROP, com pre-voo pelos dois pares (vigente, desta)
// e conferencia no fim; o rollback devolve os dois corpos byte a byte; a publicacao (203a/203b, canais, db-apply, menu,
// rpc-ci) e as provas antigas (sucessoras da 99, posterior, consultas antecessoras) conhecem a sucessora.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const NOME =
  "20261643000000_as_listas_dos_ajustes_nao_somem_entre_aparelhos.sql";
const A =
  "203a-conferir-as-listas-dos-ajustes-nao-somem-entre-aparelhos-aplicado";
const B =
  "203b-antes-as-listas-dos-ajustes-nao-somem-entre-aparelhos-base-vigente";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (n: string) =>
  Deno.readTextFileSync(new URL(n, dir)).replace(/\r/g, "");
const rel = (p: string) =>
  Deno.readTextFileSync(new URL(`../${p}`, import.meta.url)).replace(/\r/g, "");

const UP =
  "CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)";
const PO =
  "CREATE OR REPLACE FUNCTION public.salvar_politica_de_devolucao(p jsonb)";
function definicao(sql: string, assinatura: string) {
  const i = sql.indexOf(assinatura);
  assert(i >= 0, `${assinatura} precisa existir`);
  assertEquals(sql.indexOf(assinatura, i + 1), -1, `${assinatura} duas vezes`);
  return sql.slice(i, sql.indexOf("$$;\n", i) + 3);
}
const corpo = (def: string) => def.split("AS $$")[1].split("$$;")[0];
const md5 = (t: string) => createHash("md5").update(t).digest("hex");

const MIG = ler(NOME);
const RB = ler(`rollback-manual-${NOME}`);
const UP_310 = definicao(ler("20261310000000_estilo_do_card_de_frete.sql"), UP);
const PO_99 = definicao(
  ler("20261199000000_portas_do_painel_exigem_admin_atual.sql"),
  PO,
);
const H_UP = md5(corpo(definicao(MIG, UP)));
const H_PO = md5(corpo(definicao(MIG, PO)));

Deno.test("20261643: os hashes do pre-voo, da conferencia e do posterior sao os md5 reais dos corpos", () => {
  assertEquals(md5(corpo(UP_310)), "aa4ed730ac6ad3d3c2644b4285ff39a9");
  assertEquals(md5(corpo(PO_99)), "043f816330a66b290fd04d272a4ee934");
  assertStringIncludes(
    MIG,
    `('public.upsert_store_config(jsonb)', 'aa4ed730ac6ad3d3c2644b4285ff39a9', '${H_UP}')`,
  );
  assertStringIncludes(
    MIG,
    `('public.salvar_politica_de_devolucao(jsonb)', '043f816330a66b290fd04d272a4ee934', '${H_PO}')`,
  );
  // exatamente os dois pares (o regex de tests/banco/sucessoras-da-99.cjs conta)
  assertEquals(
    [
      ...MIG.matchAll(
        /\('(public\.[a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g,
      ),
    ].length,
    2,
  );
  assertEquals(
    MIG.split(`IS DISTINCT FROM '${H_UP}'`).length - 1,
    1,
    "conferencia do upsert",
  );
  assertEquals(
    MIG.split(`IS DISTINCT FROM '${H_PO}'`).length - 1,
    1,
    "conferencia da politica",
  );
  const posterior = require("./banco/as-listas-dos-ajustes-posterior.cjs");
  assertEquals(posterior.HASH_UPSERT_DESTA, H_UP);
  assertEquals(posterior.HASH_POLITICA_DESTA, H_PO);
  assertEquals(posterior.NOME_DA_MIGRATION, NOME);
  const a203 = rel(`scripts/publicacao/consultas/${A}.sql`);
  assertStringIncludes(a203, `'${H_UP}'`);
  assertStringIncludes(a203, `'${H_PO}'`);
});

Deno.test("20261643: so o corpo muda — tirados os blocos novos, sobram os corpos da 310 e da 99 byte a byte", () => {
  const up = definicao(MIG, UP);
  const po = definicao(MIG, PO);
  const blocoUp = up.slice(
    up.indexOf("  -- AS LISTAS NAO SOMEM ENTRE APARELHOS (20261643000000)"),
    up.indexOf("  -- Handle text[] casting safely"),
  );
  const declUp = up.slice(
    up.indexOf("  -- 20261643000000: a lista que a tela VIU"),
    up.indexOf("BEGIN\n"),
  );
  assertEquals(up.replace(blocoUp, "").replace(declUp, ""), UP_310);
  const blocoPo = po.slice(
    po.indexOf("\n  -- AS LISTAS NAO SOMEM ENTRE APARELHOS (20261643000000)"),
    po.indexOf("\n  -- Parcial: campo ausente fica como está."),
  );
  const declPo = po.slice(
    po.indexOf("  -- 20261643000000: a lista que a tela VIU"),
    po.indexOf("BEGIN\n"),
  );
  assertEquals(po.replace(blocoPo, "").replace(declPo, ""), PO_99);
});

Deno.test("20261643: os blocos novos so rodam com `vistos`, travam a linha antes de comparar e recusam com LST01 por coluna", () => {
  const up = corpo(definicao(MIG, UP));
  const po = corpo(definicao(MIG, PO));
  // A conferencia vem ANTES de qualquer escrita.
  assert(
    up.indexOf("IF config_json ? 'vistos' THEN") <
      up.indexOf("INSERT INTO public.store_config"),
  );
  assert(
    po.indexOf("IF p ? 'vistos' THEN") <
      po.indexOf("UPDATE public.politica_devolucao SET"),
  );
  // A trava antes da comparacao.
  assert(up.indexOf("FOR UPDATE;") < up.indexOf("USING ERRCODE = 'LST01'"));
  assert(po.indexOf("FOR UPDATE;") < po.indexOf("USING ERRCODE = 'LST01'"));
  // As guardas de admin continuam as primeiras.
  assert(
    up.indexOf("IF NOT public.is_admin_atual() THEN") <
      up.indexOf("IF config_json ? 'vistos' THEN"),
  );
  assert(
    po.indexOf("IF NOT public.is_admin_atual() THEN") <
      po.indexOf("IF p ? 'vistos' THEN"),
  );
  for (const coluna of ["formas_pagamento_entrega", "home_sections"])
    assertStringIncludes(up, `USING ERRCODE = 'LST01', DETAIL = '${coluna}';`);
  assertStringIncludes(po, "USING ERRCODE = 'LST01', DETAIL = v_lista;");
  // Conjunto (formas e listas da politica) x jsonb inteiro (vitrines, com NULL e null aceitos).
  assertStringIncludes(
    up,
    "ARRAY(SELECT DISTINCT x FROM unnest(v_formas_no_banco) x ORDER BY 1)",
  );
  assertStringIncludes(
    up,
    "AND NULLIF(v_vitrines_no_banco, 'null'::jsonb) IS NOT NULL",
  );
  assertStringIncludes(
    up,
    "AND v_vitrines_no_banco IS DISTINCT FROM v_vistos->'home_sections' THEN",
  );
  assertStringIncludes(
    po,
    "IS DISTINCT FROM ARRAY(SELECT DISTINCT x FROM unnest(v_no_banco) x ORDER BY 1) THEN",
  );
  // So as listas da propria RPC sao aceitas em `vistos`.
  assertStringIncludes(
    up,
    "WHERE k NOT IN ('formas_pagamento_entrega', 'home_sections')) THEN",
  );
  assertStringIncludes(
    po,
    "IF v_lista NOT IN ('metodos_locais', 'metodos_nacionais', 'categorias_sem_troca')",
  );
});

Deno.test("20261643: sem BEGIN/COMMIT, sem DROP, com timeouts, pre-voo, conferencia e NOTIFY", () => {
  for (const sql of [MIG, RB]) {
    const semComentario = sql
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    assertEquals(
      /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(semComentario),
      false,
    );
    assertEquals(
      /\bDROP\s+(TABLE|COLUMN|VIEW|FUNCTION|TRIGGER|POLICY)\b/i.test(
        semComentario,
      ),
      false,
    );
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
    assert(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
    assertStringIncludes(sql, "B1_BASELINE_DIVERGENT");
    assertStringIncludes(sql, "B2_POSVOO_DIVERGENTE");
  }
  assertStringIncludes(MIG, "to_jsonb(p) - 'prosrc'");
  assertStringIncludes(MIG, "search_path=public");
  assertEquals((MIG.match(/SECURITY DEFINER/g) ?? []).length >= 2, true);
});

Deno.test("20261643: o rollback exige os corpos desta e devolve os da 310 e da 99 byte a byte", () => {
  assertEquals(definicao(RB, UP), UP_310);
  assertEquals(definicao(RB, PO), PO_99);
  assertStringIncludes(RB, `v_up IS DISTINCT FROM '${H_UP}'`);
  assertStringIncludes(RB, `v_po IS DISTINCT FROM '${H_PO}'`);
  assertStringIncludes(
    RB,
    "IS DISTINCT FROM 'aa4ed730ac6ad3d3c2644b4285ff39a9'",
  );
  assertStringIncludes(
    RB,
    "IS DISTINCT FROM '043f816330a66b290fd04d272a4ee934'",
  );
});

Deno.test("20261643: publicacao — 203a/203b de rol fechado, lote no canais, db-apply, menu, rpc-ci e release", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA,
    estruturaDoRolFechado,
    contarStatements,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const canais = JSON.parse(rel("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter((p: { versoes: string[] }) =>
    p.versoes.includes("20261643000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].consulta, A);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B);
  assert(new Map(Object.entries(VERIFICACOES)).has(NOME));
  for (const consulta of [A, B]) {
    const sql = rel(`scripts/publicacao/consultas/${consulta}.sql`);
    assertEquals(contarStatements(sql), 1);
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(
      consulta,
    ) as string[];
    assertEquals(rol.length, 4);
    assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    assertStringIncludes(
      rel(".github/workflows/conferir-banco-da-loja.yml"),
      `- ${consulta}`,
    );
    assertEquals(
      rel(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${consulta}.sql"`,
      ).length - 1,
      2,
    );
    for (const item of rol) assertStringIncludes(sql, `'${item}'`);
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assertEquals(estruturaDoRolFechado(linhas, rol), null);
    assert(estruturaDoRolFechado(linhas.slice(1), rol) !== null);
    // so catalogo: nenhuma tabela da loja e lida
    assertEquals(
      /FROM\s+public\.(store_config|politica_devolucao)\b/i.test(sql),
      false,
    );
  }
  assertStringIncludes(
    rel(".github/workflows/rpc-ci.yml"),
    "run: node tests/banco/rodar-isolado.cjs tests/banco/as-listas-dos-ajustes-viva.cjs",
  );
});

Deno.test("20261643: as consultas antecessoras aceitam o corpo novo como sucessor; a 8e cadastra as duas funcoes", () => {
  const c = (n: string) => rel(`scripts/publicacao/consultas/${n}.sql`);
  const c8e = c("8e-conferir-92-a-202-aplicado");
  assertStringIncludes(
    c8e,
    `('upsert_store_config', '${H_UP}', '20261643000000')`,
  );
  assertStringIncludes(
    c8e,
    `('salvar_politica_de_devolucao', '${H_PO}', '20261643000000')`,
  );
  // A 9a espera o corpo MAIS NOVO (o desta) e mostra o da 1244 e o da 1310 ainda no ar como ele.
  const c9a = c("9a-conferir-60-a-66-aplicado");
  assertStringIncludes(c9a, `('upsert_store_config', '${H_UP}')`);
  assertStringIncludes(
    c9a,
    `AND (c.h = '391e8e1064400df5aea579f3472b203c' OR c.h = 'aa4ed730ac6ad3d3c2644b4285ff39a9')
              THEN '${H_UP}'`,
  );
  assertStringIncludes(
    c("40a-conferir-identidade-legal-da-loja-aplicado"),
    `'aa4ed730ac6ad3d3c2644b4285ff39a9', '${H_UP}')`,
  );
  assertStringIncludes(
    c("47a-conferir-a-loja-escolhe-como-entrega-aplicado"),
    `f.m IN ('aa4ed730ac6ad3d3c2644b4285ff39a9', '${H_UP}')`,
  );
  assertStringIncludes(
    c("60a-conferir-estilo-card-frete-aplicado"),
    `WHEN m = '${H_UP}' THEN 'aa4ed730ac6ad3d3c2644b4285ff39a9'`,
  );
});

Deno.test("20261643: migration e rollback passam a fase zero; a sucessora da 99 esta cadastrada e o posterior da 310 a desfaz antes", () => {
  const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
  const fase = avaliarFase0({
    sqlMigration: MIG,
    sqlRollback: RB,
    temRollback: true,
  });
  assertEquals(fase.recusado, false, JSON.stringify(fase.motivos));
  const {
    conferirLista,
    SUCESSORAS_DA_99,
  } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
  assertEquals(
    SUCESSORAS_DA_99.filter((s: { nome: string }) => s.nome === NOME).length,
    2,
  );
  assertStringIncludes(
    rel("tests/banco/estilo-card-frete-posterior.cjs"),
    'require("./as-listas-dos-ajustes-posterior.cjs").desfazerAsListasDosAjustesNaTransacao(',
  );
});

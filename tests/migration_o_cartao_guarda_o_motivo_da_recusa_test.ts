import { createRequire } from "node:module";
// @ts-nocheck
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
const { avaliarFase0 } = createRequire(import.meta.url)(
  "../scripts/db-prove-rollback.cjs",
);
const nome = "20261260000000_o_cartao_guarda_o_motivo_da_recusa.sql";
function ler(prefixo = "") {
  try {
    return Deno.readTextFileSync(
      new URL(`../supabase/migrations/${prefixo}${nome}`, import.meta.url),
    ).replace(/\r\n/g, "\n");
  } catch {
    return "";
  }
}
Deno.test("D4 migration: tabela aditiva privada com identidade da tentativa, sem RPC pública", () => {
  const sql = ler();
  assertStringIncludes(
    sql,
    "CREATE TABLE public.tentativas_cartao_diagnostico",
  );
  assertStringIncludes(sql, "UNIQUE (mp_order_id, mp_payment_id)");
  assertStringIncludes(sql, "ENABLE ROW LEVEL SECURITY");
  assertStringIncludes(
    sql,
    "REVOKE ALL ON TABLE public.tentativas_cartao_diagnostico FROM PUBLIC, anon, authenticated",
  );
  assertStringIncludes(
    sql,
    "GRANT SELECT, INSERT, UPDATE ON TABLE public.tentativas_cartao_diagnostico TO service_role",
  );
  assert(!/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|POLICY)/i.test(sql));
  assert(!/\b(?:token|cpf|email|telefone|payer|card_number)\b/i.test(sql));
  assertStringIncludes(sql, "B1_BASELINE_DIVERGENT");
});
Deno.test("D4 migration: par aceito pela fase zero, rollback remove somente a tabela nova e recusa apagar histórico", () => {
  const migration = ler();
  const rollback = ler("rollback-manual-");
  assert(
    migration.length > 0 && rollback.length > 0,
    "par de migration e rollback existe",
  );
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, JSON.stringify(r));
  assertStringIncludes(
    rollback,
    "DROP TABLE public.tentativas_cartao_diagnostico;",
  );
  assertStringIncludes(
    rollback,
    "EXISTS (SELECT 1 FROM public.tentativas_cartao_diagnostico)",
  );
  assert(!/\bCASCADE\b/i.test(rollback));
});
// Registro do lote 56 (20261260) nas ferramentas de publicacao: o comportamento da tabela privada
// nao e provado aqui, so que o portao conhece a migration, as duas consultas e o rol exato de cada uma.
const lerRel = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r\n/g,
    "\n",
  );
const A56 = "56a-conferir-motivo-da-recusa-do-cartao-aplicado";
const B56 = "56b-antes-motivo-da-recusa-do-cartao-base-vigente";
Deno.test("20261260 publicacao: o canais-de-backend.json declara o lote de UMA migration de apply normal, com a 56b como ausencia", () => {
  const canais = JSON.parse(lerRel("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter(
    (p: any) => p.consulta === A56 || p.versoes?.includes("20261260000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].consulta, A56);
  assertEquals(lotes[0].versoes, ["20261260000000"]);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B56);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(lotes[0][campo], undefined, campo);
});
Deno.test("20261260 publicacao: 56a e 56b exigem o rol exato e estao nos dois gatilhos e no menu da conferencia", async () => {
  const { ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } = createRequire(
    import.meta.url,
  )("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const workflow = lerRel(".github/workflows/rpc-ci.yml");
  const menu = lerRel(".github/workflows/conferir-banco-da-loja.yml");
  for (const [consulta, quantidade] of [
    [A56, 7],
    [B56, 4],
  ] as const) {
    const sql = lerRel(`scripts/publicacao/consultas/${consulta}.sql`);
    const itens = [...sql.matchAll(/\bSELECT '([^']+)'/g)].map((m) => m[1]);
    assertEquals(itens.length, quantidade);
    const rol = Object.entries(ROL_FECHADO_POR_CONSULTA).find(
      ([nome]) => nome === consulta,
    )?.[1] as string[] | undefined;
    assert(rol, `rol ausente: ${consulta}`);
    assertEquals([...rol].sort(), [...itens].sort());
    assertEquals(new Set(rol).size, quantidade);
    assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assertEquals(estruturaDoRolFechado(linhas, rol), null);
    for (const invalida of [
      linhas.slice(1),
      [...linhas.slice(1), linhas[1]],
      [...linhas, { ...linhas[0], item: "desconhecido" }],
      linhas.map((linha: any) => ({ ...linha, colunaExtra: true })),
    ]) {
      assert(estruturaDoRolFechado(invalida, rol) !== null);
    }
    assertStringIncludes(menu, `- ${consulta}\n`);
    const caminho = `"scripts/publicacao/consultas/${consulta}.sql"`;
    assertEquals(workflow.split(caminho).length - 1, 2);
    for (const evento of ["pull_request", "push"]) {
      const bloco = workflow
        .split(`  ${evento}:`)[1]
        ?.split(/\n {2}[a-z_]+:|\n[a-z_]+:/)[0];
      assert(bloco, `gatilho ausente: ${evento}`);
      assertStringIncludes(bloco, caminho);
    }
  }
});
Deno.test("REV4 publicacao: 56a exige CHECKs completos com operandos exatos, não trechos permissivos", () => {
  const sql = lerRel(`scripts/publicacao/consultas/${A56}.sql`);
  // O teste é estático: não executa SQL nem presume uma prova de catálogo vivo.
  // As seis expressões são comparadas inteiras, sem retirar texto dos literais.
  for (const [nome, expressao] of [
    ["mp_order_id", "CHECKmp_order_id~'^[A-Za-z0-9_-]{1,100}$'"],
    ["mp_payment_id", "CHECKmp_payment_id~'^[A-Za-z0-9_-]{1,100}$'"],
    [
      "status",
      "CHECKstatus=ANYARRAY['failed','rejected','processing','in_process','pending','action_required']",
    ],
    ["status_detail", "CHECKstatus_detail~'^[a-z][a-z0-9_]{0,119}$'"],
    ["parcelas", "CHECKparcelas>=1ANDparcelas<=12"],
    ["valor", "CHECKvalor>0"],
  ]) {
    const literalSql = expressao.replace(/'/g, "''");
    assertStringIncludes(
      sql,
      `('tentativas_cartao_diagnostico_${nome}_check', '${literalSql}')`,
    );
  }
  assertStringIncludes(sql, "k.definicao = esperado_check.definicao");
  assertStringIncludes(sql, "pg_get_constraintdef(k.oid)");
  assertStringIncludes(sql, "WITH ORDINALITY");
  assertStringIncludes(sql, "THEN pedaco[1]");
  assertStringIncludes(sql, "'::(text|numeric|integer|smallint)(\\[\\])?'");
  assertStringIncludes(sql, "'[[:space:]()]'");
  assert(!sql.includes("position(esperado_check.trecho"));
});

Deno.test("20261260 publicacao: as consultas 56a e 56b so leem catalogo, nunca a tabela de tentativas", () => {
  for (const consulta of [A56, B56]) {
    const sql = lerRel(`scripts/publicacao/consultas/${consulta}.sql`);
    // sem comentarios e sem literais ('INSERT' dentro de aspas e dado, nao comando)
    const codigo = sql
      .replace(/^\s*--.*$/gm, "")
      .replace(/'(?:[^']|'')*'/g, "''");
    assert(
      !/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i.test(
        codigo,
      ),
      consulta,
    );
    assert(
      !/\bFROM\s+(?:public\.)?tentativas_cartao_diagnostico\b/i.test(codigo),
      consulta,
    );
    assertEquals(codigo.trimEnd().split(";").length, 2, "uma instrucao so");
  }
});

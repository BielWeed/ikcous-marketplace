import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0, detectarTransacaoExplicita, removerRuido } =
  require("../scripts/db-prove-rollback.cjs");
const nome = "20261290000000_online_sem_forma_nao_e_pix.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (arquivo: string) =>
  Deno.readTextFileSync(new URL(arquivo, dir)).replace(/\r/g, "");
const migration = ler(nome);
const anterior = ler("20261177000000_o_financeiro_da_loja_nasce.sql");
const assinatura =
  "CREATE OR REPLACE FUNCTION public.fin__forma_do_pedido(p_payment_method text, p_metodo_online text)";
const revoke =
  "REVOKE ALL ON FUNCTION public.fin__forma_do_pedido(text, text) FROM PUBLIC, anon, authenticated;";

function definicao(sql: string) {
  const inicio = sql.indexOf(assinatura);
  assert(inicio >= 0, "assinatura ausente");
  const fim = sql.indexOf("$$;", inicio);
  assert(fim > inicio, "corpo sem fechamento");
  return sql.slice(inicio, fim + 3);
}

Deno.test("20261290: rollback executável restaura a definição anterior byte a byte e a mesma ACL", () => {
  const rollback = ler(`rollback-manual-${nome}`);
  assertEquals(definicao(rollback), definicao(anterior));
  assertStringIncludes(anterior, revoke);
  assertStringIncludes(rollback, revoke);
  assertEquals(/\bGRANT\b/i.test(removerRuido(rollback)), false);
  assertStringIncludes(migration, `rollback-manual-${nome}`);
});

Deno.test("20261290: guarda do rollback só aceita o hash do corpo novo, antes de substituí-lo", () => {
  const rollback = ler(`rollback-manual-${nome}`);
  const corpo = definicao(migration).split("AS $$")[1].split("$$;")[0];
  const hash = createHash("md5").update(corpo).digest("hex");
  assertStringIncludes(rollback, "md5(replace(prosrc, E'\\r', ''))");
  assertStringIncludes(
    rollback,
    "to_regprocedure('public.fin__forma_do_pedido(text,text)')",
  );
  assertStringIncludes(rollback, `v_hash IS DISTINCT FROM '${hash}'`);
  assertStringIncludes(rollback, "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:");
  assert(
    rollback.indexOf("B1_BASELINE_DIVERGENT") < rollback.indexOf(assinatura),
  );
});

Deno.test("20261290: migration e rollback não controlam transação e passam a fase 0 do aplicador", () => {
  const rollback = ler(`rollback-manual-${nome}`);
  for (const sql of [migration, rollback]) {
    assertEquals(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  }
  const fase0 = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(fase0.recusado, false, JSON.stringify(fase0.motivos));
});

Deno.test("20261290: inventário automático inclui o companion pelo nome exato", async () => {
  const entradas = [...Deno.readDirSync(dir)].map((e) => e.name);
  assert(entradas.includes(nome));
  assert(entradas.includes(`rollback-manual-${nome}`));
  const rollbacks = entradas.filter(
    (n) => n.startsWith("rollback-manual-") && n.endsWith(".sql"),
  );
  const exatos = rollbacks.filter((n) =>
    entradas.includes(n.slice("rollback-manual-".length)),
  );
  const script = new URL(
    "../scripts/ci/banco/inventario-rollback.cjs",
    import.meta.url,
  );
  const { code, stdout } = await new Deno.Command("node", {
    args: [fileURLToPath(script), fileURLToPath(dir)],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(code, 0);
  assertStringIncludes(
    new TextDecoder().decode(stdout),
    `${rollbacks.length} rollbacks`,
  );
  assertStringIncludes(
    new TextDecoder().decode(stdout),
    `casamento exato: **${exatos.length}**`,
  );
});

const A59 = "59a-conferir-online-sem-forma-aplicado";
const B59 = "59b-antes-online-sem-forma-base-vigente";
const lerRel = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const md5DoCorpo = (sql: string) =>
  createHash("md5")
    .update(definicao(sql).split("AS $$")[1].split("$$;")[0])
    .digest("hex");
const rolDe = (rois: Record<string, string[]>, consulta: string) =>
  Object.entries(rois).find(([chave]) => chave === consulta)?.[1];

Deno.test("20261290 publicação: lote 59 próprio, sem backfill, vale para IKCOUS e Savy", () => {
  const canais = JSON.parse(lerRel("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter(
    (p: { versoes?: string[]; consulta?: string }) =>
      p.versoes?.includes("20261290000000") || p.consulta === A59,
  );
  assertEquals(lotes.length, 1, "a 290 precisa de prova própria");
  assertEquals(lotes[0].consulta, A59);
  assertEquals(lotes[0].versoes, ["20261290000000"]);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B59);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(
      Object.entries(lotes[0]).find(([chave]) => chave === campo)?.[1],
      undefined,
      campo,
    );
});

Deno.test("20261290 publicação: 59a exige o corpo da 290 e 59b o da 177, pelo md5 dos arquivos reais", () => {
  const rollback = ler(`rollback-manual-${nome}`);
  const novo = md5DoCorpo(migration);
  const velho = md5DoCorpo(anterior);
  assert(novo !== velho);
  assertEquals(md5DoCorpo(rollback), velho);
  for (const [consulta, exigido, proibido] of [
    [A59, novo, velho],
    [B59, velho, novo],
  ]) {
    const sql = lerRel(`scripts/publicacao/consultas/${consulta}.sql`);
    assertStringIncludes(sql, `'${exigido}'`);
    assertEquals(sql.includes(proibido), false, consulta);
    assertStringIncludes(sql, "md5(replace(p.prosrc, chr(13), ''))");
    assertStringIncludes(
      sql,
      "to_regprocedure('public.fin__forma_do_pedido(text,text)')",
    );
    assertStringIncludes(sql, "p.provolatile = 'i'");
    assertStringIncludes(sql, "NOT p.prosecdef");
    assertStringIncludes(sql, "ARRAY['search_path=public']::text[]");
    assertStringIncludes(sql, "COALESCE");
    assertStringIncludes(sql, "vivo = esperado AS ok");
  }
});

Deno.test("20261290 publicação: róis fechados, menu e gatilhos do CI registram os dois lados", async () => {
  const { ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado, contarStatements } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const workflow = lerRel(".github/workflows/rpc-ci.yml");
  for (const consulta of [A59, B59]) {
    const sql = lerRel(`scripts/publicacao/consultas/${consulta}.sql`);
    assertEquals(contarStatements(sql), 1, consulta);
    const itens = [...sql.matchAll(/\bSELECT '([^']+)'/g)].map((m) => m[1]);
    const rol = rolDe(ROL_FECHADO_POR_CONSULTA, consulta);
    assert(rol, `rol ausente: ${consulta}`);
    assertEquals(itens.length, 4);
    assertEquals([...rol].sort(), itens.sort());
    assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    const linhas = rol.map((item) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assertEquals(estruturaDoRolFechado(linhas, rol), null);
    for (const invalida of [
      linhas.slice(1),
      [...linhas.slice(1), linhas[1]],
      [...linhas, { ...linhas[0], item: "estranho" }],
    ])
      assert(estruturaDoRolFechado(invalida, rol) !== null);
    assertStringIncludes(
      lerRel(".github/workflows/conferir-banco-da-loja.yml"),
      `- ${consulta}\n`,
    );
    const caminho = `"scripts/publicacao/consultas/${consulta}.sql"`;
    assertEquals(workflow.split(caminho).length - 1, 2);
  }
  // O item do corpo é o ÚNICO que difere: a 59b nunca passa depois da 290.
  const rolA = rolDe(ROL_FECHADO_POR_CONSULTA, A59) ?? [];
  const rolB = rolDe(ROL_FECHADO_POR_CONSULTA, B59) ?? [];
  assertEquals(rolA.filter((i) => !rolB.includes(i)).length, 1);
});

// @ts-nocheck
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const nome =
  "20261270000000_pagamento_adiantado_e_estorno_antes_da_confirmacao.sql";
const A57 = "57a-conferir-pagamento-adiantado-e-estorno-aplicado";
const B57 = "57b-antes-pagamento-adiantado-e-estorno-base-vigente";
function ler(rel: string) {
  try {
    return Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
      /\r\n/g,
      "\n",
    );
  } catch {
    return "";
  }
}
const migration = () =>
  ler(`supabase/migrations/${nome}`).split("ROLLBACK_FIM */")[1];
const rollback = () => ler(`supabase/migrations/rollback-manual-${nome}`);
function corpo(sql: string, fn: string) {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert(inicio >= 0, `funcao ausente: ${fn}`);
  const trecho = sql.slice(inicio);
  const tag = trecho.match(/\bAS (\$[a-z_]*\$)/i)?.[1];
  assert(tag, "delimitador do corpo");
  return trecho.split(tag)[1];
}
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const original = (fn: string) => ler(`supabase/migrations/${fn}`);
const ANTIGOS = {
  concluir_estorno: [
    "2026110000100_concluir_estorno.sql",
    "662daf0dfc065a820231e9d30f4f6275",
  ],
  pagamentos_a_reconciliar: [
    "20261190000000_a_reconciliacao_alcanca_o_cartao_tardio.sql",
    "a8aae3c132cac141c27091a4e3648cf4",
  ],
};

Deno.test("20261270 rollback executavel: restaura os dois corpos byte a byte e recusa corpo vivo desconhecido", () => {
  const sql = rollback();
  assert(sql.length > 0, "rollback-manual executavel ausente");
  const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
  assertEquals(
    avaliarFase0({
      sqlMigration: migration(),
      sqlRollback: sql,
      temRollback: true,
    }).recusado,
    false,
  );
  for (const [fn, [arquivo, hash]] of Object.entries(ANTIGOS)) {
    assertEquals(corpo(sql, fn), corpo(original(arquivo), fn), fn);
    assertEquals(md5(corpo(sql, fn)), hash, fn);
    assertStringIncludes(sql, md5(corpo(migration(), fn)));
    assert(
      sql.indexOf("B1_BASELINE_DIVERGENT") <
        sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`),
    );
  }
  assertStringIncludes(sql, "md5(replace(prosrc, E'\\r', ''))");
  assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql));
  assert(!/^\s*(?:GRANT|REVOKE|DROP)\s+/im.test(sql));
});

Deno.test("20261270 comportamento documentado: estorno integral de pending nunca pago cancela, devolve estoque e grava paid_at", () => {
  const sql = migration();
  assert(!sql.includes("versão\n    -- antiga não idempotente"));
  assertStringIncludes(sql, "COMMENT ON FUNCTION public.concluir_estorno");
  assertStringIncludes(
    sql,
    "Estorno integral de pending nunca pago cancela, devolve estoque e grava paid_at.",
  );
  assertStringIncludes(
    ler("AGENTS.md"),
    "Estorno integral de pending nunca pago cancela, devolve estoque e grava paid_at.",
  );
  const antes = original("2026110000100_concluir_estorno.sql").match(
    /COMMENT ON FUNCTION public\.concluir_estorno[\s\S]*?;\n/,
  )?.[0];
  assert(antes);
  assertStringIncludes(rollback(), antes);
});

Deno.test("20261270 publicacao: lote unico de apply normal vale para IKCOUS e Savy", () => {
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter(
    (p) => p.versoes?.includes("20261270000000") || p.consulta === A57,
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].consulta, A57);
  assertEquals(lotes[0].versoes, ["20261270000000"]);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B57);
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
  for (const loja of ["IKCOUS", "Savy"])
    assert(
      Object.values(canais.canais).some((c) => c.nome === loja && c.migrations),
    );
});

Deno.test("20261270 publicacao: corpos exatos de antes/depois e dependencia da 20261241 impedem aplicar fora de ordem", () => {
  for (const [consulta, novo] of [
    [A57, true],
    [B57, false],
  ]) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    assert(sql.length > 0, consulta);
    for (const [fn, [arquivo]] of Object.entries(ANTIGOS))
      assertStringIncludes(
        sql,
        md5(corpo(novo ? migration() : original(arquivo), fn)),
      );
    // A 241 so pode entrar enquanto concluir_estorno ainda tem o corpo antigo.
    // Exigir os objetos novos e o saldo dela ANTES da 270 impede inverter a ordem.
    assertStringIncludes(sql, "public.order_refund__pode_ter_saido(uuid)");
    assertStringIncludes(sql, "bdbb28b3d91588c8b10283d57bfb73d6");
    assertStringIncludes(sql, "public.pedido__saldo_a_estornar(uuid)");
    assertStringIncludes(sql, "99741b4cdbf1e8d8340f80440e6da094");
    assertStringIncludes(sql, "to_regclass('public.order_refund_prova')");
    assertStringIncludes(sql, "COALESCE");
    assertStringIncludes(sql, "vivo = esperado AS ok");
  }
});

Deno.test("20261270 publicacao: rois fechados, menu e gatilhos do CI registram os dois lados", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA,
    estruturaDoRolFechado,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const workflow = ler(".github/workflows/rpc-ci.yml");
  for (const consulta of [A57, B57]) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    const itens = [...sql.matchAll(/\bSELECT '([^']+)'/g)].map((m) => m[1]);
    const rol = Object.entries(ROL_FECHADO_POR_CONSULTA).find(
      ([chave]) => chave === consulta,
    )?.[1];
    assert(rol, `rol ausente: ${consulta}`);
    assertEquals(itens.length, 5);
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
      ler(".github/workflows/conferir-banco-da-loja.yml"),
      `- ${consulta}\n`,
    );
    const caminho = `"scripts/publicacao/consultas/${consulta}.sql"`;
    assertEquals(workflow.split(caminho).length - 1, 2);
    for (const evento of ["pull_request", "push"]) {
      const bloco = workflow
        .split(`  ${evento}:`)[1]
        ?.split(/\n {2}[a-z_]+:|\n[a-z_]+:/)[0];
      assertStringIncludes(bloco, caminho);
    }
  }
});

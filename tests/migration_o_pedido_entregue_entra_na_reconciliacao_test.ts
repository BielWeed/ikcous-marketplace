// @ts-nocheck
// Prova estática da 20261349000000 (o pedido entregue antes da confirmação do PIX entra na fila de reconciliação).
// O comportamento e o rollback de verdade rodam no Postgres efêmero (tests/banco/reconciliacao-do-entregue-viva.cjs).
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const nome =
  "20261349000000_o_pedido_entregue_antes_da_confirmacao_entra_na_reconciliacao.sql";
const nome270 =
  "20261270000000_pagamento_adiantado_e_estorno_antes_da_confirmacao.sql";
const A80 = "80a-conferir-pedido-entregue-na-reconciliacao-aplicado";
const B80 = "80b-antes-pedido-entregue-na-reconciliacao-base-vigente";
const HASH_270 = "aed09ec910825168a3217b2e308824c5";
const HASH_NOVO = "350e732dbae6ba45bede77c08e0db6d8";
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
const migration = () => ler(`supabase/migrations/${nome}`);
const rollback = () => ler(`supabase/migrations/rollback-manual-${nome}`);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
/** O corpo da ÚLTIMA declaração de pagamentos_a_reconciliar do arquivo (entre os delimitadores). */
function corpo(sql: string) {
  const inicio = sql.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar(",
  );
  assert(inicio >= 0, "funcao ausente");
  const trecho = sql.slice(inicio);
  const tag = "$candidatos$";
  const partes = trecho.split(tag);
  assert(partes.length >= 3, "delimitador do corpo");
  return partes[1];
}
/** A declaração inteira (cabeça + corpo + fechamento). */
function declaracao(sql: string) {
  const inicio = sql.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar(",
  );
  const fim = sql.indexOf("$candidatos$;", inicio + 100);
  return sql.slice(inicio, fim + "$candidatos$;".length);
}

Deno.test("20261349 corpo: é o da 270 com SÓ 'delivered' nas duas listas (e dois comentários); os hashes do arquivo são os do corpo", () => {
  const antigo = corpo(ler(`supabase/migrations/${nome270}`));
  const novo = corpo(migration());
  assertEquals(md5(antigo), HASH_270);
  assertEquals(md5(novo), HASH_NOVO);
  const linhas = (s: string) => s.split("\n");
  const so = (s: string, f: (l: string) => boolean) => linhas(s).filter(f);
  const codigo = (l: string) => l.trim() !== "" && !l.trim().startsWith("--");
  // Mesmas linhas de código, exceto as duas que ganharam 'delivered'.
  const a = so(antigo, codigo).map((l) => l.replace(", 'delivered'", ""));
  const b = so(novo, codigo).map((l) => l.replace(", 'delivered'", ""));
  assertEquals(b, a);
  assertEquals((novo.match(/'delivered'/g) ?? []).length, 2);
  assertEquals((antigo.match(/'delivered'/g) ?? []).length, 0);
  assertEquals(
    so(novo, (l) => l.trim().startsWith("--")).length -
      so(antigo, (l) => l.trim().startsWith("--")).length,
    2,
  );
  // Declaração (assinatura, linguagem, SECURITY DEFINER, search_path): idêntica.
  assertEquals(
    declaracao(migration()).split("$candidatos$")[0],
    declaracao(ler(`supabase/migrations/${nome270}`)).split("$candidatos$")[0],
  );
  const sql = migration();
  assertEquals(
    sql.split(HASH_NOVO).length - 1 >= 3,
    true,
    "pré-voo, pós-voo e cabeçalho",
  );
  assertEquals(sql.split(HASH_270).length - 1 >= 2, true);
});

Deno.test("20261349 migration: aditiva, sem transação própria, sem GRANT/REVOKE/DROP/DELETE/UPDATE, pré-voo antes da troca, pós-voo e NOTIFY depois", () => {
  const sql = migration();
  assert(sql.length > 0, "migration ausente");
  const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
  assertEquals(
    avaliarFase0({
      sqlMigration: sql,
      sqlRollback: rollback(),
      temRollback: true,
    }).recusado,
    false,
  );
  assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql));
  assert(!/^\s*(?:GRANT|REVOKE|DROP|DELETE|TRUNCATE|ALTER)\s+/im.test(sql));
  assert(!/^\s*UPDATE\s+/im.test(sql), "nenhuma linha de dado é escrita");
  assert(!/^\s*INSERT\s+/im.test(sql));
  const pre = sql.indexOf("B1_BASELINE_DIVERGENT");
  const troca = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar",
  );
  const pos = sql.indexOf("POSVOO_20261349000000");
  const notify = sql.indexOf("NOTIFY pgrst, 'reload schema';");
  assert(pre >= 0 && pre < troca && troca < pos && pos < notify);
  assertEquals(
    (sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length,
    1,
    "uma única função",
  );
  assertStringIncludes(sql, "md5(replace(prosrc, E'\\r', ''))");
  // O pré-voo aceita exatamente DOIS corpos: o da 270 e o desta migration.
  assertStringIncludes(
    sql,
    `v_hash IS DISTINCT FROM '${HASH_270}' AND v_hash IS DISTINCT FROM '${HASH_NOVO}'`,
  );
  assertStringIncludes(sql, "ARRAY['search_path=public']");
  assertStringIncludes(sql, "has_function_privilege('anon'");
  assertStringIncludes(sql, "has_function_privilege('authenticated'");
  assertStringIncludes(sql, "has_function_privilege('service_role'");
});

Deno.test("20261349 rollback executavel: devolve o corpo da 270 byte a byte, recusa corpo desconhecido/já desfeito e termina com NOTIFY", () => {
  const sql = rollback();
  assert(sql.length > 0, "rollback-manual executavel ausente");
  const antigo = corpo(ler(`supabase/migrations/${nome270}`));
  assertEquals(corpo(sql), antigo, "byte a byte");
  assertEquals(md5(corpo(sql)), HASH_270);
  assertEquals(
    declaracao(sql),
    declaracao(ler(`supabase/migrations/${nome270}`)),
    "a declaração inteira é a da 270",
  );
  assertStringIncludes(sql, `v_hash IS DISTINCT FROM '${HASH_NOVO}'`);
  assert(
    sql.indexOf("B1_BASELINE_DIVERGENT") <
      sql.indexOf("CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar"),
    "pré-voo antes da troca",
  );
  assertStringIncludes(sql, `v_hash IS DISTINCT FROM '${HASH_270}'`); // o pós-voo do rollback
  assertStringIncludes(sql, "POSVOO_ROLLBACK_20261349000000");
  assertStringIncludes(sql, "md5(replace(prosrc, E'\\r', ''))");
  assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql));
  assert(!/^\s*(?:GRANT|REVOKE|DROP)\s+/im.test(sql));
  assert(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
});

Deno.test("20261349 publicacao: lote unico de apply normal, DEPOIS da 270, vale para IKCOUS e Savy", () => {
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter(
    (p) => p.versoes?.includes("20261349000000") || p.consulta === A80,
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].consulta, A80);
  assertEquals(lotes[0].versoes, ["20261349000000"]);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B80);
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
  // A ordem das versões: a 349 vem DEPOIS da 270 na lista de lotes.
  const versoes = canais.provasDeObjetos.flatMap((p) => p.versoes ?? []);
  assert(versoes.indexOf("20261270000000") < versoes.indexOf("20261349000000"));
  for (const loja of ["IKCOUS", "Savy"])
    assert(
      Object.values(canais.canais).some((c) => c.nome === loja && c.migrations),
    );
});

Deno.test("20261349 publicacao: as consultas 80a/80b trazem o corpo certo de cada lado e a 57a aceita o corpo novo como sucessor", () => {
  for (const [consulta, hash, entregues] of [
    [A80, HASH_NOVO, "'2'"],
    [B80, HASH_270, "'0'"],
  ]) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    assert(sql.length > 0, consulta);
    assertStringIncludes(sql, `'${hash}'`);
    assertStringIncludes(sql, entregues);
    assertStringIncludes(sql, "COALESCE");
    assertStringIncludes(sql, "vivo = esperado AS ok");
    assertStringIncludes(sql, "'''delivered'''");
    assert(
      !/marketplace_orders|order_refunds/.test(sql),
      "so catalogo: nao le pedido",
    );
  }
  const a57 = ler(
    "scripts/publicacao/consultas/57a-conferir-pagamento-adiantado-e-estorno-aplicado.sql",
  );
  assertStringIncludes(a57, `m IN ('${HASH_270}', '${HASH_NOVO}')`);
  // A 57b (ANTES da 270) NÃO aceita o corpo novo: ele não pode ser a base da 270.
  const b57 = ler(
    "scripts/publicacao/consultas/57b-antes-pagamento-adiantado-e-estorno-base-vigente.sql",
  );
  assert(!b57.includes(HASH_NOVO));
});

Deno.test("20261349 publicacao: rois fechados, menu e gatilhos do CI registram os dois lados", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA,
    estruturaDoRolFechado,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const workflow = ler(".github/workflows/rpc-ci.yml");
  for (const consulta of [A80, B80]) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    const itens = [...sql.matchAll(/\bSELECT '([^']+)'/g)].map((m) => m[1]);
    const rol = Object.entries(ROL_FECHADO_POR_CONSULTA).find(
      ([chave]) => chave === consulta,
    )?.[1];
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

Deno.test("20261349 prova viva: registrada no rpc-ci, na lista do dinheiro e no LEIA-ME; a fila alcança o entregue nas provas de pagamentos", () => {
  const prova = "tests/banco/reconciliacao-do-entregue-viva.cjs";
  const workflow = ler(".github/workflows/rpc-ci.yml");
  assertEquals(workflow.split(prova).length - 1, 1);
  assertStringIncludes(
    ler("tests/migration_a_contestacao_decide_sob_a_trava_do_pedido_test.ts"),
    `"${prova}"`,
  );
  assertStringIncludes(
    ler("tests/banco/LEIA-ME.md"),
    "reconciliacao-do-entregue-viva.cjs",
  );
  const pagamentos = ler("tests/banco/pagamentos-rpc-viva.cjs");
  assertStringIncludes(pagamentos, '["processing", "shipping", "delivered"]');
  assertStringIncludes(pagamentos, "(A3c)");
  assertStringIncludes(
    pagamentos,
    "await desfazerReconciliacaoDoEntregueNaTransacao(c);",
  );
});

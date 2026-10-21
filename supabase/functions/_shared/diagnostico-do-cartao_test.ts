// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { registrarDiagnosticoDoCartao } from "./diagnostico-do-cartao.ts";

const pedidoId = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
function order(status = "failed", detalhe = "cc_rejected_high_risk") {
  return { id: "ORDTESTE", status, status_detail: status, total_amount: "37.27",
    payer: { email: "nao-gravar@example.invalid" },
    transactions: { payments: [{
      id: "PAYTESTE", status, status_detail: detalhe, amount: "37.27",
      payment_method: { type: "credit_card", installments: 2, token: "token-que-nao-pode-sair" },
    }] } };
}
function armazenamento() {
  const linhas = new Map();
  const chamadas = [];
  return {
    linhas, chamadas,
    supabase: { from: (tabela) => ({ upsert: async (linha, opcoes) => {
      assertEquals(tabela, "tentativas_cartao_diagnostico");
      assertEquals(opcoes.onConflict, "mp_order_id,mp_payment_id");
      chamadas.push({ linha, opcoes });
      const chave = linha.mp_order_id + ":" + linha.mp_payment_id;
      if (!opcoes.ignoreDuplicates || !linhas.has(chave)) linhas.set(chave, linha);
      return { error: null };
    } }) },
  };
}
Deno.test("D4: repetição e análise atrasada preservam o motivo final; nova tentativa mantém linha própria", async () => {
  const db = armazenamento();
  const gravar = (o) => registrarDiagnosticoDoCartao({ supabase: db.supabase, pedidoId, order: o });
  await gravar(order("processing", "pending_review_manual"));
  await gravar(order());
  await gravar(order());
  await gravar(order("processing", "pending_review_manual"));
  assertEquals(db.linhas.size, 1);
  assertEquals(db.linhas.get("ORDTESTE:PAYTESTE").status_detail, "cc_rejected_high_risk");
  const nova = order();
  nova.id = "ORDNOVA";
  await gravar(nova);
  assertEquals(db.linhas.size, 2);
  assertEquals(db.chamadas.map((c) => c.opcoes.ignoreDuplicates), [true, false, false, true, false]);
  assertEquals(Object.keys(db.chamadas[0].linha).sort(),
    ["pedido_id", "mp_order_id", "mp_payment_id", "status", "status_detail", "parcelas", "valor", "registrado_em"].sort());
});
Deno.test("D4: Pix/aprovado/corpo ilegível não entram; detalhe livre não persiste", async () => {
  const db = armazenamento();
  const pix = order();
  pix.transactions.payments[0].payment_method.type = "bank_transfer";
  for (const o of [pix, order("processed", "accredited"), null, {}, { transactions: { payments: {} } }]) {
    await registrarDiagnosticoDoCartao({ supabase: db.supabase, pedidoId, order: o });
  }
  assertEquals(db.chamadas.length, 0);
  await registrarDiagnosticoDoCartao({ supabase: db.supabase, pedidoId, order: order("failed", "nao-gravar@example.invalid") });
  assertEquals(db.chamadas[0].linha.status_detail, "failed");
});
Deno.test("D4: banco que não responde não prende o pagamento", async () => {
  let timer;
  try {
    const terminou = await Promise.race([
      registrarDiagnosticoDoCartao({
        pedidoId, order: order(),
        supabase: { from: () => ({ upsert: () => new Promise(() => {}) }) },
      }).then(() => true),
      new Promise((r) => { timer = setTimeout(() => r(false), 2300); }),
    ]);
    assertEquals(terminou, true);
  } finally { clearTimeout(timer); }
});

Deno.test("D4: falha retornada ou lançada nunca rejeita e não aparece no log", async () => {
  const logs = [];
  const original = console.warn;
  console.warn = (...v) => logs.push(v);
  try {
    for (const falha of ["retorna", "lanca"]) {
      await registrarDiagnosticoDoCartao({
        pedidoId, order: order(),
        supabase: { from: () => ({ upsert: async () => {
          if (falha === "lanca") throw new Error("nao-gravar@example.invalid");
          return { error: { message: "nao-gravar@example.invalid" } };
        } }) },
      });
    }
    assertEquals(logs.length, 2);
    assertEquals(JSON.stringify(logs).includes("nao-gravar"), false);
  } finally { console.warn = original; }
});

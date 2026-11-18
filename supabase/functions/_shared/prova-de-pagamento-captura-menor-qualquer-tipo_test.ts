// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { conferirValorDoPagamento } from "./prova-de-pagamento.ts";

// Fixtures inventadas. Sem a guarda geral, captura parcial passa fora dos cartões.
const DIVERGENTE = { provado: false, motivo: "valor_divergente" };
const TIPOS = [
  ["sem type", {}],
  ["sem payment_method", undefined],
  ["null", { type: null }],
  ["account_money", { type: "account_money" }],
  ["wallet", { type: "wallet" }],
  ["CREDIT_CARD", { type: "CREDIT_CARD" }],
  ["bank_transfer", { type: "bank_transfer" }],
];

function order(pago, metodo, total = "100.00") {
  const pagamento = { amount: total, payment_method: metodo };
  const o = { total_amount: total, transactions: { payments: [pagamento] } };
  if (pago !== undefined) o.total_paid_amount = pago;
  return o;
}

for (const [tipo, metodo] of TIPOS) {
  for (const [pago, esperado] of [
    ["100.00", true], ["99.99", true], ["99.95", true],
    ["99.94", false], ["60.00", false], ["0.01", false],
  ]) {
    Deno.test(`captura qualquer tipo: ${tipo}, recebido ${pago} de 100,00`, () => {
      const o = order(pago, metodo);
      if (tipo === "sem payment_method") delete o.transactions.payments[0].payment_method;
      assertEquals(conferirValorDoPagamento(100, 100, o),
        esperado ? { provado: true, valor: 100, total: 100 } : DIVERGENTE);
    });
  }

  Deno.test(`captura qualquer tipo: ${tipo}, centavos de 59,75`, () => {
    assertEquals(conferirValorDoPagamento(59.75, 59.75, order("59.70", metodo, "59.75")).provado, true);
    assertEquals(conferirValorDoPagamento(59.75, 59.75, order("59.69", metodo, "59.75")), DIVERGENTE);
  });

  Deno.test(`captura qualquer tipo: ${tipo}, raiz manda e pagamento é fallback`, () => {
    const o = order(undefined, metodo);
    o.transactions.payments[0].paid_amount = "60.00";
    assertEquals(conferirValorDoPagamento(100, 100, o), DIVERGENTE);
    o.total_paid_amount = "100.00";
    assertEquals(conferirValorDoPagamento(100, 100, o).provado, true);
  });

  Deno.test(`captura qualquer tipo: ${tipo}, ausência e ilegível não ganham nova recusa`, () => {
    assertEquals(conferirValorDoPagamento(100, 100, order(undefined, metodo)).provado, true);
    assertEquals(conferirValorDoPagamento(100, 100, order("ilegivel", metodo)).provado, true);
  });
}

for (const [tipo, parcelas, pago, porParcela, esperado] of [
  ["bank_transfer", 1, "112.40", undefined, true],
  ["credit_card", 2, "112.40", "56.20", true],
  ["credit_card", 2, "150.00", undefined, true],
  ["credit_card", 2, "150.01", undefined, false],
  ["credit_card", 2, "99.99", undefined, false],
  ["credit_card", 1, "100.06", undefined, false],
]) {
  Deno.test(`captura qualquer tipo: controle ${tipo} ${parcelas}x ${pago}`, () => {
    assertEquals(conferirValorDoPagamento(100, 100, order(pago, {
      type: tipo, installments: parcelas, installment_amount: porParcela,
    })).provado, esperado);
  });
}

Deno.test("captura qualquer tipo: clássico sem order continua provando 100", () => {
  assertEquals(conferirValorDoPagamento(100, 100), { provado: true, valor: 100, total: 100 });
});

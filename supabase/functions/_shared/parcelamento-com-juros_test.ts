// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { conferirValorDoPagamento, provarPagamentoPelaConsulta } from "./prova-de-pagamento.ts";

const pedidoId = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const id = "ORDPARCELADO";
function order(total = "40.86", pago = "40.86", parcelas = 2, parcela = "20.43", tipo = "credit_card") {
  return {
    id, external_reference: pedidoId, status: "processed", status_detail: "accredited",
    total_amount: total, total_paid_amount: pago,
    transactions: { payments: [{
      id: "PAYPARCELADO", amount: total, paid_amount: pago, status: "processed", status_detail: "accredited",
      payment_method: { type: tipo, installments: parcelas, installment_amount: parcela },
    }] },
  };
}
function prova(o) {
  return provarPagamentoPelaConsulta({
    origem: "get_por_id", idConsultado: id, vagaRelida: id, pedidoId, totalRelido: 37.27, order: o,
  });
}

for (const principal of ["37.27", "40.86"]) {
  for (const parcela of [null, "18.64", "20.43"]) {
    Deno.test(`R1: principal ${principal}, captura 40,86, parcela ${parcela ?? "ausente"}`, () => {
      const o = order(principal);
      if (parcela === null) delete o.transactions.payments[0].payment_method.installment_amount;
      else o.transactions.payments[0].payment_method.installment_amount = parcela;
      const esperado = principal === "37.27" || parcela === "20.43";
      assertEquals(prova(o).provado, esperado);
      assertEquals(conferirValorDoPagamento(Number(principal), 37.27, o).provado, esperado);
    });
  }
}
Deno.test("R1: sem parcela, teto 55,90 aceita e 55,91 recusa; captura menor nunca confirma", () => {
  for (const [captura, esperado] of [["55.90", true], ["55.91", false], ["37.26", false]]) {
    const o = order("37.27", captura);
    delete o.transactions.payments[0].payment_method.installment_amount;
    assertEquals(prova(o).provado, esperado);
  }
});

Deno.test("D7: total da order já com juros, 2 x 20,43 para pedido 37,27, confirma", () => {
  assertEquals(prova(order()), { provado: true, valor: 40.86, valorPago: 40.86 });
  assertEquals(conferirValorDoPagamento(40.86, 37.27, order()).provado, true);
});
Deno.test("D7: principal sem juros e captura com juros também confirma", () => {
  assertEquals(prova(order("37.27")), { provado: true, valor: 37.27, valorPago: 40.86 });
});
Deno.test("D7: excedente exige crédito parcelado e valor de parcela coerente", () => {
  for (const o of [
    order("40.86", "40.86", 1), order("40.86", "40.86", 2, "20.43", "bank_transfer"),
    order("40.86", "40.86", 2, "19.00"),
    order("40.86", "40.86", 13), order("40.86", "40.86", "2"),
  ]) {
    assertEquals(prova(o).provado, false, JSON.stringify(o));
  }
  const semParcela = order();
  delete semParcela.transactions.payments[0].payment_method.installment_amount;
  assertEquals(prova(semParcela).provado, false);
});
Deno.test("D7: juros acima de 50% não confirmam, nem com principal sem juros", () => {
  for (const total of ["37.27", "60.00"]) {
    assertEquals(prova(order(total, "60.00", 2, "30.00")).provado, false);
  }
});
Deno.test("D7: o teto de 50% e a soma das parcelas usam centavos", () => {
  assertEquals(conferirValorDoPagamento(55.9, 37.27, order("55.90", "55.90", 2, "27.95")).provado, true);
  assertEquals(conferirValorDoPagamento(55.91, 37.27, order("55.91", "55.91", 2, "27.96")).provado, false);
});
Deno.test("D7: parcelado menor que o pedido nunca confirma, mesmo um centavo", () => {
  assertEquals(prova(order("37.27", "37.26", 2, "18.63")).provado, false);
  assertEquals(conferirValorDoPagamento(37.26, 37.27, order("37.26", "37.26", 2, "18.63")).provado, false);
});
Deno.test("REV6: principal parcelado 37,23 sem captura não prova pedido de 37,27, mesmo dentro da folga", () => {
  const o = order("37.23");
  delete o.total_paid_amount;
  delete o.transactions.payments[0].paid_amount;
  assertEquals(conferirValorDoPagamento(37.23, 37.27, o), { provado: false, motivo: "valor_divergente" });
  assertEquals(prova(o), { provado: false, motivo: "valor_divergente" });
});

Deno.test("D7: captura excessiva à vista não passa nem com principal exato; Pix mantém o contrato anterior", () => {
  for (const tipo of ["credit_card", "debit_card"]) {
    assertEquals(conferirValorDoPagamento(37.27, 37.27, order("37.27", "40.86", 1, "40.86", tipo)).provado, false);
  }
  assertEquals(conferirValorDoPagamento(37.27, 37.27, order("37.27", "40.86", 2, "20.43", "bank_transfer")).provado, true);
});

Deno.test("D7: à vista e Pix preservam a conferência anterior, sem liberação de excedente", () => {
  assertEquals(conferirValorDoPagamento(40.86, 37.27).provado, false);
  assertEquals(conferirValorDoPagamento(37.23, 37.27).provado, true);
  assertEquals(conferirValorDoPagamento(37.21, 37.27).provado, false);
});

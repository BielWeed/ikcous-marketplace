// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { conferirValorDoPagamento, provarPagamentoPelaConsulta } from "./prova-de-pagamento.ts";

// Cartão parcelado SEM juros ("3x sem juros" da loja de moda): o Mercado Pago
// captura exatamente o total do pedido. `parcelamento-com-juros_test.ts` cobre
// o parcelado COM juros e o pago MENOR que o total, mas nenhum caso tinha
// pago == total com mais de uma parcela. Trocar o `<` por `<=` na régua do
// valor capturado fazia todo pagamento assim ser recusado como "valor
// divergente": a cliente pagava, o pedido expirava em 30 min e o estoque voltava.

const pedidoId = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const id = "ORDSEMJUROS";

function order(total, pago, parcelas, parcela, tipo = "credit_card") {
  return {
    id, external_reference: pedidoId, status: "processed", status_detail: "accredited",
    total_amount: total, total_paid_amount: pago,
    transactions: { payments: [{
      id: "PAYSEMJUROS", amount: total, paid_amount: pago, status: "processed", status_detail: "accredited",
      payment_method: { type: tipo, installments: parcelas, installment_amount: parcela },
    }] },
  };
}
function prova(o, totalDoPedido = 37.27) {
  return provarPagamentoPelaConsulta({
    origem: "get_por_id", idConsultado: id, vagaRelida: id, pedidoId, totalRelido: totalDoPedido, order: o,
  });
}

Deno.test("3x sem juros: captura igual ao total do pedido confirma", () => {
  const o = order("37.27", "37.27", 3, "12.42");
  assertEquals(prova(o), { provado: true, valor: 37.27, valorPago: 37.27 });
  assertEquals(conferirValorDoPagamento(37.27, 37.27, o).provado, true);
});

Deno.test("sem juros confirma em 2, 3, 6 e 12 parcelas", () => {
  for (const parcelas of [2, 3, 6, 12]) {
    const o = order("37.27", "37.27", parcelas, "3.11");
    assertEquals(prova(o).provado, true, `${parcelas}x`);
  }
});

Deno.test("sem juros: um centavo a menos que o total nunca confirma (a fronteira fica do lado certo)", () => {
  const o = order("37.27", "37.26", 3, "12.42");
  assertEquals(prova(o), { provado: false, motivo: "valor_divergente" });
  assertEquals(conferirValorDoPagamento(37.26, 37.27, o).provado, false);
});

// A soma das parcelas só pode diferir da captura em até (parcelas - 1) centavos,
// um por parcela de arredondamento. Exatamente `parcelas` centavos já é recusa:
// a folga não pode ser aumentada para `parcelas + 1`.
Deno.test("com juros: soma das parcelas diferindo EXATAMENTE em `parcelas` centavos recusa", () => {
  // 2x, captura 40,86: 20,44 x 2 = 40,88 -> diferença de 2 centavos (= parcelas).
  const duas = order("40.86", "40.86", 2, "20.44");
  assertEquals(prova(duas).provado, false);
  assertEquals(conferirValorDoPagamento(40.86, 37.27, duas).provado, false);
  // 3x, captura 40,86: 13,63 x 3 = 40,89 -> diferença de 3 centavos (= parcelas).
  const tres = order("40.86", "40.86", 3, "13.63");
  assertEquals(prova(tres).provado, false);
  assertEquals(conferirValorDoPagamento(40.86, 37.27, tres).provado, false);
});

Deno.test("com juros: soma das parcelas diferindo em `parcelas - 1` centavos (arredondamento) ainda confirma", () => {
  // 3x, captura 40,87: 13,63 x 3 = 40,89 -> diferença de 2 centavos (= parcelas - 1).
  const tres = order("40.87", "40.87", 3, "13.63");
  assertEquals(prova(tres).provado, true);
  // 2x, captura 40,87: 20,43 x 2 = 40,86 -> diferença de 1 centavo (= parcelas - 1).
  const duas = order("40.87", "40.87", 2, "20.43");
  assertEquals(prova(duas).provado, true);
});

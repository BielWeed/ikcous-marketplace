// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { provarPagamentoPelaConsulta } from "./prova-de-pagamento.ts";

// O último ramo de `provarPagamentoPelaConsulta` é o de quem não é PIX
// (bank_transfer) nem cartão: se o Mercado Pago mandar outro
// `payment_method.type`, a captura é conferida pela mesma régua do valor.
// Nenhum caso usava esse ramo, então tirar o `!` da condição (recusar o certo e
// aceitar o errado) passava em toda a suíte: uma captura PARCIAL de um tipo
// desconhecido seria provada como paga.

const pedidoId = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const id = "ORDTIPODESCONHECIDO";

function order(pago, tipo) {
  return {
    id, external_reference: pedidoId, status: "processed", status_detail: "accredited",
    total_amount: "37.27", total_paid_amount: pago,
    transactions: { payments: [{
      id: "PAYTIPO", amount: "37.27", paid_amount: pago, status: "processed", status_detail: "accredited",
      payment_method: { type: tipo, installments: 1, installment_amount: "37.27" },
    }] },
  };
}
const prova = (o) =>
  provarPagamentoPelaConsulta({
    origem: "get_por_id", idConsultado: id, vagaRelida: id, pedidoId, totalRelido: 37.27, order: o,
  });

Deno.test("tipo desconhecido com captura PARCIAL (10,00 de 37,27) recusa por valor pago", () => {
  assertEquals(prova(order("10.00", "account_money")), { provado: false, motivo: "valor_pago" });
});

Deno.test("tipo desconhecido com captura inteira confirma", () => {
  assertEquals(prova(order("37.27", "account_money")), { provado: true, valor: 37.27, valorPago: 37.27 });
});

// A régua tem a folga de 5 centavos (TOLERANCIA_DE_VALOR) para os dois lados.
Deno.test("tipo desconhecido: a fronteira de 5 centavos fica no lugar certo", () => {
  assertEquals(prova(order("37.22", "account_money")).provado, true);
  assertEquals(prova(order("37.21", "account_money")), { provado: false, motivo: "valor_pago" });
  assertEquals(prova(order("37.32", "account_money")).provado, true);
  assertEquals(prova(order("37.33", "account_money")), { provado: false, motivo: "valor_pago" });
});

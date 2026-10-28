// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { provarPagamentoPelaConsulta } from "./prova-de-pagamento.ts";

// Regra escrita em `temRegistro` (prova-de-pagamento.ts): estorno ou contestação
// que chega em FORMATO DESCONHECIDO (objeto no lugar de lista) nunca é "nada" —
// recusa. Lista VAZIA é "nada" — não recusa. Nenhuma fixture trazia `refunds`
// como objeto nem como lista vazia, então:
//  - trocar `!Array.isArray` por `Array.isArray` deixava um pagamento com
//    estorno/contestação ser provado como pago (falha ABERTA);
//  - trocar `length > 0` por `length >= 0` fazia `refunds: []` bloquear toda
//    confirmação por prova (falha FECHADA: nenhum pagamento seria confirmado).

const pedidoId = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const id = "ORDESTORNO";

function order({ naRaiz = {}, naTransacao = {}, noPagamento = {} } = {}) {
  return {
    id, external_reference: pedidoId, status: "processed", status_detail: "accredited",
    total_amount: "37.27", total_paid_amount: "37.27", ...naRaiz,
    transactions: {
      ...naTransacao,
      payments: [{
        id: "PAYESTORNO", amount: "37.27", paid_amount: "37.27",
        status: "processed", status_detail: "accredited",
        payment_method: { type: "credit_card", installments: 1, installment_amount: "37.27" },
        ...noPagamento,
      }],
    },
  };
}
const prova = (o) =>
  provarPagamentoPelaConsulta({
    origem: "get_por_id", idConsultado: id, vagaRelida: id, pedidoId, totalRelido: 37.27, order: o,
  });

Deno.test("controle: order aprovada sem nenhum campo de estorno ou contestação confirma", () => {
  assertEquals(prova(order()), { provado: true, valor: 37.27, valorPago: 37.27 });
});

const LUGARES = [
  ["na raiz da order", (campo, valor) => order({ naRaiz: { [campo]: valor } })],
  ["dentro de transactions", (campo, valor) => order({ naTransacao: { [campo]: valor } })],
  ["dentro do pagamento", (campo, valor) => order({ noPagamento: { [campo]: valor } })],
];
const CAMPOS = [["refunds", "estorno"], ["chargebacks", "chargeback"]];

for (const [campo, motivo] of CAMPOS) {
  for (const [onde, montar] of LUGARES) {
    Deno.test(`${campo} como OBJETO (formato desconhecido) ${onde} recusa por ${motivo}`, () => {
      assertEquals(prova(montar(campo, { id: "X1" })), { provado: false, motivo });
    });
    Deno.test(`${campo} como LISTA com item ${onde} recusa por ${motivo}`, () => {
      assertEquals(prova(montar(campo, [{ id: "X1" }])), { provado: false, motivo });
    });
    Deno.test(`${campo} como LISTA VAZIA ${onde} não recusa`, () => {
      assertEquals(prova(montar(campo, [])).provado, true);
    });
  }
}

// @ts-nocheck
/**
 * Caça por mutação (25/11/2026, segunda rodada) em `prova-de-pagamento.ts`, a porta
 * do dinheiro. Depois da varredura de centavos (`_centavos_test`), ainda sobreviviam
 * defeitos de UMA linha — todos em caminhos que a varredura não percorre:
 *
 *   * CARTÃO À VISTA (1x) cujo principal da order é MENOR que o total do pedido e cuja
 *     captura é igual ao total: não existe "juros" numa parcela só, então o valor
 *     diverge e NÃO prova (um `parcelas <= 1` virando `< 1` aprovaria R$ 90 de
 *     principal contra um pedido de R$ 100);
 *   * a captura PIX no limite exato da tolerância (total − R$ 0,05) em TODOS os centavos
 *     de R$ 0,06 a R$ 15 — onde o ruído de ponto flutuante (`8.20 * 100 =
 *     819.9999999999999`) faria um `Math.round` virar `Math.floor` recusar quem pagou
 *     exatamente o aceitável — pela porta COMPLETA `provarPagamentoPelaConsulta`;
 *   * captura de exatamente R$ 1,00 e de R$ 0,50 (um `> 0` virando `> 1` recusaria);
 *   * o estorno integral financiado: devolução com id NUMÉRICO e devolução de UM
 *     centavo contam (um `<= 0` virando `<= 1` jogaria fora o centavo).
 *
 * Valores escritos à mão ou varridos contra aritmética de INTEIROS (centavos), nunca
 * pela fórmula do código; fixtures inventadas.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  conferirValorDoPagamento,
  estornoIntegralComJurosComprovado,
  provarPagamentoPelaConsulta,
} from "./prova-de-pagamento.ts";
import { orderPixPagaDaDoc } from "./prova-de-pagamento_fixtures.ts";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const VAGA = "ORD01JS2V6CM8KJ0EC4H502TGK1WP";

/** Cartão pelo site, 1x, com principal, captura e parcela escolhidos à mão. */
function cartaoAVista(principal: string, capturado: string, parcela: string) {
  return {
    total_amount: principal,
    total_paid_amount: capturado,
    transactions: {
      payments: [{
        payment_method: { type: "credit_card", installments: 1, installment_amount: parcela },
      }],
    },
  };
}

// ─── cartão à vista: não existe juros em UMA parcela ─────────────────────────

Deno.test("cartão à vista (1x) com principal R$ 90 e captura R$ 100 contra pedido de R$ 100: NÃO prova (valor_divergente)", () => {
  const order = cartaoAVista("90.00", "100.00", "100.00");
  assertEquals(conferirValorDoPagamento(90, 100, order), { provado: false, motivo: "valor_divergente" });
});

Deno.test("cartão à vista (1x) com principal e captura iguais ao pedido continua provando (controle)", () => {
  const order = cartaoAVista("100.00", "100.00", "100.00");
  assertEquals(conferirValorDoPagamento(100, 100, order), { provado: true, valor: 100, total: 100 });
});

// ─── PIX: a captura no limite da tolerância, pela porta completa ─────────────

function pixComCaptura(totalReais: string, capturaReais: string) {
  const order = orderPixPagaDaDoc({ id: VAGA, externalReference: PEDIDO, valor: totalReais });
  order.total_paid_amount = capturaReais;
  order.transactions.payments[0].paid_amount = capturaReais;
  return order;
}

function provar(order: Record<string, unknown>, totalDoPedido: number) {
  return provarPagamentoPelaConsulta({
    origem: "get_por_id",
    idConsultado: VAGA,
    vagaRelida: VAGA,
    pedidoId: PEDIDO,
    totalRelido: totalDoPedido,
    order,
  });
}

Deno.test("PIX pela porta completa: captura 5 centavos abaixo do total PROVA e 6 abaixo recusa, em todo total de R$ 0,06 a R$ 15", () => {
  for (let t = 6; t <= 1500; t++) {
    const total = (t / 100).toFixed(2);
    const noLimite = ((t - 5) / 100).toFixed(2);
    const alemDoLimite = ((t - 6) / 100).toFixed(2);

    const aceita = provar(pixComCaptura(total, noLimite), Number(total));
    assertEquals(aceita.provado, true, `total=${total} captura=${noLimite}`);
    assertEquals(aceita.valorPago, Number(noLimite), `total=${total} captura=${noLimite}`);

    if (t - 6 > 0) {
      const recusada = provar(pixComCaptura(total, alemDoLimite), Number(total));
      assertEquals(recusada.provado, false, `total=${total} captura=${alemDoLimite}`);
    }
  }
});

Deno.test("PIX pela porta completa: captura de R$ 1,00 e de R$ 0,50 (pedidos desse valor) provam; captura zero recusa", () => {
  assertEquals(provar(pixComCaptura("1.00", "1.00"), 1), { provado: true, valor: 1, valorPago: 1 });
  assertEquals(provar(pixComCaptura("0.50", "0.50"), 0.5), { provado: true, valor: 0.5, valorPago: 0.5 });
  assertEquals(provar(pixComCaptura("100.00", "0.00"), 100).provado, false);
});

// ─── estorno integral financiado: o id numérico e o centavo ──────────────────

function cartaoParcelado3x() {
  return {
    total_amount: "10.00",
    total_paid_amount: "11.00",
    transactions: {
      payments: [{
        payment_method: { type: "credit_card", installments: 3, installment_amount: "3.67" },
      }],
    },
  };
}

Deno.test("estorno integral financiado: devolução com id NUMÉRICO conta (10,99 + 0,01 = 11,00 capturados)", () => {
  const refunds = [
    { id: 7001, amount: "10.99", status: "processed" },
    { id: 7002, amount: "0.01", status: "processed" },
  ];
  assertEquals(estornoIntegralComJurosComprovado(cartaoParcelado3x(), 10, refunds, "processed"), true);
});

Deno.test("estorno integral financiado: a devolução de UM centavo conta; sem ela a soma fica um centavo curta e recusa", () => {
  const completo = [
    { id: "R1", amount: "10.99", status: "processed" },
    { id: "R2", amount: "0.01", status: "processed" },
  ];
  assertEquals(estornoIntegralComJurosComprovado(cartaoParcelado3x(), 10, completo, "processed"), true);
  assertEquals(estornoIntegralComJurosComprovado(cartaoParcelado3x(), 10, [completo[0]], "processed"), false);
});

Deno.test("estorno integral financiado: id que não é texto nem número (objeto, ausente) contamina o conjunto", () => {
  const completo = [{ id: "R1", amount: "10.99", status: "processed" }];
  for (const idRuim of [undefined, null, {}, true]) {
    const refunds = [...completo, { id: idRuim, amount: "0.01", status: "processed" }];
    assertEquals(
      estornoIntegralComJurosComprovado(cartaoParcelado3x(), 10, refunds, "processed"),
      false,
      JSON.stringify(idRuim) ?? "undefined",
    );
  }
});

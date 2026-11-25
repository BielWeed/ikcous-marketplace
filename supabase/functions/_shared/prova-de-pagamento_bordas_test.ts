// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `prova-de-pagamento.ts` — a régua que decide
 * se a consulta ao Mercado Pago PROVA que o pedido foi pago (o falso SIM entrega
 * produto de graça). 31 mutantes plantados contra as seis suítes de
 * `prova-de-pagamento*_test.ts`; 7 sobreviviam, 5 são equivalentes (o teto de
 * 1,5x que `jurosCompativeis` repete e o bloco de cartão já impõe; `porParcela <= 0`
 * e `pago < total`, que a captura menor já recusa; `parcelas <= 1`; `pago === null`)
 * e 2 mudavam a resposta:
 *
 *   * "juros" (pago acima do pedido) só vale para CARTÃO DE CRÉDITO: uma order de
 *     PIX (`bank_transfer`) que traga parcelas e valor de parcela NÃO ganha a
 *     exceção — antes bastava mandar `installments: 2` para um PIX de R$ 112,40 ser
 *     "provado" contra um pedido de R$ 100,00;
 *   * a captura só é lida de um pagamento ÚNICO: com dois pagamentos na order, o
 *     `paid_amount` do primeiro não é "o valor capturado" (era a leitura da
 *     captura de OUTRA tentativa).
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { conferirValorDoPagamento, provarPagamentoPelaConsulta } from "./prova-de-pagamento.ts";
import { orderCartaoAprovadaDaDoc, orderPixPagaDaDoc } from "./prova-de-pagamento_fixtures.ts";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const VAGA = "ORD01JS2V6CM8KJ0EC4H502TGK1WP";

const base = (order: Record<string, unknown>, totalRelido = 100) => ({
  origem: "get_por_id",
  idConsultado: VAGA,
  vagaRelida: VAGA,
  pedidoId: PEDIDO,
  totalRelido,
  order,
});
const pagamento = (o: Record<string, unknown>) =>
  ((o.transactions as Record<string, unknown>).payments as Array<Record<string, unknown>>)[0];

Deno.test("PIX com parcelas e valor de parcela NÃO ganha a exceção de juros: pago acima do pedido recusa", () => {
  const o = orderPixPagaDaDoc({ id: VAGA, externalReference: PEDIDO, valor: "112.40" });
  o.total_paid_amount = "112.40";
  pagamento(o).amount = "112.40";
  pagamento(o).payment_method = { type: "bank_transfer", installments: 2, installment_amount: "56.20" };
  assertEquals(provarPagamentoPelaConsulta(base(o)), { provado: false, motivo: "valor_divergente" });
  assertEquals(conferirValorDoPagamento(112.4, 100, o).provado, false);
});

Deno.test("cartão de crédito em 2x com os mesmos números (juros) continua provado — contraprova do caso acima", () => {
  const o = orderCartaoAprovadaDaDoc({ id: VAGA, externalReference: PEDIDO, valor: "112.40" });
  o.total_paid_amount = "112.40";
  pagamento(o).amount = "112.40";
  pagamento(o).payment_method = { type: "credit_card", installments: 2, installment_amount: "56.20" };
  assertEquals(provarPagamentoPelaConsulta(base(o)), { provado: true, valor: 112.4, valorPago: 112.4 });
});

Deno.test("captura: com DOIS pagamentos na order, o paid_amount do primeiro não é lido como o valor capturado", () => {
  const o = orderCartaoAprovadaDaDoc({ id: VAGA, externalReference: PEDIDO, valor: "100.00" });
  delete o.total_paid_amount;
  const [primeiro] = (o.transactions as Record<string, unknown>).payments as Array<Record<string, unknown>>;
  (o.transactions as Record<string, unknown>).payments = [
    { ...primeiro, id: "PAY-ANTIGO", paid_amount: "30.00" },
    { ...primeiro, id: "PAY-NOVO", paid_amount: "100.00" },
  ];
  assertEquals(conferirValorDoPagamento(100, 100, o), { provado: true, valor: 100, total: 100 });
  // e a prova inteira continua recusando order com mais de um pagamento
  assertEquals(provarPagamentoPelaConsulta(base(o)), { provado: false, motivo: "pagamentos" });
});

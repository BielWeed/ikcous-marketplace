// @ts-nocheck
/**
 * Cartão À VISTA (crédito 1x, débito) com captura MENOR que o pedido.
 *
 * O DEFEITO: o ramo "captura abaixo do pedido" de `conferirValorDoPagamento`
 * só valia para crédito parcelado. O webhook e a reconciliação chamam SÓ esta
 * função (não a prova completa `provarPagamentoPelaConsulta`, que já recusa a
 * captura abaixo do limite para todo cartão), então um cartão à vista com
 * `total_amount` 100,00 e `total_paid_amount` 60,00 (processed:accredited)
 * passava — o pedido ficava pago no app com dinheiro faltando.
 *
 * Fixtures inventadas. Cada caso muda UM campo: o objeto de partida passa.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { conferirValorDoPagamento, provarPagamentoPelaConsulta } from "./prova-de-pagamento.ts";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const VAGA = "ORDTST01CARTAOAVISTA";
const DIVERGENTE = { provado: false, motivo: "valor_divergente" };

type Pagamento = { tipo?: string; parcelas?: number | null };

/** Order de cartão aprovada, total 100,00; `pago` vai na raiz e no pagamento. */
function order(pago: string | null, { tipo = "credit_card", parcelas = 1 }: Pagamento = {}) {
  const metodo: Record<string, unknown> = { id: "master", type: tipo };
  if (parcelas !== null) metodo.installments = parcelas;
  const pagamento: Record<string, unknown> = {
    id: "PAYTST01",
    amount: "100.00",
    status: "processed",
    status_detail: "accredited",
    payment_method: metodo,
  };
  const raiz: Record<string, unknown> = {
    id: VAGA,
    external_reference: PEDIDO,
    status: "processed",
    status_detail: "accredited",
    total_amount: "100.00",
    transactions: { payments: [pagamento] },
  };
  if (pago !== null) {
    raiz.total_paid_amount = pago;
    pagamento.paid_amount = pago;
  }
  return raiz;
}

// --- o defeito -----------------------------------------------------------------

Deno.test("cartão à vista: crédito 1x com captura 60,00 de 100,00 NÃO é provado", () => {
  assertEquals(conferirValorDoPagamento(100, 100, order("60.00")), DIVERGENTE);
});

Deno.test("cartão à vista: débito com captura 60,00 de 100,00 NÃO é provado", () => {
  assertEquals(conferirValorDoPagamento(100, 100, order("60.00", { tipo: "debit_card" })), DIVERGENTE);
});

Deno.test("cartão à vista: crédito sem `installments` (campo não ecoado) também recusa captura menor", () => {
  assertEquals(conferirValorDoPagamento(100, 100, order("60.00", { parcelas: null })), DIVERGENTE);
});

Deno.test("cartão à vista: captura só no `paid_amount` do pagamento (sem raiz) também recusa", () => {
  const o = order("60.00");
  delete o.total_paid_amount;
  assertEquals(conferirValorDoPagamento(100, 100, o), DIVERGENTE);
});

// --- o limite: tolerância de 5 centavos, em centavos ---------------------------

Deno.test("cartão à vista: captura igual ao pedido é provada", () => {
  assertEquals(conferirValorDoPagamento(100, 100, order("100.00")), { provado: true, valor: 100, total: 100 });
});

Deno.test("cartão à vista: borda — total menos 5 centavos passa, menos 6 centavos recusa", () => {
  for (const tipo of ["credit_card", "debit_card"]) {
    assertEquals(conferirValorDoPagamento(100, 100, order("99.95", { tipo })).provado, true, `${tipo} 99.95`);
    assertEquals(conferirValorDoPagamento(100, 100, order("99.94", { tipo })), DIVERGENTE, `${tipo} 99.94`);
  }
});

Deno.test("cartão à vista: a conta é em centavos (59,70 de 59,75 passa; 59,69 recusa)", () => {
  const o = (pago: string) => {
    const x = order(pago);
    x.total_amount = "59.75";
    x.transactions.payments[0].amount = "59.75";
    return x;
  };
  assertEquals(conferirValorDoPagamento(59.75, 59.75, o("59.70")).provado, true);
  assertEquals(conferirValorDoPagamento(59.75, 59.75, o("59.69")), DIVERGENTE);
});

Deno.test("cartão à vista: acima do pedido continua recusando além da tolerância (o teto de hoje)", () => {
  assertEquals(conferirValorDoPagamento(100, 100, order("100.05")).provado, true);
  assertEquals(conferirValorDoPagamento(100, 100, order("100.06")), DIVERGENTE);
});

// --- o que NÃO pode mudar -------------------------------------------------------

Deno.test("cartão à vista: valor capturado AUSENTE segue como hoje (a conferência não inventa recusa)", () => {
  assertEquals(conferirValorDoPagamento(100, 100, order(null)), { provado: true, valor: 100, total: 100 });
});

Deno.test("parcelado: captura menor continua recusando; captura == pedido e com juros dentro do teto continuam provadas", () => {
  const o = (pago: string) => {
    const x = order(pago, { parcelas: 2 });
    x.transactions.payments[0].payment_method.installment_amount = (Number(pago) / 2).toFixed(2);
    return x;
  };
  assertEquals(conferirValorDoPagamento(100, 100, o("60.00")), DIVERGENTE);
  assertEquals(conferirValorDoPagamento(100, 100, o("99.99")), DIVERGENTE, "parcelado nunca aceita menos que o pedido");
  assertEquals(conferirValorDoPagamento(100, 100, o("100.00")).provado, true);
  assertEquals(conferirValorDoPagamento(100, 100, o("109.64")).provado, true, "juros conferidos pela parcela");
});

Deno.test("parcelado: captura ilegível recusa (comportamento de hoje)", () => {
  const o = order("abc", { parcelas: 3 });
  assertEquals(conferirValorDoPagamento(100, 100, o), DIVERGENTE);
});

Deno.test("PIX: captura menor NÃO muda nesta função (a recusa do PIX mora na prova completa)", () => {
  const pix = order("60.00", { tipo: "bank_transfer", parcelas: null });
  assertEquals(conferirValorDoPagamento(100, 100, pix), { provado: true, valor: 100, total: 100 });
});

Deno.test("sem order (caminho clássico): a função continua como antes", () => {
  assertEquals(conferirValorDoPagamento(100, 100), { provado: true, valor: 100, total: 100 });
});

// --- a prova completa continua recusando o mesmo caso ---------------------------

Deno.test("prova completa: cartão à vista com captura 60,00 de 100,00 continua NÃO provado", () => {
  const prova = provarPagamentoPelaConsulta({
    origem: "get_por_id",
    idConsultado: VAGA,
    vagaRelida: VAGA,
    pedidoId: PEDIDO,
    totalRelido: 100,
    order: order("60.00"),
  });
  assertEquals(prova.provado, false);
});

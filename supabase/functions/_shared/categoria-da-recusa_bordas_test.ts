// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `categoria-da-recusa.ts` (o que o checkout
 * diz ao cliente quando o cartão é recusado: "sem limite", "o banco pediu
 * autorização"...). Dos 6 mutantes que sobreviviam, o único que mudava o que a
 * cliente lê era o detalhe VAZIO: um `status_detail` "" no pagamento não é um
 * detalhe específico — tem de deixar o da raiz decidir, e não "decidir" ele
 * mesmo (o que mandaria a cliente para "outra", a frase genérica, escondendo
 * "saldo ou limite insuficiente").
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { categoriaDaRecusaDaOrder, categoriaDaRecusaDoErro } from "./categoria-da-recusa.ts";

const comPagamento = (detalheDoPagamento: unknown, detalheDaRaiz: unknown) => ({
  status_detail: detalheDaRaiz,
  transactions: { payments: [{ status_detail: detalheDoPagamento }] },
});

Deno.test("order: detalhe VAZIO no pagamento deixa o da raiz decidir (não 'decide' sozinho como 'outra')", () => {
  assertEquals(categoriaDaRecusaDaOrder(comPagamento("", "insufficient_amount")), "sem_limite");
  assertEquals(categoriaDaRecusaDaOrder(comPagamento("", "cc_rejected_call_for_authorize")), "banco_pediu_autorizacao");
});

Deno.test("order: detalhe genérico 'failed' no pagamento também deixa a raiz decidir; detalhe específico no pagamento vence a raiz", () => {
  assertEquals(categoriaDaRecusaDaOrder(comPagamento("failed", "insufficient_amount")), "sem_limite");
  assertEquals(categoriaDaRecusaDaOrder(comPagamento("bad_filled_date", "insufficient_amount")), "dados_do_cartao");
  // Específico no pagamento que cai em "outra" DECIDE: o motivo de risco nunca é revertido pela raiz.
  assertEquals(categoriaDaRecusaDaOrder(comPagamento("high_risk", "insufficient_amount")), "outra");
});

Deno.test("order: sem detalhe nenhum, ou com tudo vazio, é 'outra'", () => {
  for (const order of [null, undefined, "x", {}, comPagamento("", ""), comPagamento(null, undefined), { transactions: { payments: [] } }]) {
    assertEquals(categoriaDaRecusaDaOrder(order), "outra", JSON.stringify(order));
  }
});

Deno.test("corpo de erro 402: detalhe vazio em data não conta como específico — o details[] do erro decide", () => {
  const corpo = {
    data: comPagamento("", ""),
    errors: [{ details: ["PAY01: insufficient_amount"] }],
  };
  assertEquals(categoriaDaRecusaDoErro(corpo), "sem_limite");
});

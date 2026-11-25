// @ts-nocheck
/**
 * Caça por mutação (25/11/2026, segunda rodada) em `devolucao-parcial.ts`: depois
 * das suítes `_test` e `_bordas_test`, ainda sobreviviam defeitos de UMA linha que
 * movem dinheiro nos LIMITES numéricos da devolução parcial — todos abaixo de
 * R$ 1,00, onde um `> 0` trocado por `> 1` não reprova o caminho feliz (R$ 20,00):
 *
 *   * `refunded_amount` fracionado (R$ 0,50) como ÚNICO indício de devolução parcial;
 *   * devolução de UM centavo (a lista soma 1 centavo: ainda é dinheiro devolvido);
 *   * agregado do pagamento (R$ 0,50) MAIOR que a lista (R$ 0,20): parte do dinheiro
 *     ficaria sem registro, então "na dúvida, ainda não";
 *   * CADA estado do pagamento que diz "o dinheiro nunca foi capturado" recusa (os
 *     nove, um a um) — uma devolução sobre cobrança que nunca foi paga não prova nada;
 *   * pedido ausente com o MOTIVO certo (`pedido_ausente`), não só `provado: false`;
 *   * a ordem que chega como lista (com a chave `transactions` pendurada) não vira
 *     devolução;
 *   * RPC que devolve `error` JUNTO com um `data` de sucesso: o erro vence, lança.
 *
 * Valores escritos à mão (nada recalculado com a fórmula do código); fixtures
 * inventadas.
 */
import { assertEquals, assertRejects } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  devolucaoParcialProvaPagamento,
  devolucoesConcluidasDaOrder,
  registrarDevolucoesConcluidasDaOrder,
} from "./devolucao-parcial.ts";

const PEDIDO_ID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const ORDER_ID = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";

function pedido(extra: Record<string, unknown> = {}) {
  return {
    id: PEDIDO_ID,
    total: 100,
    total_amount: null,
    gateway_payment_id: ORDER_ID,
    payment_status: "aguardando",
    paid_at: null,
    status: "pending",
    ...extra,
  };
}

/** PIX de R$ 100,00 com UMA devolução concluída; o valor devolvido e o agregado variam. */
function orderComDevolucao(
  { agregado, devolvido, detalheDaRaiz = "partially_refunded", detalheDoPagamento = "accredited" }: {
    agregado: string;
    devolvido: string;
    detalheDaRaiz?: string;
    detalheDoPagamento?: string;
  },
) {
  return {
    id: ORDER_ID,
    external_reference: PEDIDO_ID,
    type: "online",
    currency: "BRL",
    status: "processed",
    status_detail: detalheDaRaiz,
    total_amount: "100.00",
    transactions: {
      payments: [{
        id: "PAY01XYZ",
        amount: "100.00",
        paid_amount: "100.00",
        refunded_amount: agregado,
        status: "processed",
        status_detail: detalheDoPagamento,
        payment_method: { id: "pix", type: "bank_transfer" },
      }],
      refunds: [{ id: "REF01", transaction_id: "PAY01XYZ", amount: devolvido, status: "processed" }],
    },
  };
}

// ─── o indício e a soma abaixo de R$ 1,00 ────────────────────────────────────

Deno.test("refunded_amount de R$ 0,50 SOZINHO indica devolução parcial (raiz e pagamento sem partially_refunded): prova", () => {
  const order = orderComDevolucao({
    agregado: "0.50",
    devolvido: "0.50",
    detalheDaRaiz: "qualquer",
  });
  const r = devolucaoParcialProvaPagamento({ order, pedido: pedido() });
  assertEquals(r.provado, true);
  assertEquals(r.devolvido, 0.5);
  assertEquals(r.devolucoes, [{ id: "REF01", valor: 0.5 }]);
});

Deno.test("devolução de UM centavo (R$ 0,01) já prova o pagamento e devolve 0,01", () => {
  const order = orderComDevolucao({ agregado: "0.01", devolvido: "0.01" });
  const r = devolucaoParcialProvaPagamento({ order, pedido: pedido() });
  assertEquals(r.provado, true);
  assertEquals(r.devolvido, 0.01);
  assertEquals(r.devolucoes, [{ id: "REF01", valor: 0.01 }]);
});

Deno.test("agregado de R$ 0,50 MAIOR que a lista (R$ 0,20): recusa — parte do dinheiro devolvido ficaria sem registro", () => {
  const order = orderComDevolucao({ agregado: "0.50", devolvido: "0.20" });
  const r = devolucaoParcialProvaPagamento({ order, pedido: pedido() });
  assertEquals(r, { provado: false, motivo: "devolucao_nao_comprovada_por_inteiro" });
});

Deno.test("agregado IGUAL à lista (R$ 0,50 = R$ 0,50) não é divergência: prova", () => {
  const order = orderComDevolucao({ agregado: "0.50", devolvido: "0.50" });
  const r = devolucaoParcialProvaPagamento({ order, pedido: pedido() });
  assertEquals(r.provado, true);
  assertEquals(r.devolvido, 0.5);
});

Deno.test("agregado de R$ 1,00 contra lista de R$ 0,99 (um centavo a menos): recusa", () => {
  const order = orderComDevolucao({ agregado: "1.00", devolvido: "0.99" });
  const r = devolucaoParcialProvaPagamento({ order, pedido: pedido() });
  assertEquals(r, { provado: false, motivo: "devolucao_nao_comprovada_por_inteiro" });
});

// ─── pagamento que nunca foi capturado ───────────────────────────────────────

Deno.test("cada estado de pagamento SEM captura recusa com status_do_pagamento (os nove, um a um)", () => {
  const semCaptura = [
    "created",
    "canceled",
    "cancelled",
    "failed",
    "expired",
    "rejected",
    "pending",
    "processing",
    "in_process",
  ];
  for (const estado of semCaptura) {
    const order = orderComDevolucao({ agregado: "20.00", devolvido: "20.00" });
    order.transactions.payments[0].status = estado;
    assertEquals(
      devolucaoParcialProvaPagamento({ order, pedido: pedido() }),
      { provado: false, motivo: "status_do_pagamento" },
      `estado ${estado}`,
    );
  }
});

Deno.test("estado de pagamento CAPTURADO (processed, approved) não é recusado por esta guarda", () => {
  for (const estado of ["processed", "approved"]) {
    const order = orderComDevolucao({ agregado: "20.00", devolvido: "20.00" });
    order.transactions.payments[0].status = estado;
    assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }).provado, true, `estado ${estado}`);
  }
});

// ─── o pedido ausente, com o motivo ──────────────────────────────────────────

Deno.test("pedido ausente (null, texto, número, lista): o MOTIVO é pedido_ausente", () => {
  const order = orderComDevolucao({ agregado: "20.00", devolvido: "20.00" });
  for (const ruim of [null, undefined, "pedido", 7, []]) {
    assertEquals(
      devolucaoParcialProvaPagamento({ order, pedido: ruim }),
      { provado: false, motivo: "pedido_ausente" },
    );
  }
});

// ─── a order que chega como lista ────────────────────────────────────────────

Deno.test("order que é uma LISTA (mesmo com `transactions` pendurada) não tem devolução concluída", () => {
  const lista = Object.assign([], {
    transactions: { refunds: [{ id: "REF01", amount: "20.00", status: "processed" }] },
  });
  assertEquals(devolucoesConcluidasDaOrder(lista), []);
});

// ─── o registro: erro do banco vence um data de sucesso ──────────────────────

Deno.test("registro: `error` junto de um data inserido LANÇA (o erro vence; nada é contado como gravado)", async () => {
  const supabase = {
    rpc: () => Promise.resolve({ data: { resultado: "inserido" }, error: { message: "falha de rede simulada" } }),
  };
  await assertRejects(
    () =>
      registrarDevolucoesConcluidasDaOrder({
        supabase,
        orderId: PEDIDO_ID,
        order: orderComDevolucao({ agregado: "20.00", devolvido: "20.00" }),
      }),
  );
});

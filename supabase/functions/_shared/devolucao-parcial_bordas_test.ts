// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `devolucao-parcial.ts`: 22 mutantes
 * sobreviviam à suíte de `devolucao-parcial_test.ts`. Os que não eram
 * equivalentes (o `??` x `||` de tipos que nunca vêm falsos, o `null` x
 * `undefined` do leitor de número) viram os casos abaixo — todos de BORDA, que o
 * caminho feliz do outro arquivo não alcança:
 *
 *   * QUEM indica "devolução parcial": o detalhe da raiz, o detalhe do pagamento
 *     ou o `refunded_amount` — cada um sozinho — e o `refunded_amount` ZERADO,
 *     que não indica nada;
 *   * pagamento ilegível (`null`, texto) não derruba a função, recusa;
 *   * pedido com `id` vazio nunca casa com uma order de `external_reference` vazio;
 *   * valor do pagamento e total da raiz: um só presente não é divergência;
 *   * `total` do pedido igual a zero não cai no `total_amount`;
 *   * devolução com valor de TIPO errado (booleano, lista) não conta como dinheiro;
 *   * o registro aceita `nao_cabe` e o aviso `saldo` cada um sozinho.
 *
 * Fixtures inventadas (ids e valores de teste, nada de loja real).
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
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

/** PIX de R$ 100 com devolução parcial de R$ 20 concluída (a base que PROVA). */
function orderParcial(extra: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    external_reference: PEDIDO_ID,
    type: "online",
    currency: "BRL",
    status: "processed",
    status_detail: "partially_refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{
        id: "PAY01XYZ",
        amount: "100.00",
        paid_amount: "100.00",
        refunded_amount: "20.00",
        status: "processed",
        status_detail: "accredited",
        payment_method: { id: "pix", type: "bank_transfer" },
      }],
      refunds: [{ id: "REF01", transaction_id: "PAY01XYZ", amount: "20.00", status: "processed" }],
    },
    ...extra,
  };
}

/** Muda campos do pagamento único; `undefined` apaga o campo. */
function comPagamento(campos: Record<string, unknown>, order = orderParcial()) {
  const pagamento = Object.fromEntries(
    Object.entries({ ...order.transactions.payments[0], ...campos }).filter(([, v]) => v !== undefined),
  );
  return { ...order, transactions: { ...order.transactions, payments: [pagamento] } };
}

/** Raiz SEM `partially_refunded` (o detalhe `qualquer` não está no mapa: continua `null`). */
const raizSemIndicio = (order = orderParcial()) => ({ ...order, status_detail: "qualquer" });

// ─── quem indica "devolução parcial" ─────────────────────────────────────────

Deno.test("indício só no detalhe do PAGAMENTO (raiz sem partially_refunded, sem refunded_amount): prova", () => {
  const order = comPagamento(
    { status_detail: "partially_refunded", refunded_amount: undefined },
    raizSemIndicio(),
  );
  const r = devolucaoParcialProvaPagamento({ order, pedido: pedido() });
  assertEquals(r.provado, true);
  assertEquals(r.devolvido, 20);
});

Deno.test("indício só no refunded_amount > 0 do pagamento (nenhum detalhe diz partially_refunded): prova", () => {
  const order = comPagamento({ refunded_amount: "20.00" }, raizSemIndicio());
  const r = devolucaoParcialProvaPagamento({ order, pedido: pedido() });
  assertEquals(r.provado, true);
  assertEquals(r.devolvido, 20);
});

Deno.test("refunded_amount ZERADO não é indício: com a lista de devoluções presente, ainda assim recusa nao_e_devolucao_parcial", () => {
  for (const zero of ["0", "0.00", 0]) {
    const order = comPagamento({ refunded_amount: zero }, raizSemIndicio());
    assertEquals(
      devolucaoParcialProvaPagamento({ order, pedido: pedido() }),
      { provado: false, motivo: "nao_e_devolucao_parcial" },
      `refunded_amount=${String(zero)}`,
    );
  }
});

Deno.test("nenhum indício de parcial (sem refunded_amount, detalhes comuns) recusa mesmo com devolução processada na lista", () => {
  const order = comPagamento({ refunded_amount: undefined }, raizSemIndicio());
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }), {
    provado: false,
    motivo: "nao_e_devolucao_parcial",
  });
});

// ─── pagamento ilegível não derruba, recusa ─────────────────────────────────

Deno.test("transactions.payments com item null ou texto: recusa pagamentos, não lança", () => {
  for (const item of [null, "PAY01XYZ", 7]) {
    const base = orderParcial();
    const order = { ...base, transactions: { ...base.transactions, payments: [item] } };
    assertEquals(
      devolucaoParcialProvaPagamento({ order, pedido: pedido() }),
      { provado: false, motivo: "pagamentos" },
      `item=${JSON.stringify(item)}`,
    );
  }
});

// ─── pedido com id vazio ─────────────────────────────────────────────────────

Deno.test("pedido com id vazio nunca casa com order de external_reference vazio: pedido_ausente", () => {
  const order = orderParcial({ external_reference: "" });
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido({ id: "" }) }), {
    provado: false,
    motivo: "pedido_ausente",
  });
});

// ─── valor do pagamento x total da raiz ──────────────────────────────────────

Deno.test("só a raiz traz o valor (pagamento sem amount): não é divergência, prova", () => {
  const order = comPagamento({ amount: undefined });
  const r = devolucaoParcialProvaPagamento({ order, pedido: pedido() });
  assertEquals(r.provado, true);
  assertEquals(r.valorOriginal, 100);
});

Deno.test("só o pagamento traz o valor (raiz sem total_amount): não é divergência, prova", () => {
  const order = orderParcial();
  delete order.total_amount;
  const r = devolucaoParcialProvaPagamento({ order, pedido: pedido() });
  assertEquals(r.provado, true);
  assertEquals(r.valorOriginal, 100);
});

Deno.test("valor do pagamento ilegível com a raiz em ZERO: recusa valor_do_pagamento (o 0 de um lado não 'casa' com o texto do outro)", () => {
  const order = comPagamento({ amount: "abc" }, orderParcial({ total_amount: "0.00" }));
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }), {
    provado: false,
    motivo: "valor_do_pagamento",
  });
});

// ─── total do pedido ─────────────────────────────────────────────────────────

Deno.test("total do pedido ZERO não é 'ausente': não cai no total_amount, recusa total_do_pedido", () => {
  const r = devolucaoParcialProvaPagamento({
    order: orderParcial(),
    pedido: pedido({ total: 0, total_amount: 100 }),
  });
  assertEquals(r, { provado: false, motivo: "total_do_pedido" });
});

Deno.test("total do pedido AUSENTE (null) cai no total_amount: prova", () => {
  const r = devolucaoParcialProvaPagamento({
    order: orderParcial(),
    pedido: pedido({ total: null, total_amount: 100 }),
  });
  assertEquals(r.provado, true);
});

// ─── valor de tipo errado não é dinheiro ─────────────────────────────────────

Deno.test("devolução com amount booleano ou lista NÃO conta como dinheiro devolvido (Number(true) seria 1 real)", () => {
  for (const amount of [true, [20], { v: 20 }]) {
    const order = orderParcial();
    order.transactions.refunds = [{ id: "REF01", amount, status: "processed" }];
    assertEquals(devolucoesConcluidasDaOrder(order), [], `amount=${JSON.stringify(amount)}`);
  }
});

// ─── registro: nao_cabe e aviso saldo, cada um sozinho ───────────────────────

function rpcFalso(retorno: unknown) {
  return {
    rpc: () => Promise.resolve({ data: retorno, error: null }),
  };
}

Deno.test("registro: resultado nao_cabe SEM o campo aviso vai para naoCabem (não lança)", async () => {
  const resumo = await registrarDevolucoesConcluidasDaOrder({
    supabase: rpcFalso({ resultado: "nao_cabe" }),
    orderId: PEDIDO_ID,
    order: orderParcial(),
  });
  assertEquals(resumo, { inseridas: 0, jaRegistradas: 0, naoCabem: [{ id: "REF01", valor: 20 }] });
});

Deno.test("registro: aviso saldo SEM resultado conhecido vai para naoCabem (não lança)", async () => {
  const resumo = await registrarDevolucoesConcluidasDaOrder({
    supabase: rpcFalso({ aviso: "saldo" }),
    orderId: PEDIDO_ID,
    order: orderParcial(),
  });
  assertEquals(resumo, { inseridas: 0, jaRegistradas: 0, naoCabem: [{ id: "REF01", valor: 20 }] });
});

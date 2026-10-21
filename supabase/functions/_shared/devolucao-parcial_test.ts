// @ts-nocheck
/**
 * Testes de `devolucaoParcialProvaPagamento` e do registro das devoluções —
 * a regra que impede uma venda PAGA de virar pedido cancelado quando o
 * lojista devolve parte do dinheiro no painel do Mercado Pago ANTES de o app
 * confirmar o pagamento (P1 da revisão adversarial do lote 1.5.47).
 *
 * O que erra caro aqui é o FALSO SIM: confirmar como pago um pedido que o
 * cliente não pagou (produto de graça) ou a cobrança de OUTRA tentativa. Por
 * isso cada recusa é isolada: o objeto de partida PROVA, e cada caso muda UM
 * campo só — se a recusa vier de outro campo por acidente, o motivo esperado
 * não bate.
 *
 * Formatos conferidos na doc oficial da Orders API (context7, 21/10/2026):
 * `status: "processed"` + `status_detail: "partially_refunded"`;
 * `transactions.refunds[]` com `id`, `amount` (string) e `status: "processed"`;
 * `transactions.payments[].refunded_amount`. A doc também traz, em outra
 * página, `status: "refunded"` para a parcial: os dois formatos são cobertos.
 */
import { assertEquals, assertRejects } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  devolucaoParcialProvaPagamento,
  devolucoesConcluidasDaOrder,
  registrarDevolucoesConcluidasDaOrder,
} from "./devolucao-parcial.ts";

const PEDIDO_ID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const OUTRO_PEDIDO = "9e9e9e9e-1111-2222-3333-444455556666";
const ORDER_ID = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
const OUTRA_ORDER = "ORDTST01KZZ4D94WC79335A68CZ0000";

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

/** PIX de R$ 100 com devolução parcial de R$ 20 concluída. */
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

function comPagamento(campos: Record<string, unknown>, order = orderParcial()) {
  const pagamento = { ...order.transactions.payments[0], ...campos };
  return { ...order, transactions: { ...order.transactions, payments: [pagamento] } };
}

function semDevolucao(order = orderParcial()) {
  const pagamento = { ...order.transactions.payments[0] };
  delete pagamento.refunded_amount;
  return { ...order, transactions: { payments: [pagamento], refunds: [] } };
}

// --- o caminho que prova -----------------------------------------------------

Deno.test("parcial: PIX de 100, devolvido 20, valor original igual ao total -> PROVA o pagamento", () => {
  const decisao = devolucaoParcialProvaPagamento({ order: orderParcial(), pedido: pedido() });
  assertEquals(decisao, {
    provado: true,
    valorOriginal: 100,
    devolvido: 20,
    devolucoes: [{ id: "REF01", valor: 20 }],
  });
});

for (const estado of ["aguardando", "expirado"]) {
  Deno.test(`parcial: pedido '${estado}' sem paid_at também prova (expirado vira pago_apos_expirar na RPC)`, () => {
    const decisao = devolucaoParcialProvaPagamento({
      order: orderParcial(),
      pedido: pedido({ payment_status: estado, status: estado === "expirado" ? "cancelled" : "pending" }),
    });
    assertEquals(decisao.provado, true);
  });
}

Deno.test("parcial: a tolerância de centavos da casa vale (total 100,04 contra original 100,00)", () => {
  assertEquals(devolucaoParcialProvaPagamento({ order: orderParcial(), pedido: pedido({ total: 100.04 }) }).provado, true);
  assertEquals(
    devolucaoParcialProvaPagamento({ order: orderParcial(), pedido: pedido({ total: 100.06 }) }),
    { provado: false, motivo: "valor_divergente" },
  );
});

Deno.test("parcial: total do pedido em `total_amount` (coluna legada) e em string", () => {
  const decisao = devolucaoParcialProvaPagamento({
    order: orderParcial(),
    pedido: pedido({ total: null, total_amount: "100.00" }),
  });
  assertEquals(decisao.provado, true);
});

// --- formatos de devolução da Orders API --------------------------------------

Deno.test("formato: `status: refunded` + `partially_refunded` (a doc se contradiz) também prova", () => {
  const decisao = devolucaoParcialProvaPagamento({
    order: orderParcial({ status: "refunded" }),
    pedido: pedido(),
  });
  assertEquals(decisao.provado, true);
});

// Achado 4340526799 (Codex, dinheiro): o `refunded_amount` agregado NUNCA prova sozinho. Se a lista de
// devoluções concluídas (a que vira linha em order_refunds) vier vazia ou somar MENOS que o agregado, confirmar
// o pagamento deixaria dinheiro devolvido sem registro (receita superestimada, saldo devolvível errado).
Deno.test("agregado: só `refunded_amount` do pagamento (sem a lista de refunds) NÃO prova", () => {
  const order = orderParcial();
  order.transactions = { payments: order.transactions.payments };
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }), {
    provado: false,
    motivo: "sem_devolucao_concluida",
  });
});

Deno.test("agregado: lista de refunds VAZIA com refunded_amount > 0 NÃO prova", () => {
  const order = orderParcial();
  order.transactions.refunds = [];
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }), {
    provado: false,
    motivo: "sem_devolucao_concluida",
  });
});

Deno.test("agregado: lista que soma MENOS que o refunded_amount NÃO prova (parte do dinheiro ficaria sem registro)", () => {
  const order = orderParcial();
  order.transactions.refunds = [{ id: "REF01", amount: "20.00", status: "processed" }];
  order.transactions.payments[0].refunded_amount = "50.00";
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }), {
    provado: false,
    motivo: "devolucao_nao_comprovada_por_inteiro",
  });
});

Deno.test("agregado: um centavo a menos na lista já recusa; a soma IGUAL ao agregado prova com a lista completa", () => {
  const menos = orderParcial();
  menos.transactions.refunds = [
    { id: "REF01", amount: "20.00", status: "processed" },
    { id: "REF02", amount: "29.99", status: "processed" },
  ];
  menos.transactions.payments[0].refunded_amount = "50.00";
  assertEquals(devolucaoParcialProvaPagamento({ order: menos, pedido: pedido() }).motivo, "devolucao_nao_comprovada_por_inteiro");

  const igual = orderParcial();
  igual.transactions.refunds = [
    { id: "REF01", amount: "20.00", status: "processed" },
    { id: "REF02", amount: "30.00", status: "processed" },
  ];
  igual.transactions.payments[0].refunded_amount = "50.00";
  assertEquals(devolucaoParcialProvaPagamento({ order: igual, pedido: pedido() }), {
    provado: true,
    valorOriginal: 100,
    devolvido: 50,
    devolucoes: [{ id: "REF01", valor: 20 }, { id: "REF02", valor: 30 }],
  });
});

Deno.test("agregado: lista que soma MAIS que o refunded_amount (o MP atualiza o agregado depois) prova pela soma da lista", () => {
  const order = orderParcial();
  order.transactions.refunds = [
    { id: "REF01", amount: "20.00", status: "processed" },
    { id: "REF02", amount: "30.00", status: "processed" },
  ];
  order.transactions.payments[0].refunded_amount = "20.00";
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }), {
    provado: true,
    valorOriginal: 100,
    devolvido: 50,
    devolucoes: [{ id: "REF01", valor: 20 }, { id: "REF02", valor: 30 }],
  });
});

Deno.test("agregado: refund em andamento (processing) + refunded_amount > 0 NÃO prova (só o concluído conta)", () => {
  const order = orderParcial();
  order.transactions.refunds = [
    { id: "REF01", amount: "20.00", status: "processed" },
    { id: "REF02", amount: "30.00", status: "processing" },
  ];
  order.transactions.payments[0].refunded_amount = "50.00";
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }).motivo, "devolucao_nao_comprovada_por_inteiro");
});

Deno.test("formato: só a lista de refunds concluídos (sem `refunded_amount`) prova", () => {
  const order = orderParcial();
  const pagamento = { ...order.transactions.payments[0] };
  delete pagamento.refunded_amount;
  order.transactions = { payments: [pagamento], refunds: order.transactions.refunds };
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }).provado, true);
});

Deno.test("formato: duas devoluções parciais (20 + 30) somam 50 e ambas voltam para registro", () => {
  const order = orderParcial();
  order.transactions.refunds = [
    { id: "REF01", amount: "20.00", status: "processed" },
    { id: "REF02", amount: 30, status: "processed" },
  ];
  order.transactions.payments[0].refunded_amount = "50.00";
  const decisao = devolucaoParcialProvaPagamento({ order, pedido: pedido() });
  assertEquals(decisao.provado, true);
  assertEquals(decisao.devolvido, 50);
  assertEquals(decisao.devolucoes, [{ id: "REF01", valor: 20 }, { id: "REF02", valor: 30 }]);
});

Deno.test("formato: devolução em andamento (`processing`) NÃO é dinheiro devolvido -> recusa", () => {
  const order = orderParcial();
  order.transactions.refunds = [{ id: "REF01", amount: "20.00", status: "processing" }];
  delete order.transactions.payments[0].refunded_amount;
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }), {
    provado: false,
    motivo: "sem_devolucao_concluida",
  });
});

// --- sem devolução, sem prova --------------------------------------------------

Deno.test("sem devolução: detalhe `partially_refunded` mas nenhum refund e nenhum valor devolvido -> NÃO prova", () => {
  assertEquals(devolucaoParcialProvaPagamento({ order: semDevolucao(), pedido: pedido() }), {
    provado: false,
    motivo: "sem_devolucao_concluida",
  });
});

Deno.test("sem devolução: `refunded_amount` zero não é dinheiro devolvido", () => {
  const order = semDevolucao();
  order.transactions.payments[0].refunded_amount = "0.00";
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }).motivo, "sem_devolucao_concluida");
});

// --- o pedido já resolvido: nada a fazer ----------------------------------------

for (const [nome, extra] of [
  ["já pago", { payment_status: "pago", paid_at: "2026-10-21T10:00:00Z" }],
  ["pago após expirar", { payment_status: "pago_apos_expirar", paid_at: "2026-10-21T10:00:00Z" }],
  ["estornado", { payment_status: "estornado", paid_at: "2026-10-21T10:00:00Z" }],
  ["recusado", { payment_status: "recusado" }],
  ["aguardando MAS com paid_at (estado incoerente: não mexe)", { paid_at: "2026-10-21T10:00:00Z" }],
  ["paid_at ilegível (undefined)", { paid_at: undefined }],
] as Array<[string, Record<string, unknown>]>) {
  Deno.test(`pedido ${nome}: NÃO confirma (pedido_ja_resolvido)`, () => {
    assertEquals(devolucaoParcialProvaPagamento({ order: orderParcial(), pedido: pedido(extra) }), {
      provado: false,
      motivo: "pedido_ja_resolvido",
    });
  });
}

for (const ausente of [null, undefined, "x", [], {}]) {
  Deno.test(`pedido ausente/ilegível (${JSON.stringify(ausente)}): NÃO confirma`, () => {
    assertEquals(devolucaoParcialProvaPagamento({ order: orderParcial(), pedido: ausente }).provado, false);
  });
}

// --- o valor ORIGINAL --------------------------------------------------------

Deno.test("valor original DIFERENTE do total do pedido -> NÃO confirma (mantém o comportamento atual)", () => {
  const order = orderParcial({ total_amount: "90.00" });
  order.transactions.payments[0].amount = "90.00";
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }), {
    provado: false,
    motivo: "valor_divergente",
  });
});

Deno.test("valor original ausente / total do pedido imprestável -> NÃO confirma", () => {
  const semValor = orderParcial();
  delete semValor.total_amount;
  delete semValor.transactions.payments[0].amount;
  assertEquals(devolucaoParcialProvaPagamento({ order: semValor, pedido: pedido() }).motivo, "valor_ausente");
  for (const total of [null, undefined, "x", 0, -5]) {
    assertEquals(
      devolucaoParcialProvaPagamento({ order: orderParcial(), pedido: pedido({ total }) }).motivo,
      "total_do_pedido",
    );
  }
});

Deno.test("valor do pagamento contradiz o total da order -> NÃO confirma", () => {
  assertEquals(
    devolucaoParcialProvaPagamento({ order: comPagamento({ amount: "80.00" }), pedido: pedido() }).motivo,
    "valor_do_pagamento",
  );
});

Deno.test("cartão parcelado com captura MENOR que o total -> NÃO confirma (mesma régua do cron)", () => {
  const order = orderParcial({ total_paid_amount: "90.00" });
  order.transactions.payments[0].payment_method = { id: "master", type: "credit_card", installments: 3 };
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }).motivo, "valor_divergente");
});

Deno.test("cartão à vista com captura igual ao total prova", () => {
  const order = orderParcial({ total_paid_amount: "100.00" });
  order.transactions.payments[0].payment_method = { id: "master", type: "credit_card", installments: 1 };
  assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }).provado, true);
});

Deno.test("devolução igual ou maior que o valor original NÃO é parcial -> recusa", () => {
  for (const devolvido of ["100.00", "130.00"]) {
    const order = orderParcial();
    order.transactions.refunds = [{ id: "REF01", amount: devolvido, status: "processed" }];
    order.transactions.payments[0].refunded_amount = devolvido;
    assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }).motivo, "devolucao_total_ou_maior");
  }
});

// --- a cobrança tem de ser a GRAVADA ---------------------------------------------

Deno.test("order ÓRFÃ (outro id, mesmo external_reference) NÃO prova o pedido", () => {
  assertEquals(
    devolucaoParcialProvaPagamento({ order: orderParcial({ id: OUTRA_ORDER }), pedido: pedido() }).motivo,
    "cobranca_diferente",
  );
});

for (const vaga of [null, "", "verificando:abc123", "123456789"]) {
  Deno.test(`vaga do pedido '${vaga}' (vazia, sentinela ou id clássico) NÃO prova`, () => {
    const order = orderParcial({ id: vaga ?? ORDER_ID });
    assertEquals(
      devolucaoParcialProvaPagamento({ order, pedido: pedido({ gateway_payment_id: vaga }) }).motivo,
      "cobranca_diferente",
    );
  });
}

Deno.test("external_reference de OUTRO pedido (ou ausente) NÃO prova", () => {
  assertEquals(
    devolucaoParcialProvaPagamento({ order: orderParcial({ external_reference: OUTRO_PEDIDO }), pedido: pedido() }).motivo,
    "referencia",
  );
  const sem = orderParcial();
  delete sem.external_reference;
  assertEquals(devolucaoParcialProvaPagamento({ order: sem, pedido: pedido() }).motivo, "referencia");
});

// --- o que não é devolução parcial --------------------------------------------------

for (const [status, detalhe, motivo] of [
  ["processed", "accredited", "nao_e_devolucao_parcial"],
  ["refunded", "refunded", "nao_e_devolucao_parcial"],
  ["charged_back", "in_process", "nao_e_devolucao_parcial"],
  ["created", "created", "nao_e_devolucao_parcial"],
  ["failed", "failed", "nao_e_devolucao_parcial"],
  ["canceled", "canceled", "nao_e_devolucao_parcial"],
  ["action_required", "partially_refunded", "nao_e_devolucao_parcial"],
]) {
  Deno.test(`par ${status}:${detalhe} não é devolução parcial (tem o seu próprio caminho)`, () => {
    assertEquals(devolucaoParcialProvaPagamento({ order: orderParcial({ status, status_detail: detalhe }), pedido: pedido() }), {
      provado: false,
      motivo,
    });
  });
}

Deno.test("contestação presente (raiz, transactions ou pagamento) NÃO prova", () => {
  assertEquals(
    devolucaoParcialProvaPagamento({ order: orderParcial({ chargebacks: [{ id: "c1" }] }), pedido: pedido() }).motivo,
    "contestacao",
  );
  const emTransactions = orderParcial();
  emTransactions.transactions.chargebacks = [{ id: "c1" }];
  assertEquals(devolucaoParcialProvaPagamento({ order: emTransactions, pedido: pedido() }).motivo, "contestacao");
  assertEquals(
    devolucaoParcialProvaPagamento({ order: comPagamento({ chargebacks: [{ id: "c1" }] }), pedido: pedido() }).motivo,
    "contestacao",
  );
});

Deno.test("moeda diferente de BRL NÃO prova", () => {
  assertEquals(devolucaoParcialProvaPagamento({ order: orderParcial({ currency: "USD" }), pedido: pedido() }).motivo, "moeda");
  assertEquals(devolucaoParcialProvaPagamento({ order: orderParcial({ currency_id: "ARS" }), pedido: pedido() }).motivo, "moeda");
});

for (const estado of ["created", "canceled", "failed", "expired", "pending", "in_process"]) {
  Deno.test(`pagamento que nunca foi capturado (${estado}) NÃO prova, mesmo com refund na lista`, () => {
    assertEquals(
      devolucaoParcialProvaPagamento({ order: comPagamento({ status: estado }), pedido: pedido() }).motivo,
      "status_do_pagamento",
    );
  });
}

Deno.test("pagamentos: zero, dois ou forma desconhecida NÃO provam", () => {
  const dois = orderParcial();
  dois.transactions.payments.push({ ...dois.transactions.payments[0], id: "PAY02" });
  const nenhum = orderParcial();
  nenhum.transactions.payments = [];
  const semLista = orderParcial();
  delete semLista.transactions.payments;
  for (const order of [dois, nenhum, semLista]) {
    assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }).motivo, "pagamentos");
  }
});

for (const order of [null, undefined, "x", [], 42]) {
  Deno.test(`order ilegível (${JSON.stringify(order)}) NÃO prova`, () => {
    assertEquals(devolucaoParcialProvaPagamento({ order, pedido: pedido() }), { provado: false, motivo: "order" });
  });
}

Deno.test("a decisão é pura: não altera a order nem o pedido recebidos", () => {
  const order = orderParcial();
  const ped = pedido();
  const antes = JSON.stringify([order, ped]);
  devolucaoParcialProvaPagamento({ order, pedido: ped });
  assertEquals(JSON.stringify([order, ped]), antes);
});

// --- devoluções concluídas -----------------------------------------------------

Deno.test("devolucoesConcluidasDaOrder: só `processed`, com id e valor positivo legíveis, sem repetir id", () => {
  const order = orderParcial();
  order.transactions.refunds = [
    { id: "A", amount: "20.00", status: "processed" },
    { id: "A", amount: "20.00", status: "processed" },
    { id: "B", amount: "10.00", status: "processing" },
    { id: "C", amount: "5.00", status: "failed" },
    { id: "D", amount: "0.00", status: "processed" },
    { id: "E", amount: "abc", status: "processed" },
    { amount: "7.00", status: "processed" },
    { id: 4455, amount: 7.123, status: "processed" },
  ];
  assertEquals(devolucoesConcluidasDaOrder(order), [{ id: "A", valor: 20 }, { id: "4455", valor: 7.12 }]);
  assertEquals(devolucoesConcluidasDaOrder(null), []);
  assertEquals(devolucoesConcluidasDaOrder({ transactions: {} }), []);
});

// --- registro no ledger -------------------------------------------------------------

function rpcFalso(respostas: Record<string, unknown>) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  return {
    chamadas,
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      const id = String(args.p_mp_refund_id);
      const resposta = id in respostas ? respostas[id] : { resultado: "inserido" };
      if (resposta instanceof Error) return { data: null, error: resposta };
      return { data: resposta, error: null };
    },
  };
}

Deno.test("registro: cada devolução concluída vai à RPC com o contrato exato (pedido, id, valor, status, detalhe)", async () => {
  const supabase = rpcFalso({ REF01: { resultado: "inserido" } });
  const resumo = await registrarDevolucoesConcluidasDaOrder({ supabase, orderId: PEDIDO_ID, order: orderParcial() });
  assertEquals(supabase.chamadas, [{
    nome: "registrar_estorno_externo_do_mp",
    args: {
      p_order_id: PEDIDO_ID,
      p_mp_refund_id: "REF01",
      p_valor: 20,
      p_mp_status: "processed",
      p_mp_status_detail: "partially_refunded",
    },
  }]);
  assertEquals(resumo, { inseridas: 1, jaRegistradas: 0, naoCabem: [] });
});

Deno.test("registro: rodar DUAS vezes é seguro — a segunda devolve ja_registrado e nada novo entra", async () => {
  const supabase = rpcFalso({});
  await registrarDevolucoesConcluidasDaOrder({ supabase, orderId: PEDIDO_ID, order: orderParcial() });
  const segunda = rpcFalso({ REF01: { resultado: "ja_registrado" } });
  const resumo = await registrarDevolucoesConcluidasDaOrder({ supabase: segunda, orderId: PEDIDO_ID, order: orderParcial() });
  assertEquals(resumo, { inseridas: 0, jaRegistradas: 1, naoCabem: [] });
});

Deno.test("registro: devolução que não cabe no saldo é devolvida para o aviso, sem lançar", async () => {
  const supabase = rpcFalso({ REF01: { resultado: "nao_cabe", aviso: "saldo" } });
  const resumo = await registrarDevolucoesConcluidasDaOrder({ supabase, orderId: PEDIDO_ID, order: orderParcial() });
  assertEquals(resumo.naoCabem, [{ id: "REF01", valor: 20 }]);
});

Deno.test("registro: erro de banco e retorno ilegível LANÇAM (o ciclo seguinte repete, a RPC é idempotente)", async () => {
  await assertRejects(() =>
    registrarDevolucoesConcluidasDaOrder({
      supabase: rpcFalso({ REF01: new Error("statement timeout") }),
      orderId: PEDIDO_ID,
      order: orderParcial(),
    })
  );
  await assertRejects(() =>
    registrarDevolucoesConcluidasDaOrder({
      supabase: rpcFalso({ REF01: { resultado: 42 } }),
      orderId: PEDIDO_ID,
      order: orderParcial(),
    })
  );
  await assertRejects(() =>
    registrarDevolucoesConcluidasDaOrder({
      supabase: rpcFalso({ REF01: null }),
      orderId: PEDIDO_ID,
      order: orderParcial(),
    })
  );
});

Deno.test("registro: order sem devolução concluída não chama RPC nenhuma", async () => {
  const supabase = rpcFalso({});
  const resumo = await registrarDevolucoesConcluidasDaOrder({ supabase, orderId: PEDIDO_ID, order: semDevolucao() });
  assertEquals(supabase.chamadas.length, 0);
  assertEquals(resumo, { inseridas: 0, jaRegistradas: 0, naoCabem: [] });
});

Deno.test("registro: falha na SEGUNDA devolução lança depois de registrar a primeira (a repetição devolve ja_registrado)", async () => {
  const order = orderParcial();
  order.transactions.refunds = [
    { id: "REF01", amount: "20.00", status: "processed" },
    { id: "REF02", amount: "30.00", status: "processed" },
  ];
  const supabase = rpcFalso({ REF02: new Error("deadlock") });
  await assertRejects(() => registrarDevolucoesConcluidasDaOrder({ supabase, orderId: PEDIDO_ID, order }));
  assertEquals(supabase.chamadas.map((c) => c.args.p_mp_refund_id), ["REF01", "REF02"]);
});

// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `contestacao.ts` (chargeback: o MP diz que o
 * cliente contestou a compra e o dinheiro sai ou volta). 38 mutantes
 * sobreviviam à suíte de `contestacao_test.ts`, das duas rotas do webhook/cron
 * e da reconsulta; metade era `??`/`null→undefined` sem efeito. Estes são os
 * casos de borda que mudavam o comportamento:
 *
 *   * a consulta do caso com HTTP 200 e corpo ilegível NUNCA vira `ok: true`;
 *   * a leitura da order com `transactions` ausente/estranha, item de
 *     `chargebacks[]` `null` e contestação SEM `transaction_id` (que casaria
 *     com um pagamento sem id) devolve `ok: false` com o motivo, sem lançar;
 *   * pagamentos `null` no meio da lista não derrubam a conferência;
 *   * o valor estimado é o total pago com 2 casas (19,99 nunca vira 20,0) e
 *     total pago ZERO não é estimativa (vira `null`);
 *   * caso conhecido: `casosNaOrder` chega à RPC como veio (mínimo 1) e um caso
 *     sem `coverage_applied` legível CONSERVA sem chamar a RPC (nunca entrega
 *     decisão `null` ao ledger).
 *
 * Fixtures inventadas; nenhuma chamada de rede.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  consultarContestacao,
  lerContestacoesDaOrder,
  registrarContestacao,
  registrarContestacaoConhecida,
} from "./contestacao.ts";

const PAY = "PAY01J67CQQH5904WDBVZEM4JMEP3";
const PEDIDO_ID = "22222222-2222-4222-8222-222222222222";

function silencioso<T>(f: () => Promise<T>): Promise<T> {
  const [e, l] = [console.error, console.log];
  console.error = () => {};
  console.log = () => {};
  return f().finally(() => {
    [console.error, console.log] = [e, l];
  });
}

// ─── consulta do caso: 200 com corpo ilegível ────────────────────────────────

Deno.test("consultarContestacao: HTTP 200 com corpo que não é objeto (null, lista, texto, vazio) NÃO lê o caso: ok false, não transitório", async () => {
  for (const corpo of ["null", "[]", '"texto"', "42", "", "isto não é json"]) {
    const r = await silencioso(() =>
      consultarContestacao({
        token: "TOKEN_TESTE",
        vendedorId: "1234567",
        caseId: "CASE1",
        fetchImpl: () => Promise.resolve(new Response(corpo, { status: 200 })),
      })
    );
    assertEquals(r, { ok: false, status: 200, transitorio: false }, JSON.stringify(corpo));
  }
});

// ─── leitura da order ────────────────────────────────────────────────────────

const order = (chargebacks: unknown, payments: unknown = [{ id: PAY, status: "charged_back", status_detail: "in_process" }]) => ({
  transactions: { chargebacks, payments },
});
const cbk = (extra: Record<string, unknown> = {}) => ({
  id: "CBK1",
  case_id: "CASE1",
  transaction_id: PAY,
  status: "in_process",
  ...extra,
});

Deno.test("lerContestacoesDaOrder: transactions ausente, nula, texto ou lista -> 'order sem transactions', sem lançar", () => {
  for (const transactions of [undefined, null, "texto", [], 7]) {
    assertEquals(
      lerContestacoesDaOrder({ transactions }),
      { ok: false, motivo: "order sem transactions" },
      JSON.stringify(transactions),
    );
  }
});

Deno.test("lerContestacoesDaOrder: item null ou texto em chargebacks[] -> 'item de chargebacks[] ilegível', sem lançar", () => {
  for (const item of [null, "CBK1", 5]) {
    assertEquals(
      lerContestacoesDaOrder(order([cbk(), item])),
      { ok: false, motivo: "item de chargebacks[] ilegível" },
      JSON.stringify(item),
    );
  }
});

Deno.test("lerContestacoesDaOrder: contestação SEM transaction_id não casa com pagamento sem id: 'sem transaction_id'", () => {
  const semId = [{ status: "charged_back", status_detail: "in_process" }];
  for (const transaction_id of [undefined, null, ""]) {
    assertEquals(
      lerContestacoesDaOrder(order([cbk({ transaction_id })], semId)),
      { ok: false, motivo: "contestação CBK1 sem transaction_id" },
      JSON.stringify(transaction_id),
    );
  }
});

Deno.test("lerContestacoesDaOrder: pagamento null no meio da lista é ignorado; o pagamento da transação é achado", () => {
  const r = lerContestacoesDaOrder(order([cbk()], [null, "lixo", { id: PAY, status_detail: "reimbursed" }]));
  assertEquals(r.ok, true);
  assertEquals(r.itens.length, 1);
  assertEquals(r.itens[0].detalheDoPagamento, "reimbursed");
});

Deno.test("lerContestacoesDaOrder: id numérico só vale se for inteiro seguro e não negativo (0 vale; -1, fração e acima de 2^53 não)", () => {
  const lerCom = (case_id: unknown) => lerContestacoesDaOrder(order([cbk({ case_id })]));
  const zero = lerCom(0);
  assertEquals(zero.ok, true);
  assertEquals(zero.itens[0].caseId, "0");
  assertEquals(lerCom(98765).itens[0].caseId, "98765");
  for (const ruim of [-1, 1.5, 2 ** 53, Number.NaN, Infinity, "", null, undefined, true, {}]) {
    assertEquals(lerCom(ruim), { ok: false, motivo: "contestação CBK1 sem case_id legível" }, String(ruim));
  }
});

// ─── entrega ao ledger ───────────────────────────────────────────────────────

function ledger() {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  return {
    chamadas,
    rpc: (nome: string, args: Record<string, unknown> = {}) => {
      chamadas.push({ nome, args });
      return Promise.resolve({ data: { resultado: "registrada", valor_estornado: 0 }, error: null });
    },
  };
}

function pedidoDoLedger() {
  return {
    id: PEDIDO_ID,
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: "2026-11-01T12:00:00.000Z",
    status: "cancelled",
  };
}

const casoFavoravel = { id: "CASE1", coverage_applied: true, currency: "BRL", amount: "50.00" };

async function pelaOrder(totalPago: string) {
  const banco = ledger();
  const avisos: string[] = [];
  const corpo = {
    id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total_amount: totalPago,
    transactions: {
      chargebacks: [cbk({ status: "reimbursed" })],
      payments: [{ id: PAY, status_detail: "reimbursed" }],
    },
  };
  const resultado = await silencioso(() =>
    registrarContestacao({
      supabase: banco,
      orderId: PEDIDO_ID,
      corpo,
      ehPayments: false,
      pedido: pedidoDoLedger(),
      consultarCaso: () => Promise.resolve({ ok: true, caso: casoFavoravel }),
      avisar: (chave: string) => {
        avisos.push(chave);
        return Promise.resolve();
      },
    })
  );
  return { banco, avisos, resultado };
}

Deno.test("contestação pela order: o valor estimado é o total pago com 2 casas (19,99 não vira 20,0)", async () => {
  const { banco, resultado } = await pelaOrder("19.99");
  assertEquals(resultado, { entregues: 1, conservadas: 0 });
  assertEquals(banco.chamadas.length, 1);
  assertEquals(banco.chamadas[0].args.p_valor_estimado, 19.99);
});

Deno.test("contestação pela order: total pago ZERO não é estimativa (p_valor_estimado vai null), e o valor do caso segue", async () => {
  const { banco } = await pelaOrder("0.00");
  assertEquals(banco.chamadas[0].args.p_valor_estimado, null);
  assertEquals(banco.chamadas[0].args.p_valor_caso, 50);
});

// ─── caso conhecido ──────────────────────────────────────────────────────────

async function conhecida(
  caso: Record<string, unknown>,
  extras: { casosNaOrder?: number; corpoDaOrder?: Record<string, unknown> | null } = {},
) {
  const banco = ledger();
  const avisos: string[] = [];
  const desfecho = await silencioso(() =>
    registrarContestacaoConhecida({
      supabase: banco,
      orderId: PEDIDO_ID,
      idContestacao: "CBK1",
      caseId: "CASE1",
      corpoDaOrder: extras.corpoDaOrder === undefined
        ? { total_amount: "19.99", transactions: { payments: [{ id: PAY, status_detail: "reimbursed" }] } }
        : extras.corpoDaOrder,
      casosNaOrder: extras.casosNaOrder ?? 1,
      pedido: pedidoDoLedger(),
      consultarCaso: () => Promise.resolve({ ok: true, caso }),
      avisar: (chave: string) => {
        avisos.push(chave);
        return Promise.resolve();
      },
    })
  );
  return { banco, avisos, desfecho };
}

Deno.test("caso conhecido: casosNaOrder chega à RPC como veio (3 fica 3) e nunca abaixo de 1", async () => {
  assertEquals((await conhecida(casoFavoravel, { casosNaOrder: 3 })).banco.chamadas[0].args.p_casos_na_order, 3);
  assertEquals((await conhecida(casoFavoravel, { casosNaOrder: 0 })).banco.chamadas[0].args.p_casos_na_order, 1);
});

Deno.test("caso conhecido: valor estimado com 2 casas (19,99), e sem order em mãos vai null", async () => {
  assertEquals((await conhecida(casoFavoravel)).banco.chamadas[0].args.p_valor_estimado, 19.99);
  assertEquals((await conhecida(casoFavoravel, { corpoDaOrder: null })).banco.chamadas[0].args.p_valor_estimado, null);
  const zerado = { total_amount: "0.00", transactions: { payments: [{ id: PAY, status_detail: "reimbursed" }] } };
  assertEquals((await conhecida(casoFavoravel, { corpoDaOrder: zerado })).banco.chamadas[0].args.p_valor_estimado, null);
});

Deno.test("caso conhecido: caso SEM coverage_applied legível CONSERVA e avisa, e a RPC nem é chamada (nunca decisão null no ledger)", async () => {
  for (const caso of [{ id: "CASE1" }, { id: "CASE1", coverage_applied: "talvez" }, { id: "CASE1", coverage_applied: 1 }]) {
    const r = await conhecida(caso);
    assertEquals(r.desfecho, "conservada", JSON.stringify(caso));
    assertEquals(r.banco.chamadas, [], JSON.stringify(caso));
    assertEquals(r.avisos, ["contestacao_indefinida:" + PEDIDO_ID + ":CBK1"]);
  }
});

Deno.test("caso conhecido: order com transactions nula ou com pagamento null na lista não derruba a conferência", async () => {
  const semTransacoes = await conhecida(casoFavoravel, { corpoDaOrder: { total_amount: "19.99", transactions: null } });
  assertEquals(semTransacoes.desfecho, "entregue");
  const comNulo = await conhecida(casoFavoravel, {
    corpoDaOrder: { total_amount: "19.99", transactions: { payments: [null, "lixo", { id: PAY, status_detail: "settled" }] } },
  });
  // O pagamento 'settled' (contra a loja) contradiz o caso 'a favor': conserva, e a RPC não é chamada.
  assertEquals(comNulo.desfecho, "conservada");
  assertEquals(comNulo.banco.chamadas, []);
});

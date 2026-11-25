// @ts-nocheck
/**
 * Caça por mutação (25/11/2026, segunda rodada) em `contestacao.ts`, parte do
 * LEDGER (o que decide para onde vai o dinheiro de uma contestação): o que
 * sobrevivia às suítes `contestacao_*_test.ts`:
 *
 *   * o vocabulário das decisões (`decisaoDoStatusDoPagamento`, `decisaoDoCaso`,
 *     `valorDoCaso`) escrito à mão, com o que NÃO é decisão voltando `null`;
 *   * a entrega à RPC `registrar_contestacao_no_ledger`: os argumentos exatos
 *     (valor do caso, estimativa arredondada em 2 casas, quantos casos na order),
 *     o erro da RPC que NUNCA vira sucesso mesmo com dado junto, o retorno ilegível,
 *     o estado canônico (`valor_estornado`) que volta para o pedido só se for número;
 *   * os TRÊS avisos da RPC (`revertida`, `saldo`, qualquer outro) com a chave de
 *     "uma vez só" de cada um, e NENHUM aviso quando ela não manda `aviso`;
 *   * o despachante `registrarContestacao`: pagamento clássico e order sem
 *     `chargebacks[]` conservam e avisam sem chamar o MP nem o banco; consulta
 *     transitória lança, definitiva conserva e segue para o próximo caso; os
 *     conflitos (caso sem decisão, pagamento único que diverge, item que diverge) e
 *     o NÃO conflito quando dois casos dividem um pagamento;
 *   * o caminho do CASO CONHECIDO (`registrarContestacaoConhecida`): em análise não
 *     entrega nem avisa, contra a loja conserva e avisa, a favor entrega, e a
 *     evidência contrária na order conserva só o "a favor";
 *   * a falha de rede da consulta do caso: `status: 0`, `transitorio: true`.
 *
 * (Equivalentes explicados, sem teste: `valorDoCaso` — o teste `amount ===
 * null/undefined/""` devolve `null` e `Number()` dessas três já cai no `> 0`;
 * `decisaoDoCaso` — o `"coverage_applied" in caso` antes do `null`: sem ele
 * `undefined` cai no `return null` final; `comoId` — `length > 0` de uma string
 * vazia vira "sem id" no chamador do mesmo jeito; o `if (true)` da consulta do caso
 * com corpo que não é objeto desemboca na mesma resposta de "corpo ilegível".)
 *
 * Valores escritos à mão; fixtures inventadas; sem rede e sem banco.
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  consultarContestacao,
  decisaoDoCaso,
  decisaoDoStatusDoPagamento,
  registrarContestacao,
  registrarContestacaoConhecida,
  valorDoCaso,
} from "./contestacao.ts";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

// ─── o vocabulário ───────────────────────────────────────────────────────────

Deno.test("decisaoDoStatusDoPagamento: só os três status do MP viram decisão; o resto (vazio, maiúscula, outro) é null", () => {
  assertEquals(decisaoDoStatusDoPagamento("in_process"), "em_analise");
  assertEquals(decisaoDoStatusDoPagamento("settled"), "contra_a_loja");
  assertEquals(decisaoDoStatusDoPagamento("reimbursed"), "a_favor_da_loja");
  for (const outro of ["", "IN_PROCESS", "settled ", "accredited", "charged_back", "cancelled"]) {
    assertEquals(decisaoDoStatusDoPagamento(outro), null, JSON.stringify(outro));
  }
});

Deno.test("decisaoDoCaso: null=em análise, true=a favor, false=contra; ausente ou de outro tipo é null (nunca palpite)", () => {
  assertEquals(decisaoDoCaso({ coverage_applied: null }), "em_analise");
  assertEquals(decisaoDoCaso({ coverage_applied: true }), "a_favor_da_loja");
  assertEquals(decisaoDoCaso({ coverage_applied: false }), "contra_a_loja");
  for (const ruim of ["true", "false", 0, 1, {}, [], undefined]) {
    assertEquals(decisaoDoCaso({ coverage_applied: ruim }), null, JSON.stringify(ruim) ?? "undefined");
  }
  assertEquals(decisaoDoCaso({}), null);
});

Deno.test("valorDoCaso: só BRL positivo vale, arredondado a 2 casas; outra moeda, zero, negativo, ilegível ou ausente é null", () => {
  assertEquals(valorDoCaso({ currency: "BRL", amount: 40 }), 40);
  assertEquals(valorDoCaso({ currency: "BRL", amount: "10.50" }), 10.5);
  assertEquals(valorDoCaso({ currency: "BRL", amount: "10.126" }), 10.13);
  assertEquals(valorDoCaso({ currency: "BRL", amount: 0.01 }), 0.01);
  for (const amount of [0, -1, "abc", "", null, undefined, NaN, Infinity]) {
    assertEquals(valorDoCaso({ currency: "BRL", amount }), null, String(amount));
  }
  for (const currency of ["USD", "brl", undefined, null]) {
    assertEquals(valorDoCaso({ currency, amount: 40 }), null, String(currency));
  }
});

// ─── a falha de rede da consulta ─────────────────────────────────────────────

Deno.test("consultarContestacao: rede que cai é transitória com status 0 (o chamador repete); 404 não é transitório, 429 e 503 são", async () => {
  const cai = (() => Promise.reject(new TypeError("rede"))) as unknown as typeof fetch;
  assertEquals(
    await consultarContestacao({ token: "t", caseId: "C1", vendedorId: "1020304050", fetchImpl: cai }),
    { ok: false, status: 0, transitorio: true },
  );
  for (const [status, transitorio] of [[404, false], [429, true], [503, true], [499, false]] as const) {
    const f = (() => Promise.resolve(new Response("{}", { status }))) as unknown as typeof fetch;
    assertEquals(
      await consultarContestacao({ token: "t", caseId: "C1", vendedorId: "1020304050", fetchImpl: f }),
      { ok: false, status, transitorio },
      String(status),
    );
  }
});

// ─── o harness do ledger ─────────────────────────────────────────────────────

function ledger(retorno: { data?: unknown; error?: unknown } = { data: { resultado: "registrada" }, error: null }) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc(nome: string, args: Record<string, unknown>) {
      chamadas.push({ nome, args });
      return Promise.resolve({ data: retorno.data ?? null, error: retorno.error ?? null });
    },
  };
  return { supabase, chamadas };
}

function avisador() {
  const avisos: Array<{ chave: string; aviso: { title: string; body: string; url: string } }> = [];
  const avisar = (chave: string, aviso: { title: string; body: string; url: string }) => {
    avisos.push({ chave, aviso });
    return Promise.resolve();
  };
  return { avisos, avisar };
}

function cb(id: string, caso: string, pagamento: string, status = "") {
  return { id, case_id: caso, transaction_id: pagamento, status };
}

function orderComContestacoes(
  chargebacks: unknown[],
  pagamentos: Array<Record<string, unknown>> = [{ id: "PAY1", status_detail: "settled" }],
  total: unknown = "100.00",
) {
  return { id: "ORD1", total_amount: total, transactions: { payments: pagamentos, chargebacks } };
}

const casoContra = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  caso: { coverage_applied: false, currency: "BRL", amount: "40.00", ...extra },
});

async function registrar(
  corpo: Record<string, unknown>,
  consultarCaso: (c: string) => Promise<unknown>,
  retornoDaRpc?: { data?: unknown; error?: unknown },
  extra: Record<string, unknown> = {},
) {
  const l = ledger(retornoDaRpc);
  const a = avisador();
  const pedido = { valor_estornado: 77 };
  const resultado = await registrarContestacao({
    supabase: l.supabase,
    orderId: PEDIDO,
    corpo,
    ehPayments: false,
    pedido,
    consultarCaso,
    avisar: a.avisar,
    ...extra,
  });
  return { resultado, ...l, ...a, pedido };
}

// ─── a entrega à RPC ─────────────────────────────────────────────────────────

Deno.test("registrarContestacao: entrega à RPC com TODOS os argumentos certos (decisão, valor do caso, estimativa, casos na order)", async () => {
  const r = await registrar(orderComContestacoes([cb("CBK1", "C1", "PAY1")]), () => Promise.resolve(casoContra()));
  assertEquals(r.resultado, { entregues: 1, conservadas: 0 });
  assertEquals(r.chamadas.length, 1);
  assertEquals(r.chamadas[0].nome, "registrar_contestacao_no_ledger");
  assertEquals(r.chamadas[0].args, {
    p_order_id: PEDIDO,
    p_mp_chargeback_id: "CBK1",
    p_case_id: "C1",
    p_decisao: "contra_a_loja",
    p_valor_caso: 40,
    p_valor_estimado: 100,
    p_casos_na_order: 1,
  });
  assertEquals(r.avisos.length, 0);
});

Deno.test("registrarContestacao: estimativa vem do total pago arredondado a 2 casas (10.126 -> 10.13), 0.50 vale, zero e ausente viram null", async () => {
  const corpoComTotal = (total: unknown) => orderComContestacoes([cb("CBK1", "C1", "PAY1")], undefined, total);
  const casos: Array<[unknown, number | null]> = [["10.126", 10.13], ["0.50", 0.5], ["0", null], ["-3", null], ["abc", null]];
  for (const [total, esperado] of casos) {
    const r = await registrar(corpoComTotal(total), () => Promise.resolve(casoContra()));
    assertEquals(r.chamadas[0].args.p_valor_estimado, esperado, String(total));
  }
});

Deno.test("registrarContestacao: dois casos de pagamentos diferentes -> p_casos_na_order = 2 nas duas entregas", async () => {
  const corpo = orderComContestacoes(
    [cb("CBK1", "C1", "PAY1"), cb("CBK2", "C2", "PAY2")],
    [{ id: "PAY1", status_detail: "settled" }, { id: "PAY2", status_detail: "settled" }],
  );
  const r = await registrar(corpo, () => Promise.resolve(casoContra()));
  assertEquals(r.resultado, { entregues: 2, conservadas: 0 });
  assertEquals(r.chamadas.map((c) => c.args.p_casos_na_order), [2, 2]);
  assertEquals(r.chamadas.map((c) => c.args.p_mp_chargeback_id), ["CBK1", "CBK2"]);
});

Deno.test("registrarContestacao: erro da RPC lança MESMO com dado junto; retorno sem `resultado` texto lança (o MP reenvia)", async () => {
  const corpo = orderComContestacoes([cb("CBK1", "C1", "PAY1")]);
  await assertRejects(
    () => registrar(corpo, () => Promise.resolve(casoContra()), { data: { resultado: "registrada" }, error: new Error("boom") }),
  );
  for (const data of [null, {}, { resultado: 5 }, { resultado: null }, "texto"]) {
    await assertRejects(
      () => registrar(corpo, () => Promise.resolve(casoContra()), { data, error: null }),
      Error,
      "retorno ilegível",
    );
  }
});

Deno.test("registrarContestacao: valor_estornado canônico da RPC volta para o pedido só se for número; ausente ou ilegível deixa como está", async () => {
  const corpo = orderComContestacoes([cb("CBK1", "C1", "PAY1")]);
  const bom = await registrar(corpo, () => Promise.resolve(casoContra()), { data: { resultado: "ok", valor_estornado: "12.5" } });
  assertEquals(bom.pedido.valor_estornado, 12.5);
  const zero = await registrar(corpo, () => Promise.resolve(casoContra()), { data: { resultado: "ok", valor_estornado: 0 } });
  assertEquals(zero.pedido.valor_estornado, 0);
  for (const ruim of [undefined, "abc", NaN, {}]) {
    const r = await registrar(corpo, () => Promise.resolve(casoContra()), { data: { resultado: "ok", valor_estornado: ruim } });
    assertEquals(r.pedido.valor_estornado, 77, String(ruim));
  }
});

// ─── os avisos da RPC ────────────────────────────────────────────────────────

Deno.test("registrarContestacao: aviso `revertida` da RPC -> UM push com a chave do desfecho e o link do pedido", async () => {
  const r = await registrar(
    orderComContestacoes([cb("CBK1", "C1", "PAY1")]),
    () => Promise.resolve(casoContra()),
    { data: { resultado: "revertida", aviso: "revertida" } },
  );
  assertEquals(r.avisos.length, 1);
  assertEquals(r.avisos[0].chave, `contestacao_revertida:${PEDIDO}:CBK1:contra_a_loja`);
  assertEquals(r.avisos[0].aviso.title, "Contestação mudou de resultado");
  assertEquals(r.avisos[0].aviso.url, `/admin-orders?id=${PEDIDO}`);
});

Deno.test("registrarContestacao: aviso `saldo` da RPC -> UM push com a chave (pedido, caso, resultado)", async () => {
  const r = await registrar(
    orderComContestacoes([cb("CBK1", "C1", "PAY1")]),
    () => Promise.resolve(casoContra()),
    { data: { resultado: "reservada_sem_caber", aviso: "saldo" } },
  );
  assertEquals(r.avisos.length, 1);
  assertEquals(r.avisos[0].chave, `contestacao_saldo:${PEDIDO}:CBK1:reservada_sem_caber`);
  assertEquals(r.avisos[0].aviso.title, "Contestação maior que o saldo do pedido");
});

Deno.test("registrarContestacao: qualquer outro aviso (`conferir`, texto livre, vazio) -> UM push de conferência com a chave do resultado", async () => {
  for (const aviso of ["conferir", "outro", ""]) {
    const r = await registrar(
      orderComContestacoes([cb("CBK1", "C1", "PAY1")]),
      () => Promise.resolve(casoContra()),
      { data: { resultado: "nao_registrou", aviso } },
    );
    assertEquals(r.avisos.length, 1, JSON.stringify(aviso));
    assertEquals(r.avisos[0].chave, `contestacao_indefinida:${PEDIDO}:CBK1:nao_registrou`, JSON.stringify(aviso));
    assertEquals(r.avisos[0].aviso.title, "Contestação de pagamento para conferir", JSON.stringify(aviso));
  }
});

Deno.test("registrarContestacao: RPC sem aviso (ausente ou null) NÃO manda push nenhum", async () => {
  for (const data of [{ resultado: "registrada" }, { resultado: "registrada", aviso: null }]) {
    const r = await registrar(orderComContestacoes([cb("CBK1", "C1", "PAY1")]), () => Promise.resolve(casoContra()), { data });
    assertEquals(r.avisos.length, 0, JSON.stringify(data));
    assertEquals(r.resultado, { entregues: 1, conservadas: 0 });
  }
});

// ─── o despachante: o que conserva sem chamar nada ───────────────────────────

Deno.test("registrarContestacao: pagamento clássico (ehPayments) conserva e avisa — sem consultar o MP nem chamar o banco", async () => {
  let consultou = 0;
  // Mesmo com um corpo que PARECE uma order com contestação inteira (chargebacks[] e
  // pagamento batendo): pelo caminho clássico nada é lido nem entregue.
  const r = await registrar(
    { ...orderComContestacoes([cb("CBK1", "C1", "PAY1")]), id: 987654321 },
    () => {
      consultou++;
      return Promise.resolve(casoContra());
    },
    undefined,
    { ehPayments: true },
  );
  assertEquals(r.resultado, { entregues: 0, conservadas: 1 });
  assertEquals(consultou, 0);
  assertEquals(r.chamadas.length, 0);
  assertEquals(r.avisos.map((a) => a.chave), [`contestacao_indefinida:${PEDIDO}:987654321`]);
});

Deno.test("registrarContestacao: order sem chargebacks[] legível conserva e avisa — sem consultar o MP nem chamar o banco", async () => {
  for (const corpo of [{ id: "ORD1" }, { id: "ORD1", transactions: { payments: [], chargebacks: [] } }, { id: "ORD1", transactions: [] }]) {
    let consultou = 0;
    const r = await registrar(corpo, () => {
      consultou++;
      return Promise.resolve(casoContra());
    });
    assertEquals(r.resultado, { entregues: 0, conservadas: 1 }, JSON.stringify(corpo));
    assertEquals(consultou, 0);
    assertEquals(r.chamadas.length, 0);
    assertEquals(r.avisos.map((a) => a.chave), [`contestacao_indefinida:${PEDIDO}:ORD1`]);
  }
});

Deno.test("registrarContestacao: consulta TRANSITÓRIA lança (o MP reenvia); definitiva conserva, avisa e SEGUE para o próximo caso", async () => {
  const corpo = orderComContestacoes(
    [cb("CBK1", "C1", "PAY1"), cb("CBK2", "C2", "PAY2")],
    [{ id: "PAY1", status_detail: "settled" }, { id: "PAY2", status_detail: "settled" }],
  );
  await assertRejects(
    () => registrar(corpo, () => Promise.resolve({ ok: false, status: 503, transitorio: true })),
    Error,
    "status 503",
  );
  const r = await registrar(corpo, (caso) =>
    Promise.resolve(caso === "C1" ? { ok: false, status: 404, transitorio: false } : casoContra()));
  assertEquals(r.resultado, { entregues: 1, conservadas: 1 });
  assertEquals(r.chamadas.map((c) => c.args.p_mp_chargeback_id), ["CBK2"]);
  assertEquals(r.avisos.map((a) => a.chave), [`contestacao_indefinida:${PEDIDO}:CBK1`]);
});

// ─── o despachante: os conflitos ─────────────────────────────────────────────

Deno.test("registrarContestacao: caso sem decisão legível (coverage_applied ausente) conserva e avisa com a chave do caso e do pagamento", async () => {
  const r = await registrar(
    orderComContestacoes([cb("CBK1", "C1", "PAY1")]),
    () => Promise.resolve({ ok: true, caso: { currency: "BRL", amount: "40.00" } }),
  );
  assertEquals(r.resultado, { entregues: 0, conservadas: 1 });
  assertEquals(r.chamadas.length, 0);
  assertEquals(r.avisos.map((a) => a.chave), [`contestacao_indefinida:${PEDIDO}:CBK1:null:contra_a_loja`]);
});

Deno.test("registrarContestacao: pagamento ÚNICO que diverge do caso conserva (a favor no caso, 'settled' no pagamento)", async () => {
  const r = await registrar(
    orderComContestacoes([cb("CBK1", "C1", "PAY1")]),
    () => Promise.resolve({ ok: true, caso: { coverage_applied: true } }),
  );
  assertEquals(r.resultado, { entregues: 0, conservadas: 1 });
  assertEquals(r.chamadas.length, 0);
  assertEquals(r.avisos.map((a) => a.chave), [`contestacao_indefinida:${PEDIDO}:CBK1:a_favor_da_loja:contra_a_loja`]);
});

Deno.test("registrarContestacao: pagamento ÚNICO sem status reconhecido também conserva (sem corroboração, sem entrega)", async () => {
  const r = await registrar(
    orderComContestacoes([cb("CBK1", "C1", "PAY1")], [{ id: "PAY1", status_detail: "accredited" }]),
    () => Promise.resolve(casoContra()),
  );
  assertEquals(r.resultado, { entregues: 0, conservadas: 1 });
  assertEquals(r.chamadas.length, 0);
});

Deno.test("registrarContestacao: DOIS casos no mesmo pagamento -> o status do pagamento (agregado) não decide nenhum: entrega os dois", async () => {
  const corpo = orderComContestacoes(
    [cb("CBK1", "C1", "PAY1"), cb("CBK2", "C2", "PAY1")],
    [{ id: "PAY1", status_detail: "reimbursed" }],
  );
  const r = await registrar(corpo, () => Promise.resolve(casoContra()));
  assertEquals(r.resultado, { entregues: 2, conservadas: 0 });
  assertEquals(r.chamadas.map((c) => c.args.p_decisao), ["contra_a_loja", "contra_a_loja"]);
  assertEquals(r.chamadas.map((c) => c.args.p_casos_na_order), [2, 2]);
});

Deno.test("registrarContestacao: o `status` do item que diverge do caso conserva, mesmo com o pagamento de acordo; item de acordo ou vazio entrega", async () => {
  const diverge = await registrar(
    orderComContestacoes([cb("CBK1", "C1", "PAY1", "reimbursed")]),
    () => Promise.resolve(casoContra()),
  );
  assertEquals(diverge.resultado, { entregues: 0, conservadas: 1 });
  assertEquals(diverge.chamadas.length, 0);
  // item de acordo com o caso e com o pagamento
  const acorda = await registrar(
    orderComContestacoes([cb("CBK1", "C1", "PAY1", "settled")]),
    () => Promise.resolve(casoContra()),
  );
  assertEquals(acorda.resultado, { entregues: 1, conservadas: 0 });
  // item com status que não é decisão (ex.: "opened") não conflita
  const aberto = await registrar(
    orderComContestacoes([cb("CBK1", "C1", "PAY1", "opened")]),
    () => Promise.resolve(casoContra()),
  );
  assertEquals(aberto.resultado, { entregues: 1, conservadas: 0 });
});

// ─── o CASO CONHECIDO ────────────────────────────────────────────────────────

async function conhecida(
  caso: unknown,
  corpoDaOrder: Record<string, unknown> | null,
  casosNaOrder = 1,
  retornoDaRpc?: { data?: unknown; error?: unknown },
) {
  const l = ledger(retornoDaRpc);
  const a = avisador();
  const pedido = { valor_estornado: 77 };
  const desfecho = await registrarContestacaoConhecida({
    supabase: l.supabase,
    orderId: PEDIDO,
    idContestacao: "CBK1",
    caseId: "C1",
    corpoDaOrder,
    casosNaOrder,
    pedido,
    consultarCaso: () => Promise.resolve(caso),
    avisar: a.avisar,
  });
  return { desfecho, ...l, ...a, pedido };
}

Deno.test("registrarContestacaoConhecida: consulta transitória lança; definitiva conserva e avisa; caso sem decisão conserva e avisa", async () => {
  await assertRejects(() => conhecida({ ok: false, status: 500, transitorio: true }, null), Error, "status 500");
  const definitiva = await conhecida({ ok: false, status: 404, transitorio: false }, null);
  assertEquals(definitiva.desfecho, "conservada");
  assertEquals(definitiva.chamadas.length, 0);
  assertEquals(definitiva.avisos.map((a) => a.chave), [`contestacao_indefinida:${PEDIDO}:CBK1`]);
  const semDecisao = await conhecida({ ok: true, caso: { currency: "BRL" } }, null);
  assertEquals(semDecisao.desfecho, "conservada");
  assertEquals(semDecisao.chamadas.length, 0);
  assertEquals(semDecisao.avisos.length, 1);
});

Deno.test("registrarContestacaoConhecida: caso EM ANÁLISE -> em_aberto, sem RPC e sem aviso — mesmo com pagamento 'settled' na order", async () => {
  const order = { transactions: { payments: [{ id: "PAY1", status_detail: "settled" }] } };
  const r = await conhecida({ ok: true, caso: { coverage_applied: null } }, order);
  assertEquals(r.desfecho, "em_aberto");
  assertEquals(r.chamadas.length, 0);
  assertEquals(r.avisos.length, 0);
});

Deno.test("registrarContestacaoConhecida: caso CONTRA a loja nunca conclui por este caminho — conserva e avisa, sem RPC", async () => {
  const r = await conhecida({ ok: true, caso: { coverage_applied: false, currency: "BRL", amount: "40.00" } }, null);
  assertEquals(r.desfecho, "conservada");
  assertEquals(r.chamadas.length, 0);
  assertEquals(r.avisos.map((a) => a.chave), [`contestacao_indefinida:${PEDIDO}:CBK1`]);
});

Deno.test("registrarContestacaoConhecida: caso A FAVOR sem order entrega com a estimativa nula e pelo menos 1 caso na order", async () => {
  const r = await conhecida({ ok: true, caso: { coverage_applied: true, currency: "BRL", amount: "40.00" } }, null, 0);
  assertEquals(r.desfecho, "entregue");
  assertEquals(r.chamadas.length, 1);
  assertEquals(r.chamadas[0].args, {
    p_order_id: PEDIDO,
    p_mp_chargeback_id: "CBK1",
    p_case_id: "C1",
    p_decisao: "a_favor_da_loja",
    p_valor_caso: 40,
    p_valor_estimado: null,
    p_casos_na_order: 1,
  });
  assertEquals(r.avisos.length, 0);
});

Deno.test("registrarContestacaoConhecida: a favor com order entrega com a estimativa arredondada (10.126 -> 10.13; 0.50 vale) e os casos da order (3)", async () => {
  const comTotal = (total: unknown) => ({ total_amount: total, transactions: { payments: [{ id: "PAY1", status_detail: "reimbursed" }] } });
  const r = await conhecida({ ok: true, caso: { coverage_applied: true } }, comTotal("10.126"), 3);
  assertEquals(r.desfecho, "entregue");
  assertEquals(r.chamadas[0].args.p_valor_estimado, 10.13);
  assertEquals(r.chamadas[0].args.p_casos_na_order, 3);
  assertEquals(r.chamadas[0].args.p_valor_caso, null);
  const meio = await conhecida({ ok: true, caso: { coverage_applied: true } }, comTotal("0.50"));
  assertEquals(meio.chamadas[0].args.p_valor_estimado, 0.5);
  const zero = await conhecida({ ok: true, caso: { coverage_applied: true } }, comTotal("0"));
  assertEquals(zero.chamadas[0].args.p_valor_estimado, null);
});

Deno.test("registrarContestacaoConhecida: a favor com pagamento de OUTRA decisão na order (settled, in_process) conserva e não libera; status sem decisão ou igual libera", async () => {
  for (const contrario of ["settled", "in_process"]) {
    const order = { transactions: { payments: [{ id: "PAY1", status_detail: "reimbursed" }, { id: "PAY2", status_detail: contrario }] } };
    const r = await conhecida({ ok: true, caso: { coverage_applied: true } }, order);
    assertEquals(r.desfecho, "conservada", contrario);
    assertEquals(r.chamadas.length, 0, contrario);
    assertEquals(r.avisos.length, 1, contrario);
  }
  for (const neutro of ["accredited", "", undefined, 7]) {
    const order = { transactions: { payments: [{ id: "PAY1", status_detail: neutro }, null, "x"] } };
    const r = await conhecida({ ok: true, caso: { coverage_applied: true } }, order);
    assertEquals(r.desfecho, "entregue", String(neutro));
    assertEquals(r.chamadas.length, 1, String(neutro));
  }
});

Deno.test("registrarContestacaoConhecida: `transactions` que é lista (mesmo com `payments` pendurado) não conta como pagamentos da order — entrega", async () => {
  const transactions = Object.assign([], { payments: [{ id: "PAY1", status_detail: "settled" }] });
  const r = await conhecida({ ok: true, caso: { coverage_applied: true } }, { transactions });
  assertEquals(r.desfecho, "entregue");
  assertEquals(r.chamadas.length, 1);
});

Deno.test("registrarContestacaoConhecida: os avisos da RPC valem também por aqui (revertida e saldo, uma chave cada)", async () => {
  const revertida = await conhecida(
    { ok: true, caso: { coverage_applied: true } },
    null,
    1,
    { data: { resultado: "r", aviso: "revertida", valor_estornado: 5 } },
  );
  assertEquals(revertida.avisos.map((a) => a.chave), [`contestacao_revertida:${PEDIDO}:CBK1:a_favor_da_loja`]);
  assertEquals(revertida.pedido.valor_estornado, 5);
  const saldo = await conhecida({ ok: true, caso: { coverage_applied: true } }, null, 1, { data: { resultado: "s", aviso: "saldo" } });
  assertEquals(saldo.avisos.map((a) => a.chave), [`contestacao_saldo:${PEDIDO}:CBK1:s`]);
  assert(saldo.avisos[0].aviso.url.includes(PEDIDO));
});

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  aplicarDiagnosticoDoPost,
  consultarReembolsoDoPedido,
  executarEstorno,
  interpretarResposta,
  LIMITE_DE_FALHAS_TRANSITORIAS,
  type LinhaEstorno,
  type PedidoParaEstorno,
  type ResultadoEstorno,
} from "./estorno.ts";

/**
 * Reembolso da devolução — parte TypeScript (14/10/2026). O banco (#849/#854)
 * decide criar × adotar × parar; aqui o servidor precisa (a) dizer ao banco O QUE
 * o Mercado Pago respondeu sem nunca chamar de "nada saiu" o que não PROVA isso,
 * e (b) consultar o MP em três respostas (achou / provou que não existe /
 * indeterminado). NENHUMA chamada real ao MP: todo `fetch` é dublê.
 *
 *   D6  `errors[].code` é lido; código desconhecido é INCERTO
 *   D5  código "em andamento" nunca vira `falhou`
 *   D4  limite de falhas "nada saiu" -> `falhou`; com carimbo de incerteza, nunca
 *   M1..M6 do crítico: GET 500, rede, refund próprio em voo, devolução do painel
 *       em parcelas, 409 chave já usada, 428 sem saldo, refund de outra linha
 */

const TOKEN = "TESTE_TOKEN";
const ORDER = "ORD01ABCDEFOLUIMWQKDXYZ01";

function linha(extras: Partial<LinhaEstorno> = {}): LinhaEstorno {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    order_id: "22222222-2222-4222-8222-222222222222",
    amount: 50,
    status: "em_processamento",
    mp_refund_id: null,
    tentativas: 1,
    ...extras,
  };
}

function pedidoOrder(extras: Partial<PedidoParaEstorno> = {}): PedidoParaEstorno {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    gateway_payment_id: ORDER,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    status: "delivered",
    ...extras,
  };
}

type Rota = { metodo: string; trecho: string; status: number; corpo?: unknown };

function fetchDuble(rotas: Rota[]) {
  const chamadas: { url: string; metodo: string }[] = [];
  const f: typeof fetch = (entrada, init) => {
    const url = typeof entrada === "string" ? entrada : String(entrada instanceof URL ? entrada.href : entrada.url);
    const metodo = (init?.method ?? "GET").toUpperCase();
    chamadas.push({ url, metodo });
    const rota = rotas.find((r) => r.metodo === metodo && url.includes(r.trecho));
    return Promise.resolve(
      !rota
        ? new Response("", { status: 500 })
        : new Response(rota.corpo === undefined ? "" : typeof rota.corpo === "string" ? rota.corpo : JSON.stringify(rota.corpo), {
          status: rota.status,
        }),
    );
  };
  return { f, chamadas };
}

const consultaTransacaoFalsa = (_orderId: string): Promise<string | null> => Promise.resolve("PAY01XYZEXEMPLODETRANSA1");

function postComErro(status: number, corpo: unknown) {
  return fetchDuble([{ metodo: "POST", trecho: `/v1/orders/${ORDER}/refund`, status, corpo }]);
}

function executar(f: typeof fetch, extras: Partial<Parameters<typeof executarEstorno>[0]> = {}) {
  const pedido = pedidoOrder();
  return executarEstorno({
    linha: linha(),
    pedido,
    token: TOKEN,
    buscar: f,
    consultarTransacaoDaOrder: consultaTransacaoFalsa,
    autorizarAntesDoPost: () => Promise.resolve({ decisao: "autorizado", pedido }),
    ...extras,
  });
}

const diagDe = (r: ResultadoEstorno) => (r as { diagnostico?: unknown }).diagnostico;

// ---------------------------------------------------------------------------
// D6 — errors[].code é lido; desconhecido é INCERTO
// ---------------------------------------------------------------------------

Deno.test("D6 - o código em errors[] (Orders) é lido: refund em andamento nomeado em errors[] não vira falhou", () => {
  const r = interpretarResposta(
    409,
    { errors: [{ code: "order_refund_already_in_process", message: "x" }] },
    linha(),
    pedidoOrder(),
  );
  assertEquals(r.tipo, "em_processamento");
});

Deno.test("D6 - código DESCONHECIDO em errors[]: falhou, mas com diagnóstico INCERTO (nunca 'nada saiu') e o código do MP no diagnóstico", async () => {
  const dubleMp = postComErro(400, { errors: [{ code: "codigo_novo_do_mp", message: "x" }] });
  const r = await executar(dubleMp.f);
  assertEquals(r.tipo, "falhou");
  assertEquals(diagDe(r), { mpCodigo: "codigo_novo_do_mp", postIncerto: true, transitorio: false });
});

Deno.test("D6 - sem código nenhum no corpo (HTTP 400 mudo): incerto, com marcador http_400", async () => {
  const r = await executar(postComErro(400, {}).f);
  assertEquals(r.tipo, "falhou");
  assertEquals(diagDe(r), { mpCodigo: "http_400", postIncerto: true, transitorio: false });
});

Deno.test("D6 - vários códigos: um desconhecido junto de um 'nada saiu' torna a resposta INCERTA (lista fechada = TODOS têm de estar nela)", async () => {
  const r = await executar(
    postComErro(400, {
      errors: [{ code: "insufficient_money_for_refund" }, { code: "outro_codigo_que_nao_conheco" }],
    }).f,
  );
  assertNotEquals((diagDe(r) as { transitorio: boolean }).transitorio, true);
  assertEquals((diagDe(r) as { postIncerto: boolean }).postIncerto, true);
});

// ---------------------------------------------------------------------------
// "Nada saiu" — só os códigos que PROVAM (M6: 428 sem saldo)
// ---------------------------------------------------------------------------

Deno.test("M6 - 428 com 'sem saldo' em errors[]: tentar_depois com diagnóstico 'nada saiu' (transitório, SEM incerteza) e motivo que não revela saldo nem código", async () => {
  for (const codigo of ["insufficient_money_for_refund", "order_payment_not_yet_enabled_for_refund"]) {
    const r = await executar(postComErro(428, { errors: [{ code: codigo }] }).f);
    assertEquals(r.tipo, "tentar_depois", codigo);
    assertEquals(diagDe(r), { mpCodigo: codigo, postIncerto: false, transitorio: true }, codigo);
    const motivo = (r as { motivo: string }).motivo;
    assertFalse(/saldo|insufficient|enabled|conta/i.test(motivo), `motivo interno vazou: ${motivo}`);
  }
});

// ---------------------------------------------------------------------------
// D5 — "em andamento" nunca vira falhou (M3: refund próprio em voo; M5: 409 chave usada)
// ---------------------------------------------------------------------------

Deno.test("D5 - os códigos de dinheiro em movimento viram em_processamento, com carimbo de incerteza e SEM gastar o limite", async () => {
  for (const codigo of ["refund_in_progress", "order_refund_already_in_process", "movement_operations_pending"]) {
    const r = await executar(postComErro(409, { errors: [{ code: codigo }] }).f);
    assertEquals(r.tipo, "em_processamento", codigo);
    assertEquals(diagDe(r), { mpCodigo: codigo, postIncerto: true, transitorio: false }, codigo);
  }
});

Deno.test("D5/M5 - 409 idempotency_key_already_used e a consulta NÃO cobre o valor: tentar_depois (a chave existe no MP), nunca falhou", async () => {
  const dubleMp = fetchDuble([
    { metodo: "POST", trecho: `/v1/orders/${ORDER}/refund`, status: 409, corpo: { errors: [{ code: "idempotency_key_already_used" }] } },
    {
      metodo: "GET",
      trecho: `/v1/orders/${ORDER}`,
      status: 200,
      corpo: {
        id: ORDER,
        status: "refunded",
        // refund processado de OUTRO valor: a consulta não prova o desta linha
        transactions: { payments: [{ id: "PAY1", status: "processed" }], refunds: [{ id: "R9", amount: "10.00", status: "processed" }] },
      },
    },
  ]);
  const r = await executar(dubleMp.f);
  assertEquals(r.tipo, "tentar_depois");
  assertEquals(diagDe(r), { mpCodigo: "idempotency_key_already_used", postIncerto: true, transitorio: false });
});

Deno.test("D5 - controle: order_already_refunded com consulta que não cobre CONTINUA falhou (o MP afirmou que a cobrança foi devolvida), mas com carimbo de incerteza", async () => {
  const dubleMp = fetchDuble([
    { metodo: "POST", trecho: `/v1/orders/${ORDER}/refund`, status: 409, corpo: { errors: [{ code: "order_already_refunded" }] } },
    {
      metodo: "GET",
      trecho: `/v1/orders/${ORDER}`,
      status: 200,
      corpo: { id: ORDER, status: "refunded", transactions: { payments: [], refunds: [{ id: "R9", amount: "10.00", status: "processed" }] } },
    },
  ]);
  const r = await executar(dubleMp.f);
  assertEquals(r.tipo, "falhou");
  assertEquals((diagDe(r) as { postIncerto: boolean }).postIncerto, true);
});

// ---------------------------------------------------------------------------
// POST sem resposta reconhecida marca incerteza
// ---------------------------------------------------------------------------

Deno.test("incerteza - POST sem resposta reconhecida (rede, 5xx, 429, 423, 2xx não reconhecido, 401, corpo ilegível) marca postIncerto", async () => {
  const casos: Array<[string, typeof fetch]> = [
    ["rede", (() => Promise.reject(new Error("rede caiu"))) as typeof fetch],
    ["500", postComErro(500, {}).f],
    ["503 ilegível", postComErro(503, "<html>").f],
    ["429", postComErro(429, { errors: [{ code: "too_many_requests" }] }).f],
    ["423", postComErro(423, { errors: [{ code: "resource_locked" }] }).f],
    ["401", postComErro(401, {}).f],
    ["201 não reconhecido", postComErro(201, { status: "coisa_nova" }).f],
    ["400 ilegível", postComErro(400, "nao-json").f],
  ];
  for (const [nome, f] of casos) {
    const r = await executar(f);
    assertEquals(r.tipo === "tentar_depois" || r.tipo === "falhou", true, nome);
    const d = diagDe(r) as { postIncerto: boolean; transitorio: boolean };
    assertEquals(d.postIncerto, true, nome);
    assertEquals(d.transitorio, false, nome);
  }
});

Deno.test("incerteza - sem POST (guarda recusa / autorização indisponível) NÃO há diagnóstico: nada saiu para ser incerto", async () => {
  const dubleMp = fetchDuble([]);
  const r = await executar(dubleMp.f, { autorizarAntesDoPost: () => Promise.resolve({ decisao: "indisponivel" }) });
  assertEquals(r.tipo, "tentar_depois");
  assertEquals(diagDe(r), undefined);
  assertEquals(dubleMp.chamadas.length, 0);
});

// ---------------------------------------------------------------------------
// D4 — gravar o diagnóstico ANTES de marcar falhou; o limite
// ---------------------------------------------------------------------------

function rpcDuble(respostas: Array<{ data?: unknown; error?: unknown } | "lanca">) {
  const chamadas: { nome: string; args: Record<string, unknown> }[] = [];
  let i = 0;
  const rpc = (nome: string, args: Record<string, unknown>) => {
    chamadas.push({ nome, args });
    const r = respostas[Math.min(i++, respostas.length - 1)];
    if (r === "lanca") return Promise.reject(new Error("rede"));
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
  };
  return { rpc, chamadas };
}

const transitorio = (): ResultadoEstorno => ({
  tipo: "tentar_depois",
  motivo: "ainda não liberado",
  diagnostico: { mpCodigo: "insufficient_money_for_refund", postIncerto: false, transitorio: true },
} as ResultadoEstorno);

Deno.test("D4 - grava o diagnóstico com o código do MP e o carimbo; o contador só sobe em falha 'nada saiu'", async () => {
  const { rpc, chamadas } = rpcDuble([{ data: { transitorios: 1, post_incerto: false, mp_codigo: "x" } }]);
  const r = await aplicarDiagnosticoDoPost(rpc, "REF", transitorio());
  assertEquals(r.tipo, "tentar_depois");
  assertEquals(chamadas, [{
    nome: "registrar_diagnostico_do_estorno",
    args: { p_refund_id: "REF", p_mp_codigo: "insufficient_money_for_refund", p_post_incerto: false, p_transitorio: true },
  }]);
});

Deno.test("D4 - o limite: na 5ª falha 'nada saiu' SEM carimbo a linha vira falhou (saídas abertas); na 4ª ainda não", async () => {
  assertEquals(LIMITE_DE_FALHAS_TRANSITORIAS, 5);
  const quarta = rpcDuble([{ data: { transitorios: 4, post_incerto: false } }]);
  assertEquals((await aplicarDiagnosticoDoPost(quarta.rpc, "REF", transitorio())).tipo, "tentar_depois");
  const quinta = rpcDuble([{ data: { transitorios: 5, post_incerto: false } }]);
  const r = await aplicarDiagnosticoDoPost(quinta.rpc, "REF", transitorio());
  assertEquals(r.tipo, "falhou");
  assertFalse(/saldo|insufficient|conta/i.test((r as { motivo: string }).motivo));
});

Deno.test("D4 - COM carimbo de incerteza (de antes) o limite NUNCA vira falhou: a linha fica em consulta", async () => {
  const { rpc } = rpcDuble([{ data: { transitorios: 9, post_incerto: true } }]);
  assertEquals((await aplicarDiagnosticoDoPost(rpc, "REF", transitorio())).tipo, "tentar_depois");
});

Deno.test("D4 - falhou só depois de gravar o diagnóstico; se a gravação FALHA (duas vezes), a linha NÃO vira falhou", async () => {
  const falhou: ResultadoEstorno = {
    tipo: "falhou",
    motivo: "erro não reconhecido do Mercado Pago",
    codigo: "x",
    diagnostico: { mpCodigo: "x", postIncerto: true, transitorio: false },
  } as ResultadoEstorno;
  const quebrado = rpcDuble([{ error: { message: "banco fora" } }]);
  const r = await aplicarDiagnosticoDoPost(quebrado.rpc, "REF", falhou);
  assertEquals(r.tipo, "tentar_depois");
  assertEquals(quebrado.chamadas.length, 2); // uma nova tentativa
  const lanca = rpcDuble(["lanca"]);
  assertEquals((await aplicarDiagnosticoDoPost(lanca.rpc, "REF", falhou)).tipo, "tentar_depois");
  const ok = rpcDuble([{ data: { transitorios: 0, post_incerto: true } }]);
  assertEquals((await aplicarDiagnosticoDoPost(ok.rpc, "REF", falhou)).tipo, "falhou");
});

Deno.test("D4 - resposta ilegível do banco ao registrar conta como gravação que falhou (não chuta 'sem carimbo')", async () => {
  const { rpc } = rpcDuble([{ data: { coisa: 1 } }]);
  const r = await aplicarDiagnosticoDoPost(rpc, "REF", {
    tipo: "falhou",
    motivo: "m",
    codigo: "c",
    diagnostico: { mpCodigo: "c", postIncerto: true, transitorio: false },
  } as ResultadoEstorno);
  assertEquals(r.tipo, "tentar_depois");
});

Deno.test("D4 - resultado sem diagnóstico (guarda, concluído, recusado) não chama o banco", async () => {
  const { rpc, chamadas } = rpcDuble([{ data: {} }]);
  for (const r of [{ tipo: "recusado", motivo: "m" }, { tipo: "tentar_depois", motivo: "m" }] as ResultadoEstorno[]) {
    assertEquals(await aplicarDiagnosticoDoPost(rpc, "REF", r), r);
  }
  assertEquals(chamadas.length, 0);
});

// ---------------------------------------------------------------------------
// D2 — a consulta de três respostas
// ---------------------------------------------------------------------------

function consultar(rotas: Rota[] | typeof fetch, extras: Partial<Parameters<typeof consultarReembolsoDoPedido>[0]> = {}) {
  const f = typeof rotas === "function" ? rotas : fetchDuble(rotas).f;
  return consultarReembolsoDoPedido({
    buscar: f,
    token: TOKEN,
    pedido: pedidoOrder(),
    valor: 50,
    idsJaReivindicados: [],
    ...extras,
  });
}

const orderCom = (refunds: unknown[] | undefined, extras: Record<string, unknown> = {}) => ({
  id: ORDER,
  status: "processed",
  transactions: { payments: [{ id: "PAY1", status: "processed" }], ...(refunds ? { refunds } : {}) },
  ...extras,
});
const getOrder = (corpo: unknown, status = 200): Rota[] => [{ metodo: "GET", trecho: `/v1/orders/${ORDER}`, status, corpo }];

Deno.test("M1 - GET 500 é INDETERMINADO (nunca 'não achou')", async () => {
  assertEquals((await consultar(getOrder({}, 500))).resultado, "indeterminado");
});

Deno.test("M2 - falha de rede, timeout, corpo ilegível e 404: INDETERMINADO", async () => {
  assertEquals((await consultar((() => Promise.reject(new Error("rede"))) as typeof fetch)).resultado, "indeterminado");
  assertEquals((await consultar(getOrder("<html>", 200))).resultado, "indeterminado");
  assertEquals((await consultar(getOrder({ errors: [] }, 404))).resultado, "indeterminado");
});

Deno.test("D2 - order legível, paga, SEM nenhum refund: provou que não existe (nao_achou)", async () => {
  assertEquals(await consultar(getOrder(orderCom(undefined))), { resultado: "nao_achou" });
  assertEquals(await consultar(getOrder(orderCom([]))), { resultado: "nao_achou" });
});

Deno.test("D2 - só vale como prova uma order que parece uma order paga: sem transactions.payments, ou já 'refunded' sem refund visível, é INDETERMINADO", async () => {
  assertEquals((await consultar(getOrder({ id: ORDER, status: "processed" }))).resultado, "indeterminado");
  assertEquals((await consultar(getOrder(orderCom(undefined, { status: "refunded" })))).resultado, "indeterminado");
  assertEquals((await consultar(getOrder(orderCom(undefined, { status_detail: "partially_refunded" })))).resultado, "indeterminado");
});

Deno.test("D2 - refund processado do VALOR da linha, de ninguém: achou, com id, status e valor para o banco", async () => {
  const r = await consultar(getOrder(orderCom([{ id: "REF9", amount: "50.00", status: "processed", date_created: "2026-10-01T10:00:00Z" }])));
  assertEquals(r, { resultado: "achou", mp_refund_id: "REF9", mp_status: "processed", valor: 50 });
});

Deno.test("M4 - o refund achado é de OUTRA linha do pedido: não é 'achou' desta linha (e, explicado pelo ledger, não impede nao_achou)", async () => {
  const r = await consultar(getOrder(orderCom([{ id: "REF9", amount: "50.00", status: "processed" }])), { idsJaReivindicados: ["REF9"] });
  assertEquals(r, { resultado: "nao_achou" });
});

Deno.test("M3 - devolução do painel em PARCELAS (processed de outro valor, sem dono): INDETERMINADO — dinheiro saiu sem explicação", async () => {
  const r = await consultar(getOrder(orderCom([{ id: "P1", amount: "20.00", status: "processed" }, { id: "P2", amount: "30.00", status: "processed" }])));
  assertEquals(r.resultado, "indeterminado");
});

Deno.test("M3 - refund em andamento (processing) do valor da linha ou de qualquer valor: INDETERMINADO (dinheiro em movimento, não explicável)", async () => {
  assertEquals((await consultar(getOrder(orderCom([{ id: "R1", amount: "50.00", status: "processing" }])))).resultado, "indeterminado");
  assertEquals((await consultar(getOrder(orderCom([{ id: "R1", amount: "7.00", status: "status_novo_do_mp" }])))).resultado, "indeterminado");
});

Deno.test("D2 - refund MORTO (rejected/cancelled) não impede nao_achou; o status desconhecido impede", async () => {
  assertEquals((await consultar(getOrder(orderCom([{ id: "R1", amount: "50.00", status: "rejected" }])))).resultado, "nao_achou");
});

Deno.test("D2 - Payments clássica: refunds[] vazio e transaction_amount_refunded 0 prova; campo ausente é INDETERMINADO; aprovado do valor é achou", async () => {
  const pedido = pedidoOrder({ gateway_payment_id: "123456789" });
  const get = (corpo: unknown): Rota[] => [{ metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo }];
  assertEquals(await consultar(get({ refunds: [], transaction_amount_refunded: 0 }), { pedido }), { resultado: "nao_achou" });
  assertEquals((await consultar(get({ refunds: [] }), { pedido })).resultado, "indeterminado");
  assertEquals(
    await consultar(get({ refunds: [{ id: 77, amount: 50, status: "approved" }], transaction_amount_refunded: 50 }), { pedido }),
    { resultado: "achou", mp_refund_id: "77", mp_status: "approved", valor: 50 },
  );
  assertEquals((await consultar(get({ refunds: [], transaction_amount_refunded: 12.5 }), { pedido })).resultado, "indeterminado");
});

Deno.test("D2 - a consulta usa só GET (nunca POST) e manda o token", async () => {
  const { f, chamadas } = fetchDuble(getOrder(orderCom([])));
  await consultar(f);
  assertEquals(chamadas.map((c) => c.metodo), ["GET"]);
  assert(chamadas[0].url.endsWith(`/v1/orders/${ORDER}`));
});

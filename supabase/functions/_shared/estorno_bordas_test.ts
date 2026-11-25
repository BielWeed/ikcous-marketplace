// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `estorno.ts` — a regra do dinheiro que
 * VOLTA para a cliente. 73 dos 351 mutantes sobreviviam à suíte (`estorno_test`,
 * `_incerteza`, `_prazo_de_180_dias_exato`, `_reenvio`); a maioria era `??`
 * trocado por `||` ou `null` por `undefined` em lugar onde nada muda, mas
 * estes mudavam o comportamento e viram os casos abaixo. O que cada grupo
 * guarda:
 *
 *   * GUARDA: `paid_at` ILEGÍVEL recusa (sem isso, uma data corrompida deixaria
 *     devolver dinheiro de um pagamento de qualquer idade);
 *   * HTTP 500 e 400 no POST do estorno (Orders): 500 é "não sei se saiu" —
 *     `tentar_depois`, nunca `falhou` (falhou libera o valor para tentar de novo
 *     e a cliente receberia em dobro); 400 com código "em andamento" continua
 *     `em_processamento`;
 *   * AUTORIZAÇÃO do banco: o pedido que o banco devolve só vale com id, id do
 *     gateway, status e totais LEGÍVEIS (texto numérico vale, texto vazio não);
 *   * DIAGNÓSTICO: resultado sem diagnóstico nunca chama o banco; sem código do
 *     MP o limite de falhas grava "nada_saiu";
 *   * CONCLUSÃO pela consulta: lista de refunds com lixo (`null`, texto), refund
 *     SEM id, valor ILEGÍVEL entre os processados (soma não confiável = "não
 *     sei"), empate de refunds iguais (o primeiro vence, sempre o mesmo);
 *   * REEMISSÃO: corpo da consulta `null`/lista/texto é "indeterminado" sem
 *     lançar, e "consta devolvida mas nenhum refund aparece" só vale com
 *     NENHUM refund `processed`;
 *   * TRANSAÇÃO da order com vários pagamentos: só o ÚNICO aprovado serve;
 *   * RETRY-AFTER: só de 429, só positivo e legível;
 *   * LOG da consulta da order não carrega o corpo (e-mail e CPF do pagador).
 *
 * Fixtures inventadas; nenhuma chamada de rede (todo `fetch` é dublê).
 */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  aplicarDiagnosticoDoPost,
  autorizacaoPeloBanco,
  consultarReembolsoDoPedido,
  consultarTransacaoDaOrder,
  decidirConclusaoPelaConsulta,
  executarEstorno as executarEstornoReal,
  guardaAntesDeChamar,
  interpretarResposta,
  LIMITE_DE_FALHAS_TRANSITORIAS,
  MOTIVO_AINDA_NAO_LIBERADA,
  MOTIVO_NAO_LIBERADA_NO_LIMITE,
  type LinhaEstorno,
  type PedidoParaEstorno,
} from "./estorno.ts";

const AGORA = new Date("2026-09-07T12:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;
const TOKEN = "TESTE_TOKEN";
const ORDER = "ORD01ABCDEFOLUIMWQKDXYZ01";

function linhaCom(extras: Partial<LinhaEstorno> = {}): LinhaEstorno {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    order_id: "22222222-2222-4222-8222-222222222222",
    amount: 50,
    status: "solicitado",
    mp_refund_id: null,
    tentativas: 0,
    ...extras,
  };
}

function pedidoCom(extras: Partial<PedidoParaEstorno> = {}): PedidoParaEstorno {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    gateway_payment_id: "123456789",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date(AGORA.getTime() - DIA_MS).toISOString(),
    status: "cancelled",
    ...extras,
  };
}
const pedidoOrder = (extras: Partial<PedidoParaEstorno> = {}) => pedidoCom({ gateway_payment_id: ORDER, ...extras });

async function comLog<T>(f: () => Promise<T>): Promise<{ resultado: T; linhas: string[] }> {
  const linhas: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void linhas.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  try {
    return { resultado: await f(), linhas };
  } finally {
    console.error = original;
  }
}

// ─── guarda ──────────────────────────────────────────────────────────────────

Deno.test("guarda: paid_at ILEGÍVEL (texto que não é data) recusa com motivo próprio, nunca libera", () => {
  for (const ilegivel of ["ontem à tarde", "2026-13-45T99:99:99Z", "abc"]) {
    const r = guardaAntesDeChamar(linhaCom(), pedidoCom({ paid_at: ilegivel }), AGORA);
    assertEquals(r.ok, false, ilegivel);
    assertStringIncludes(r.motivo, "ilegível");
  }
});

// ─── POST do estorno: 500 e 400 ──────────────────────────────────────────────

Deno.test("Orders: HTTP 500 no POST é 'não sei se saiu' (tentar_depois), nunca falhou definitivo; 502 também", () => {
  for (const status of [500, 502, 503]) {
    const r = interpretarResposta(status, {}, linhaCom(), pedidoOrder());
    assertEquals(r.tipo, "tentar_depois", String(status));
  }
});

Deno.test("Orders: HTTP 400 com código 'em andamento' continua em_processamento; com 'nada saiu' vira tentar_depois; sem código nomeado, falhou", () => {
  const emAndamento = interpretarResposta(400, { error_messages: [{ code: "refund_in_progress" }] }, linhaCom(), pedidoOrder());
  assertEquals(emAndamento, { tipo: "em_processamento", mp_refund_id: null, mp_status: "refund_in_progress" });
  const nadaSaiu = interpretarResposta(400, { error_messages: [{ code: "insufficient_money_for_refund" }] }, linhaCom(), pedidoOrder());
  assertEquals(nadaSaiu, { tipo: "tentar_depois", motivo: MOTIVO_AINDA_NAO_LIBERADA });
  const desconhecido = interpretarResposta(400, { error_messages: [{ code: "codigo_que_ninguem_viu" }] }, linhaCom(), pedidoOrder());
  assertEquals(desconhecido.tipo, "falhou");
});

// ─── autorização do banco ────────────────────────────────────────────────────

const rpcCom = (data: unknown, error: unknown = null) => async () => ({ data, error });
const pedidoDoBanco = (extras: Record<string, unknown> = {}) => ({
  id: "22222222-2222-4222-8222-222222222222",
  gateway_payment_id: ORDER,
  total: 120.5,
  valor_estornado: 10,
  payment_status: "pago",
  paid_at: "2026-09-06T12:00:00.000Z",
  status: "cancelled",
  ...extras,
});
const autorizar = (pedido: unknown) =>
  comLog(() => autorizacaoPeloBanco(rpcCom({ decisao: "autorizado", pedido }))(linhaCom()));

Deno.test("autorização: pedido legível vale — total e valor_estornado em TEXTO numérico viram número; payment_status e paid_at em texto são mantidos", async () => {
  const { resultado } = await autorizar(pedidoDoBanco({ total: "120.50", valor_estornado: "10" }));
  assertEquals(resultado, {
    decisao: "autorizado",
    pedido: {
      id: "22222222-2222-4222-8222-222222222222",
      gateway_payment_id: ORDER,
      total: 120.5,
      valor_estornado: 10,
      payment_status: "pago",
      paid_at: "2026-09-06T12:00:00.000Z",
      status: "cancelled",
    },
  });
});

Deno.test("autorização: payment_status e paid_at que NÃO são texto viram null; valor_estornado ausente vale 0", async () => {
  const { resultado } = await autorizar(pedidoDoBanco({ payment_status: 5, paid_at: 123, valor_estornado: undefined }));
  assertEquals(resultado.decisao, "autorizado");
  assertEquals(resultado.pedido.payment_status, null);
  assertEquals(resultado.pedido.paid_at, null);
  assertEquals(resultado.pedido.valor_estornado, 0);
});

Deno.test("autorização: total ou valor_estornado ilegíveis (vazio, só espaço, lixo, objeto) NÃO autorizam: indisponivel", async () => {
  for (const campo of ["total", "valor_estornado"]) {
    for (const ruim of ["", "   ", "abc", {}, NaN, Infinity]) {
      const { resultado } = await autorizar(pedidoDoBanco({ [campo]: ruim }));
      assertEquals(resultado, { decisao: "indisponivel" }, `${campo}=${JSON.stringify(ruim)}`);
    }
  }
});

Deno.test("autorização: pedido sem id, sem id do gateway, sem status — cada um sozinho — ou que não é objeto: indisponivel", async () => {
  for (const defeito of [{ id: 7 }, { gateway_payment_id: 7 }, { status: null }, { id: undefined }]) {
    const { resultado } = await autorizar(pedidoDoBanco(defeito));
    assertEquals(resultado, { decisao: "indisponivel" }, JSON.stringify(defeito));
  }
  for (const naoObjeto of [null, undefined, "texto", 3]) {
    const { resultado } = await autorizar(naoObjeto);
    assertEquals(resultado, { decisao: "indisponivel" }, String(naoObjeto));
  }
});

Deno.test("autorização: nao_cabe devolve o disponível (texto numérico vale; vazio vira null)", async () => {
  const cabe = (disponivel: unknown) => autorizacaoPeloBanco(rpcCom({ decisao: "nao_cabe", disponivel }))(linhaCom());
  assertEquals(await cabe("12.50"), { decisao: "nao_cabe", disponivel: 12.5 });
  assertEquals(await cabe(""), { decisao: "nao_cabe", disponivel: null });
});

// ─── diagnóstico do POST ─────────────────────────────────────────────────────

function rpcDoDiagnostico(resposta: unknown) {
  const chamadas: string[] = [];
  return {
    chamadas,
    rpc: async (nome: string) => {
      chamadas.push(nome);
      return { data: resposta, error: null };
    },
  };
}

Deno.test("diagnóstico: concluido, recusado e tentar_depois SEM diagnóstico voltam como estão, sem chamar o banco e sem erro no log", async () => {
  for (
    const resultado of [
      { tipo: "concluido", mp_refund_id: "R1", mp_status: "processed", mp_status_detail: null, valor: 50 },
      { tipo: "recusado", motivo: "x" },
      { tipo: "tentar_depois", motivo: "x" },
    ]
  ) {
    const banco = rpcDoDiagnostico({ transitorios: 9, post_incerto: false, mp_codigo: null });
    const { resultado: voltou, linhas } = await comLog(() => aplicarDiagnosticoDoPost(banco.rpc, "R-LINHA", resultado));
    assertEquals(voltou, resultado);
    assertEquals(banco.chamadas, [], resultado.tipo);
    assertEquals(linhas, [], resultado.tipo);
  }
});

Deno.test("diagnóstico: no limite de falhas 'nada saiu' sem código do MP, a linha vira falhou com o código 'nada_saiu'", async () => {
  const diagnostico = { mpCodigo: null, postIncerto: false, transitorio: true };
  const banco = rpcDoDiagnostico({ transitorios: LIMITE_DE_FALHAS_TRANSITORIAS, post_incerto: false, mp_codigo: null });
  const r = await aplicarDiagnosticoDoPost(banco.rpc, "R-LINHA", { tipo: "tentar_depois", motivo: "x", diagnostico });
  assertEquals(r.tipo, "falhou");
  assertEquals(r.codigo, "nada_saiu");
  assertEquals(r.motivo, MOTIVO_NAO_LIBERADA_NO_LIMITE);
  // Um abaixo do limite continua tentando.
  const antes = rpcDoDiagnostico({ transitorios: LIMITE_DE_FALHAS_TRANSITORIAS - 1, post_incerto: false, mp_codigo: null });
  const ainda = await aplicarDiagnosticoDoPost(antes.rpc, "R-LINHA", { tipo: "tentar_depois", motivo: "x", diagnostico });
  assertEquals(ainda.tipo, "tentar_depois");
});

// ─── conclusão pela consulta ─────────────────────────────────────────────────

const orderComRefunds = (refunds: unknown[], extra: Record<string, unknown> = {}) => ({
  id: ORDER,
  status: "refunded",
  status_detail: "refunded",
  transactions: { payments: [{ id: "PAY1" }], refunds },
  ...extra,
});

const decidir = (corpo: Record<string, unknown>, extras: Record<string, unknown> = {}) =>
  decidirConclusaoPelaConsulta({
    corpo,
    ehPayments: false,
    linha: linhaCom({ amount: 50 }),
    pedido: pedidoOrder({ valor_estornado: 0 }),
    temPreVeredito: false,
    ...extras,
  });

Deno.test("Orders: refund SEM id nunca conclui a linha (não se empresta um refund que ninguém consegue amarrar)", () => {
  const r = decidir(orderComRefunds([{ amount: "50.00", status: "processed" }]));
  assertEquals(r.tipo !== "concluido", true, JSON.stringify(r));
});

Deno.test("Orders: refund processado com valor ILEGÍVEL torna a soma não confiável: tentar_depois, mesmo havendo um refund do valor certo", () => {
  const r = decidir(orderComRefunds([
    { id: "A", amount: "50.00", status: "processed" },
    { id: "B", amount: "abc", status: "processed" },
  ]));
  assertEquals(r, { tipo: "tentar_depois", motivo: "não consegui confirmar o estorno com o Mercado Pago agora" });
});

Deno.test("Orders: dois refunds idênticos e sem data — o PRIMEIRO vence (o desempate é sempre o mesmo)", () => {
  const r = decidir(
    orderComRefunds([
      { id: "A", amount: "50.00", status: "processed" },
      { id: "B", amount: "50.00", status: "processed" },
    ]),
    { pedido: pedidoOrder({ valor_estornado: 50 }) },
  );
  assertEquals(r.tipo, "concluido");
  assertEquals(r.mp_refund_id, "A");
});

Deno.test("Payments: refunds com lixo (null, texto) na lista são ignorados e o refund válido conclui; empate vai ao PRIMEIRO", () => {
  const corpo = {
    status: "refunded",
    transaction_amount_refunded: "100.00",
    refunds: [null, "lixo", 7, { id: "A", amount: "50", status: "approved" }, { id: "B", amount: "50", status: "approved" }],
  };
  const r = decidirConclusaoPelaConsulta({
    corpo,
    ehPayments: true,
    linha: linhaCom({ amount: 50 }),
    pedido: pedidoCom({ valor_estornado: 50 }),
    temPreVeredito: false,
  });
  assertEquals(r.tipo, "concluido");
  assertEquals(r.mp_refund_id, "A");
});

Deno.test("POST 201 Orders: dois refunds do valor da linha empatados — o id gravado é o do PRIMEIRO", () => {
  const corpo = {
    id: ORDER,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      refunds: [
        { id: "A", amount: "50.00", status: "processed" },
        { id: "B", amount: "50.00", status: "processed" },
      ],
    },
  };
  const r = interpretarResposta(201, corpo, linhaCom({ amount: 50 }), pedidoOrder());
  assertEquals(r.tipo, "concluido");
  assertEquals(r.mp_refund_id, "A");
});

// ─── reemissão: a consulta que decide "criar chave nova" ─────────────────────

function buscarComCorpo(corpoTexto: string, status = 200): typeof fetch {
  return (() => Promise.resolve(new Response(corpoTexto, { status }))) as typeof fetch;
}

const consultar = (buscar: typeof fetch, pedido = pedidoOrder(), extras: Record<string, unknown> = {}) =>
  comLog(() =>
    consultarReembolsoDoPedido({ buscar, token: TOKEN, pedido, valor: 50, idsJaReivindicados: [], ...extras })
  );

Deno.test("reemissão: corpo da consulta que não é objeto (null, lista, texto) é 'indeterminado', sem lançar", async () => {
  for (const corpo of ["null", "[]", '"texto"', "42"]) {
    const { resultado } = await consultar(buscarComCorpo(corpo));
    assertEquals(resultado, { resultado: "indeterminado", motivo: "resposta ilegível" }, corpo);
  }
});

Deno.test("reemissão (Payments): refunds com null e texto na lista são ignorados; o refund do valor, de ninguém, é 'achou'", async () => {
  const corpo = {
    transaction_amount_refunded: "50.00",
    refunds: [null, "lixo", { id: "R1", amount: "50.00", status: "approved" }],
  };
  const { resultado } = await consultar(buscarComCorpo(JSON.stringify(corpo)), pedidoCom());
  assertEquals(resultado, { resultado: "achou", mp_refund_id: "R1", mp_status: "approved", valor: 50 });
});

Deno.test("reemissão (Orders): 'consta devolvida' com refund só em andamento diz isso — e não 'refund que não é desta devolução'", async () => {
  const corpo = orderComRefunds([{ id: "R1", amount: "50.00", status: "processing" }]);
  const { resultado } = await consultar(buscarComCorpo(JSON.stringify(corpo)));
  assertEquals(resultado, {
    resultado: "indeterminado",
    motivo: "a cobrança consta como devolvida, mas nenhum reembolso aparece",
  });
});

// ─── a transação da order com vários pagamentos ──────────────────────────────

function buscarOrder(pagamentos: unknown[]): typeof fetch {
  return (() =>
    Promise.resolve(new Response(JSON.stringify({ id: ORDER, transactions: { payments: pagamentos } }), { status: 200 }))) as typeof fetch;
}
const transacaoDe = (pagamentos: unknown[]) =>
  comLog(() => consultarTransacaoDaOrder({ orderId: ORDER, token: TOKEN, buscar: buscarOrder(pagamentos) }));

Deno.test("transação da order: vários pagamentos, UM aprovado — é o id dele; qualquer status aprovado da lista fechada vale", async () => {
  for (const aprovado of ["processed", "approved", "accredited"]) {
    const { resultado } = await transacaoDe([
      { id: "PAY_FALHOU", status: "failed" },
      { id: "PAY_CERTO", status: aprovado },
      { id: "PAY_SEM_STATUS" },
      { id: "PAY_STATUS_NUMERO", status: 7 },
    ]);
    assertEquals(resultado, "PAY_CERTO", aprovado);
  }
});

Deno.test("transação da order: vários pagamentos sem nenhum aprovado, ou com dois aprovados, devolve null (e registra o porquê)", async () => {
  const nenhum = await transacaoDe([{ id: "A", status: "failed" }, { id: "B", status: "cancelled" }]);
  assertEquals(nenhum.resultado, null);
  assertEquals(nenhum.linhas.some((l) => l.includes("múltiplos pagamentos")), true);
  const dois = await transacaoDe([{ id: "A", status: "processed" }, { id: "B", status: "approved" }]);
  assertEquals(dois.resultado, null);
});

Deno.test("consulta da order com HTTP 500: o log NÃO leva o corpo (e-mail e CPF do pagador ficam de fora)", async () => {
  const corpo = JSON.stringify({
    message: "falha",
    payer: { email: "titular.de.teste@exemplo.test", identification: { number: "12345678900" } },
  });
  const buscar = (() => Promise.resolve(new Response(corpo, { status: 500 }))) as typeof fetch;
  const { resultado, linhas } = await comLog(() => consultarTransacaoDaOrder({ orderId: ORDER, token: TOKEN, buscar }));
  assertEquals(resultado, null);
  const tudo = linhas.join("\n");
  assertEquals(tudo.includes("titular.de.teste@exemplo.test"), false);
  assertEquals(tudo.includes("12345678900"), false);
});

// ─── Retry-After ─────────────────────────────────────────────────────────────

async function executar(status: number, retryAfter: string | null) {
  // O módulo registra a recusa do MP no log; aqui o log fica fora da saída do teste.
  return (await comLog(() => executarSemLog(status, retryAfter))).resultado;
}

function executarSemLog(status: number, retryAfter: string | null) {
  const buscar = ((entrada: unknown, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    if (metodo !== "POST") return Promise.resolve(new Response("{}", { status: 500 }));
    return Promise.resolve(
      new Response(JSON.stringify({ message: "ocupado" }), {
        status,
        headers: retryAfter === null ? {} : { "Retry-After": retryAfter },
      }),
    );
  }) as typeof fetch;
  return executarEstornoReal({
    linha: linhaCom(),
    pedido: pedidoCom(),
    token: TOKEN,
    buscar,
    autorizarAntesDoPost: () => Promise.resolve({ decisao: "autorizado", pedido: pedidoCom() }),
  });
}

Deno.test("Retry-After: só o 429 o carrega, e só positivo e legível (0, negativo, lixo ou ausente não viram prazo)", async () => {
  assertEquals((await executar(429, "30")).retryAfterS, 30, "controle");
  for (const ruim of ["0", "-5", "abc", "", null]) {
    const r = await executar(429, ruim);
    assertEquals(r.tipo, "tentar_depois", String(ruim));
    assertEquals(r.retryAfterS, undefined, `Retry-After=${String(ruim)}`);
  }
  // Outro status instável (503) com o cabeçalho presente NÃO ganha prazo.
  const r503 = await executar(503, "30");
  assertEquals(r503.tipo, "tentar_depois");
  assertEquals(r503.retryAfterS, undefined);
});

// ─── segunda rodada da caça (mesmos módulos, o que ainda sobrevivia) ─────────

Deno.test("código do erro no TOPO do corpo (sem lista cause/errors) também vale, em texto ou número", () => {
  const emAndamento = interpretarResposta(400, { code: "refund_in_progress" }, linhaCom(), pedidoOrder());
  assertEquals(emAndamento.tipo, "em_processamento");
  const numerico = interpretarResposta(400, { code: 2063 }, linhaCom(), pedidoCom());
  assertEquals(numerico.tipo, "falhou");
  assertEquals(numerico.codigo, "2063");
});

Deno.test("transação da order: pagamento ÚNICO sem id (ausente ou null) devolve null, nunca o texto 'undefined' ou 'null'", async () => {
  for (const pagamento of [{ status: "processed" }, { id: null, status: "processed" }, { id: "", status: "processed" }]) {
    const { resultado } = await transacaoDe([pagamento]);
    assertEquals(resultado, null, JSON.stringify(pagamento));
  }
});

Deno.test("POST 201 Orders: refund SEM id na resposta conclui com id vazio (a consulta preenche depois), sem fingir que o refund é de outra devolução", () => {
  const corpo = {
    id: ORDER,
    status: "refunded",
    status_detail: "refunded",
    transactions: { refunds: [{ amount: "50.00", status: "processed" }] },
  };
  const r = interpretarResposta(201, corpo, linhaCom({ amount: 50 }), pedidoOrder());
  assertEquals(r, { tipo: "concluido", mp_refund_id: "", mp_status: "refunded", mp_status_detail: "refunded", valor: 50 });
});

Deno.test("Orders: lista de refunds com null e texto no meio é ignorada, o refund válido conclui sem lançar", () => {
  const r = decidir(orderComRefunds([null, "lixo", 3, { id: "A", amount: "50.00", status: "processed" }]));
  assertEquals(r.tipo, "concluido");
  assertEquals(r.mp_refund_id, "A");
});

// @ts-nocheck
/**
 * Caça por mutação (25/11/2026, segunda rodada) em `estorno.ts` — o dinheiro que
 * VOLTA para a cliente. Depois de `estorno_test`, `_bordas`, `_incerteza`, `_reenvio`
 * e `_prazo_de_180_dias_exato`, ainda sobreviviam defeitos de UMA linha que movem
 * dinheiro. O que cada grupo guarda:
 *
 *   * SALDO em centavos: devolver exatamente o que resta (R$ 45,50 de um pedido de
 *     R$ 50,00 com R$ 4,50 já devolvidos) é aceito e um centavo a mais é recusado, em
 *     TODOS os pares de centavos de um pedido de até R$ 4,00 — o arredondamento tem
 *     de ser o de centavos (×100), nunca outro fator;
 *   * HTTP do POST: 408 (tempo esgotado) é "não sei se saiu" (`tentar_depois`), 409 e
 *     402 NÃO são (viram `falhou` com `http_409`/`http_402`); 401 é credencial
 *     (`tentar_depois`); 200 E 201 da Orders API são sucesso;
 *   * os SEIS códigos nomeados da Orders API, com o motivo e o código exatos;
 *   * corpo de erro SEM código nunca vira o código "undefined";
 *   * refund sem id, com id vazio ou com id NUMÉRICO que já é de outra devolução
 *     (B1: concluir sem id gravaria a devolução em dobro);
 *   * dois refunds do mesmo valor na resposta: vence o de `date_created` mais recente,
 *     e um datado vence um sem data;
 *   * a soma BRUTA e a soma LIVRE dos refunds (R$ 0,50 abaixo do necessário ainda é
 *     "não cobre" / "não conclui");
 *   * consulta ao MP com HTTP de erro e corpo que PARECE pago: nunca conclui;
 *     rede caída, HTTP de erro e corpo ilegível dão `tentar_depois`;
 *   * refund `canceled` morreu (não conta como reembolso sem dono);
 *   * o EXECUTOR: transação da order ausente (a consulta devolveu `null`) não envia
 *     POST nenhum; "mudou de estado" e "consulta indisponível" têm cada qual o seu
 *     texto; `Retry-After: 1` do 429 vale (1 segundo é positivo); resposta 201
 *     `em_processamento` volta SEM a chave `diagnostico`;
 *   * a transação da order com UM pagamento só: o id dele vale sem olhar o status
 *     (só com vários pagamentos o aprovado é exigido);
 *   * o `idProprio` da consulta com espaço em volta ainda acha o próprio refund;
 *   * refund com id NUMÉRICO e do valor da linha, ainda de ninguém: conclui com esse id;
 *   * a RPC de autorização/diagnóstico que devolve ERRO junto de um dado "bom": o erro
 *     vence (nunca autoriza POST, nunca grava diagnóstico).
 *
 * Fixtures inventadas; nenhuma chamada de rede (todo `fetch` e toda RPC é dublê).
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  aplicarDiagnosticoDoPost,
  autorizacaoPeloBanco,
  confirmarPorConsulta,
  consultarTransacaoDaOrder,
  consultarReembolsoDoPedido,
  decidirConclusaoPelaConsulta,
  executarEstorno,
  guardaAntesDeChamar,
  interpretarResposta,
  LIMITE_DE_FALHAS_TRANSITORIAS,
  MOTIVO_DEVOLVIDO_POR_FORA_EM_PARCELAS,
  MOTIVO_NAO_COBRE,
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

async function semLog<T>(f: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await f();
  } finally {
    console.error = original;
  }
}

// ─── saldo em centavos ───────────────────────────────────────────────────────

Deno.test("guarda: devolver EXATAMENTE o que resta é aceito e um centavo a mais é recusado — todo par de centavos de um pedido de até R$ 4,00", () => {
  for (let total = 1; total <= 400; total++) {
    for (let jaDevolvido = 0; jaDevolvido < total; jaDevolvido++) {
      const resta = total - jaDevolvido;
      const pedido = pedidoCom({ total: total / 100, valor_estornado: jaDevolvido / 100 });
      assertEquals(
        guardaAntesDeChamar(linhaCom({ amount: resta / 100 }), pedido, AGORA).ok,
        true,
        `total=${total} jaDevolvido=${jaDevolvido} pede=${resta}`,
      );
      assertEquals(
        guardaAntesDeChamar(linhaCom({ amount: (resta + 1) / 100 }), pedido, AGORA).ok,
        false,
        `total=${total} jaDevolvido=${jaDevolvido} pede=${resta + 1}`,
      );
    }
  }
});

Deno.test("guarda: o exemplo do pedido de R$ 50,00 com R$ 4,50 já devolvidos aceita R$ 45,50 e recusa R$ 45,51", () => {
  const pedido = pedidoCom({ total: 50, valor_estornado: 4.5 });
  assertEquals(guardaAntesDeChamar(linhaCom({ amount: 45.5 }), pedido, AGORA), { ok: true });
  assertEquals(guardaAntesDeChamar(linhaCom({ amount: 45.51 }), pedido, AGORA), {
    ok: false,
    motivo: "valor maior que o disponível para devolver",
  });
});

// ─── o HTTP do POST (Payments e Orders) ──────────────────────────────────────

Deno.test("POST do estorno: 408 é 'não sei se saiu' (tentar_depois) nas duas APIs; 409 e 402 viram falhou com http_<status>", () => {
  for (const pedido of [pedidoCom(), pedidoOrder()]) {
    const api = pedido.gateway_payment_id === ORDER ? "Orders" : "Payments";
    const r408 = interpretarResposta(408, {}, linhaCom(), pedido);
    assertEquals(r408.tipo, "tentar_depois", `${api} 408`);
    assertEquals(r408.motivo, "o Mercado Pago está ocupado ou instável agora", `${api} 408`);
    for (const status of [409, 402, 404]) {
      assertEquals(
        interpretarResposta(status, {}, linhaCom(), pedido),
        { tipo: "falhou", motivo: "erro não reconhecido do Mercado Pago", codigo: `http_${status}` },
        `${api} ${status}`,
      );
    }
  }
});

Deno.test("POST do estorno: 401 sem código é credencial (tentar_depois) nas duas APIs", () => {
  for (const pedido of [pedidoCom(), pedidoOrder()]) {
    const r = interpretarResposta(401, {}, linhaCom(), pedido);
    assertEquals(r, { tipo: "tentar_depois", motivo: "não consegui autenticar no Mercado Pago agora" });
  }
});

Deno.test("POST do estorno (Orders): HTTP 200 e HTTP 201 com a order refunded são sucesso — concluido com o valor da linha", () => {
  for (const status of [200, 201]) {
    const r = interpretarResposta(status, { status: "refunded", status_detail: "refunded" }, linhaCom(), pedidoOrder());
    assertEquals(r.tipo, "concluido", String(status));
    assertEquals(r.valor, 50, String(status));
  }
});

Deno.test("POST do estorno (Orders): HTTP 202 com a order refunded NÃO é sucesso (só 200 e 201)", () => {
  const r = interpretarResposta(202, { status: "refunded" }, linhaCom(), pedidoOrder());
  assertEquals(r.tipo, "falhou");
  assertEquals(r.codigo, "http_202");
});

// ─── os seis códigos nomeados da Orders API ──────────────────────────────────

Deno.test("Orders: cada código nomeado devolve o motivo e o código exatos (seis linhas da tabela fechada)", () => {
  const tabela: Array<[string, string]> = [
    ["order_already_refunded", "cobrança já devolvida — confirmando com o Mercado Pago"],
    ["idempotency_key_already_used", "esta devolução já foi pedida — confirmando o resultado com o Mercado Pago"],
    ["refund_amount_exceeds", "valor maior que o disponível para devolver"],
    ["cannot_refund_order", "esta cobrança não pode ser devolvida"],
    ["order_not_found", "pagamento não encontrado no Mercado Pago"],
    ["transaction_not_found", "transação não encontrada no Mercado Pago"],
  ];
  for (const [codigo, motivo] of tabela) {
    const r = interpretarResposta(400, { errors: [{ code: codigo }] }, linhaCom(), pedidoOrder());
    assertEquals(r, { tipo: "falhou", motivo, codigo }, codigo);
  }
});

Deno.test("corpo de erro SEM código (errors com só mensagem) nunca vira o código 'undefined': o código é http_<status>", () => {
  for (const pedido of [pedidoCom(), pedidoOrder()]) {
    const r = interpretarResposta(400, { errors: [{ message: "algo deu errado" }] }, linhaCom(), pedido);
    assertEquals(r.tipo, "falhou");
    assertEquals(r.codigo, "http_400");
  }
});

// ─── B1: refund do valor da linha que é de OUTRA devolução ───────────────────

const respostaComRefunds = (refunds: unknown[]) => ({
  status: "refunded",
  status_detail: "refunded",
  transactions: [{ id: "PAY1", refunds }],
});

Deno.test("B1: o refund do valor da linha com id NUMÉRICO já reivindicado por outra devolução manda conferir pela consulta (tentar_depois), nunca concluir sem id", () => {
  const corpo = respostaComRefunds([{ id: 12345, amount: "50.00", status: "processed" }]);
  const r = interpretarResposta(201, corpo, linhaCom(), pedidoOrder(), ["12345"]);
  assertEquals(r.tipo, "tentar_depois");
});

Deno.test("B1: refund do valor da linha SEM id e com id VAZIO não é 'de outra devolução' — conclui, com id vazio para a consulta preencher", () => {
  for (const semId of [{ amount: "50.00", status: "processed" }, { id: "", amount: "50.00", status: "processed" }]) {
    const r = interpretarResposta(201, respostaComRefunds([semId]), linhaCom(), pedidoOrder(), []);
    assertEquals(r.tipo, "concluido", JSON.stringify(semId));
    assertEquals(r.mp_refund_id, "", JSON.stringify(semId));
  }
});

Deno.test("resposta com dois refunds do mesmo valor: vence o de date_created mais recente, em qualquer ordem; datado vence sem data", () => {
  const velho = { id: "R-VELHO", amount: "50.00", status: "processed", date_created: "2026-09-07T10:00:00.000Z" };
  const novo = { id: "R-NOVO", amount: "50.00", status: "processed", date_created: "2026-09-07T11:00:00.000Z" };
  const semData = { id: "R-SEM-DATA", amount: "50.00", status: "processed" };
  const pega = (refunds: unknown[]) =>
    interpretarResposta(201, respostaComRefunds(refunds), linhaCom(), pedidoOrder(), []).mp_refund_id;
  assertEquals(pega([velho, novo]), "R-NOVO");
  assertEquals(pega([novo, velho]), "R-NOVO");
  assertEquals(pega([semData, velho]), "R-VELHO");
  assertEquals(pega([velho, semData]), "R-VELHO");
});

// ─── a soma bruta e a soma livre ─────────────────────────────────────────────

function ordersComProcessados(valores: Array<[string, string]>) {
  return {
    id: ORDER,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY1" }],
      refunds: valores.map(([id, amount]) => ({ id, amount, status: "processed" })),
    },
  };
}

Deno.test("conclusão pela consulta (Orders): soma bruta R$ 0,50 abaixo de (já devolvido + esta linha) NÃO conclui; no valor exato conclui", () => {
  const linha = linhaCom({ amount: 10 });
  const pedido = pedidoOrder({ valor_estornado: 5 });
  const abaixo = decidirConclusaoPelaConsulta({
    corpo: ordersComProcessados([["R0", "4.50"], ["R1", "10.00"]]),
    ehPayments: false,
    linha,
    pedido,
    idsJaReivindicados: ["R0"],
    temPreVeredito: false,
  });
  assertEquals(abaixo.tipo, "tentar_depois");
  const exato = decidirConclusaoPelaConsulta({
    corpo: ordersComProcessados([["R0", "5.00"], ["R1", "10.00"]]),
    ehPayments: false,
    linha,
    pedido,
    idsJaReivindicados: ["R0"],
    temPreVeredito: false,
  });
  assertEquals(exato.tipo, "concluido");
  assertEquals(exato.mp_refund_id, "R1");
});

Deno.test("conclusão pela consulta (Orders): sem refund do valor exato, soma livre de R$ 9,50 para uma linha de R$ 10,00 é 'não cobre'; de R$ 10,00 é 'devolvido por fora em parcelas'", () => {
  const linha = linhaCom({ amount: 10 });
  const pedido = pedidoOrder({ valor_estornado: 0 });
  const decide = (valores: Array<[string, string]>) =>
    decidirConclusaoPelaConsulta({
      corpo: ordersComProcessados(valores),
      ehPayments: false,
      linha,
      pedido,
      idsJaReivindicados: [],
      temPreVeredito: true,
    });
  assertEquals(decide([["A", "4.75"], ["B", "4.75"]]), {
    tipo: "falhou",
    motivo: MOTIVO_NAO_COBRE,
    codigo: "confirmacao_insuficiente",
  });
  assertEquals(decide([["A", "5.00"], ["B", "5.00"]]), {
    tipo: "falhou",
    motivo: MOTIVO_DEVOLVIDO_POR_FORA_EM_PARCELAS,
    codigo: "confirmacao_insuficiente",
  });
});

// ─── consulta ao MP: HTTP de erro, rede e corpo ──────────────────────────────

function fetchFalso(status: number, corpo: unknown): typeof fetch {
  return (() => Promise.resolve(new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status }))) as unknown as typeof fetch;
}

Deno.test("confirmarPorConsulta: HTTP 502 com corpo que PARECE a order devolvida NÃO conclui (tentar_depois)", async () => {
  const corpo = ordersComProcessados([["R1", "50.00"]]);
  const r = await semLog(() =>
    confirmarPorConsulta({ buscar: fetchFalso(502, corpo), token: TOKEN, linha: linhaCom(), pedido: pedidoOrder() })
  );
  assertEquals(r, { tipo: "tentar_depois", motivo: "não consegui confirmar o estorno com o Mercado Pago agora" });
});

Deno.test("confirmarPorConsulta: rede caída e corpo ilegível dão tentar_depois (nunca concluem nem falham)", async () => {
  const redeCaida = (() => Promise.reject(new Error("rede"))) as unknown as typeof fetch;
  const r1 = await semLog(() =>
    confirmarPorConsulta({ buscar: redeCaida, token: TOKEN, linha: linhaCom(), pedido: pedidoOrder() })
  );
  assertEquals(r1.tipo, "tentar_depois");
  const r2 = await semLog(() =>
    confirmarPorConsulta({ buscar: fetchFalso(200, "isto não é json"), token: TOKEN, linha: linhaCom(), pedido: pedidoOrder() })
  );
  assertEquals(r2.tipo, "tentar_depois");
});

Deno.test("consultarReembolsoDoPedido: HTTP 500 com corpo que parece cobrança paga sem reembolso é indeterminado, nunca nao_achou", async () => {
  const corpoDePaga = { id: ORDER, status: "processed", transactions: { payments: [{ id: "PAY1" }] } };
  const r = await semLog(() =>
    consultarReembolsoDoPedido({
      buscar: fetchFalso(500, corpoDePaga),
      token: TOKEN,
      pedido: pedidoOrder(),
      valor: 50,
      idsJaReivindicados: [],
    })
  );
  assertEquals(r.resultado, "indeterminado");
});

Deno.test("consultarReembolsoDoPedido: refund 'canceled' (grafia americana) morreu — não conta como reembolso sem dono: nao_achou", async () => {
  const corpo = {
    id: ORDER,
    status: "processed",
    transactions: {
      payments: [{ id: "PAY1" }],
      refunds: [{ id: "RMORTO", amount: "50.00", status: "canceled" }],
    },
  };
  const r = await consultarReembolsoDoPedido({
    buscar: fetchFalso(200, corpo),
    token: TOKEN,
    pedido: pedidoOrder(),
    valor: 50,
    idsJaReivindicados: [],
  });
  assertEquals(r, { resultado: "nao_achou" });
});

// ─── a RPC que devolve erro junto de um dado "bom" ───────────────────────────

Deno.test("autorização do banco: RPC que LANÇA ou devolve ERRO (mesmo com um 'autorizado' no data) é indisponivel — nunca autoriza o POST", async () => {
  const pedido = {
    id: "22222222-2222-4222-8222-222222222222",
    gateway_payment_id: ORDER,
    total: 120.5,
    valor_estornado: 10,
    payment_status: "pago",
    paid_at: "2026-09-06T12:00:00.000Z",
    status: "cancelled",
  };
  const lanca = () => Promise.reject(new Error("banco fora"));
  assertEquals(await semLog(() => autorizacaoPeloBanco(lanca)(linhaCom())), { decisao: "indisponivel" });
  const comErro = () => Promise.resolve({ data: { decisao: "autorizado", pedido }, error: { message: "falha" } });
  assertEquals(await semLog(() => autorizacaoPeloBanco(comErro)(linhaCom())), { decisao: "indisponivel" });
  const semErro = () => Promise.resolve({ data: { decisao: "autorizado", pedido }, error: null });
  assertEquals((await autorizacaoPeloBanco(semErro)(linhaCom())).decisao, "autorizado");
});

Deno.test("diagnóstico do POST: RPC com ERRO junto de um data 'bom' NÃO grava (tentou 2x) e o resultado fica tentar_depois, mesmo com falhas no limite", async () => {
  const diagnostico = { mpCodigo: null, postIncerto: false, transitorio: true };
  let chamadas = 0;
  const rpc = () => {
    chamadas++;
    return Promise.resolve({
      data: { transitorios: LIMITE_DE_FALHAS_TRANSITORIAS + 4, post_incerto: false, mp_codigo: null },
      error: { message: "falha" },
    });
  };
  const resultado = { tipo: "tentar_depois", motivo: "x", diagnostico };
  const r = await semLog(() => aplicarDiagnosticoDoPost(rpc, "R-LINHA", resultado));
  assertEquals(r, resultado);
  assertEquals(chamadas, 2);
});

// ─── refund com id numérico que ainda é de ninguém ───────────────────────────

Deno.test("resposta com refund do valor da linha de id NUMÉRICO (de ninguém): conclui com esse id, em texto", () => {
  const corpo = respostaComRefunds([{ id: 12345, amount: "50.00", status: "processed" }]);
  const r = interpretarResposta(201, corpo, linhaCom(), pedidoOrder(), []);
  assertEquals(r.tipo, "concluido");
  assertEquals(r.mp_refund_id, "12345");
});

// ─── o próprio id da linha, com espaço em volta ──────────────────────────────

Deno.test("consultarReembolsoDoPedido: idProprio ' R1 ' (com espaço em volta) acha o refund R1 — achou, nunca indeterminado", async () => {
  const corpo = {
    id: ORDER,
    status: "refunded",
    transactions: {
      payments: [{ id: "PAY1" }],
      refunds: [{ id: "R1", amount: "50.00", status: "processed" }],
    },
  };
  const r = await consultarReembolsoDoPedido({
    buscar: fetchFalso(200, corpo),
    token: TOKEN,
    pedido: pedidoOrder(),
    valor: 50,
    idsJaReivindicados: [],
    idProprio: " R1 ",
  });
  assertEquals(r.resultado, "achou");
  assertEquals(r.mp_refund_id, "R1");
});

// ─── o executor: nada de POST às cegas ───────────────────────────────────────

/** Pedido de Orders pago ontem, pelo relógio REAL (o executor usa `new Date()`). */
function pedidoDeOntem(extras: Partial<PedidoParaEstorno> = {}): PedidoParaEstorno {
  return pedidoOrder({ paid_at: new Date(Date.now() - DIA_MS).toISOString(), ...extras });
}

function buscaQueConta(resposta: () => Response) {
  const chamadas: Array<{ url: string; metodo: string }> = [];
  const buscar = ((url: string, init?: RequestInit) => {
    chamadas.push({ url: String(url), metodo: String(init?.method ?? "GET") });
    return Promise.resolve(resposta());
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const autorizaOPedido = (pedido: PedidoParaEstorno) => () => Promise.resolve({ decisao: "autorizado", pedido });

Deno.test("executor: a consulta da transação devolve null — tentar_depois e NENHUMA chamada ao MP (nem POST com id de transação vazio)", async () => {
  const { buscar, chamadas } = buscaQueConta(() => new Response("{}", { status: 201 }));
  const r = await semLog(() =>
    executarEstorno({
      linha: linhaCom(),
      pedido: pedidoDeOntem(),
      token: TOKEN,
      buscar,
      consultarTransacaoDaOrder: () => Promise.resolve(null),
      autorizarAntesDoPost: autorizaOPedido(pedidoDeOntem()),
    })
  );
  assertEquals(r, { tipo: "tentar_depois", motivo: "não consegui obter a transação da order no Mercado Pago" });
  assertEquals(chamadas, []);
});

Deno.test("executor: sem a função de consulta da transação, o motivo é 'não disponível' (e nada é enviado)", async () => {
  const { buscar, chamadas } = buscaQueConta(() => new Response("{}", { status: 201 }));
  const r = await semLog(() =>
    executarEstorno({
      linha: linhaCom(),
      pedido: pedidoDeOntem(),
      token: TOKEN,
      buscar,
      autorizarAntesDoPost: autorizaOPedido(pedidoDeOntem()),
    })
  );
  assertEquals(r, { tipo: "tentar_depois", motivo: "consulta da transação da order não disponível" });
  assertEquals(chamadas, []);
});

Deno.test("executor: autorização 'linha_mudou' tem o texto próprio e nada é enviado; 'indisponivel' tem o outro", async () => {
  const { buscar, chamadas } = buscaQueConta(() => new Response("{}", { status: 201 }));
  const base = {
    linha: linhaCom(),
    pedido: pedidoDeOntem(),
    token: TOKEN,
    buscar,
    consultarTransacaoDaOrder: () => Promise.resolve("PAY1"),
  };
  const mudou = await semLog(() =>
    executarEstorno({ ...base, autorizarAntesDoPost: () => Promise.resolve({ decisao: "linha_mudou", status: "concluido" }) })
  );
  assertEquals(mudou, {
    tipo: "tentar_depois",
    motivo: "a devolução mudou de estado enquanto era preparada — nada foi enviado",
  });
  const indisponivel = await semLog(() =>
    executarEstorno({ ...base, autorizarAntesDoPost: () => Promise.resolve({ decisao: "indisponivel" }) })
  );
  assertEquals(indisponivel, {
    tipo: "tentar_depois",
    motivo: "não consegui reconferir o saldo do pedido antes de devolver",
  });
  assertEquals(chamadas, []);
});

Deno.test("executor: 429 com Retry-After de 1 segundo carrega retryAfterS 1; Retry-After 0, negativo ou texto não carregam", async () => {
  const roda = async (retryAfter: string | null) => {
    const { buscar } = buscaQueConta(() =>
      new Response("{}", { status: 429, headers: retryAfter === null ? {} : { "Retry-After": retryAfter } })
    );
    return await semLog(() =>
      executarEstorno({
        linha: linhaCom(),
        pedido: pedidoDeOntem(),
        token: TOKEN,
        buscar,
        consultarTransacaoDaOrder: () => Promise.resolve("PAY1"),
        autorizarAntesDoPost: autorizaOPedido(pedidoDeOntem()),
      })
    );
  };
  assertEquals((await roda("1")).retryAfterS, 1);
  assertEquals((await roda("30")).retryAfterS, 30);
  for (const ruim of ["0", "-5", "logo", null]) {
    assertEquals((await roda(ruim)).retryAfterS, undefined, String(ruim));
  }
});

Deno.test("executor: 201 com refund 'processing' volta em_processamento SEM a chave diagnostico (nada a diagnosticar)", async () => {
  const corpo = respostaComRefunds([{ id: "R1", amount: "50.00", status: "processing" }]);
  const { buscar } = buscaQueConta(() => new Response(JSON.stringify(corpo), { status: 201 }));
  const r = await semLog(() =>
    executarEstorno({
      linha: linhaCom(),
      pedido: pedidoDeOntem(),
      token: TOKEN,
      buscar,
      consultarTransacaoDaOrder: () => Promise.resolve("PAY1"),
      autorizarAntesDoPost: autorizaOPedido(pedidoDeOntem()),
    })
  );
  assertEquals(r, { tipo: "em_processamento", mp_refund_id: "R1", mp_status: "processing" });
  assertEquals(Object.keys(r).includes("diagnostico"), false);
});

// ─── a transação da order com um pagamento só ────────────────────────────────

Deno.test("transação da order: UM pagamento só vale pelo id, com qualquer status ou sem status; id vazio ou ausente é null", async () => {
  const consulta = (pagamentos: unknown[]) => {
    const buscar = (() =>
      Promise.resolve(new Response(JSON.stringify({ id: ORDER, transactions: { payments: pagamentos } }), { status: 200 }))) as typeof fetch;
    return semLog(() => consultarTransacaoDaOrder({ orderId: ORDER, token: TOKEN, buscar }));
  };
  assertEquals(await consulta([{ id: "PAY_UNICO" }]), "PAY_UNICO");
  assertEquals(await consulta([{ id: "PAY_UNICO", status: "action_required" }]), "PAY_UNICO");
  assertEquals(await consulta([{ id: "PAY_UNICO", status: "failed" }]), "PAY_UNICO");
  assertEquals(await consulta([{ id: "" }]), null);
  assertEquals(await consulta([{}]), null);
  assertEquals(await consulta([]), null);
});

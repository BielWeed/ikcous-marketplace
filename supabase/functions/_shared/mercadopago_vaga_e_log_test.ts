// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `mercadopago.ts` (linhas 701–1700): a
 * máquina que impede a cobrança DUPLA do cartão e o que o módulo grava no log.
 * 54 mutantes dessa faixa sobreviviam a `mercadopago_test.ts`; os que mudavam o
 * comportamento viram os casos abaixo.
 *
 *   * `idempotencyKeyJaUsado` (o 409 do MP que diz "esta chave já foi usada com
 *     outro corpo"): só o código exato, em `errors[]` de um corpo objeto;
 *   * o SENTINELA da vaga (`verificando:<chave>:<ms>`): só vale para a MESMA
 *     chave (c1 não é c10), e o instante gravado só vale se for número finito e
 *     positivo — qualquer outra coisa é "não sei", nunca "libera por data";
 *   * a chave da tentativa (`<pedido>:c<n>`): fração, negativo, texto e ausente
 *     caem em `c0`;
 *   * `paging.total` ZERO é um total legível; ilegível com a página cheia é
 *     indecisão;
 *   * o motivo da recusa e os caminhos de campo nunca lançam com erro nulo ou
 *     detalhe que não é texto;
 *   * o que vai ao LOG: o resumo do erro do MP só leva códigos-palavra e
 *     caminhos de campo (nunca e-mail, CPF nem texto livre), e
 *     `consultarOrder`/`cancelarOrder`/`criarOrder` obedecem a `corpoNoLog`.
 *
 * Fixtures inventadas; nenhuma chamada de rede.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buscarOrdersDoPedido,
  cancelarOrder,
  caminhosDeCampoPorErro,
  chaveDoCartaoDaTentativa,
  consultarOrder,
  criarOrder,
  idempotencyKeyJaUsado,
  limiteInferiorDoSentinela,
  montarSentinela,
  motivoDaRecusaDoErro,
  resumoSemDadoPessoal,
  sentinelaDaChave,
} from "./mercadopago.ts";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

// ─── a vaga do cartão: idempotência, sentinela e chave da tentativa ──────────

Deno.test("idempotencyKeyJaUsado: só o código exato, em errors[] de um corpo objeto", () => {
  assertEquals(idempotencyKeyJaUsado({ errors: [{ code: "idempotency_key_already_used" }] }), true);
  assertEquals(idempotencyKeyJaUsado({ errors: [{ code: "outro" }, { code: "idempotency_key_already_used" }] }), true);
  assertEquals(idempotencyKeyJaUsado({ errors: [null, { code: "idempotency_key_already_used" }] }), true);
  const ruins = [
    null,
    undefined,
    "idempotency_key_already_used",
    7,
    {},
    { errors: "idempotency_key_already_used" },
    { errors: [] },
    { errors: [null] },
    { errors: [{ code: "idempotency_key_already_usedX" }] },
    { errors: [{ code: "outro" }] },
    { errors: { code: "idempotency_key_already_used" } },
    { code: "idempotency_key_already_used" },
  ];
  for (const ruim of ruins) {
    assertEquals(idempotencyKeyJaUsado(ruim), false, JSON.stringify(ruim));
  }
});

Deno.test("sentinelaDaChave: só o sentinela DESTA chave (c1 não é c10); formato novo e antigo; nada que não seja texto", () => {
  const chave = `${PEDIDO}:c1`;
  assertEquals(sentinelaDaChave(`verificando:${chave}`, chave), true, "formato antigo (sem o sufixo)");
  assertEquals(sentinelaDaChave(montarSentinela(chave, 1760000000000), chave), true, "formato novo");
  assertEquals(sentinelaDaChave(`verificando:${PEDIDO}:c10`, chave), false, "c10 não é c1");
  assertEquals(sentinelaDaChave(montarSentinela(`${PEDIDO}:c10`, 1760000000000), chave), false);
  assertEquals(sentinelaDaChave(montarSentinela(`${PEDIDO}:c0`, 1760000000000), chave), false, "outra tentativa");
  assertEquals(sentinelaDaChave(chave, chave), false, "a chave sem o prefixo não é sentinela");
  assertEquals(sentinelaDaChave("123456789", chave), false, "id clássico");
  for (const ruim of [null, undefined, 123, {}, ["verificando:x"]]) assertEquals(sentinelaDaChave(ruim, chave), false);
});

Deno.test("limiteInferiorDoSentinela: devolve o instante gravado; antigo, zero, negativo, não numérico e infinito viram null (nunca 'libera por data')", () => {
  const chave = `${PEDIDO}:c0`;
  assertEquals(limiteInferiorDoSentinela(montarSentinela(chave, 1760000000000)), 1760000000000);
  assertEquals(limiteInferiorDoSentinela(`verificando:${chave}`), null, "formato antigo, sem o sufixo");
  assertEquals(limiteInferiorDoSentinela(`verificando:${PEDIDO}:1760000000000`), null, "só 2 pedaços: sem o sufixo");
  for (const ms of ["0", "-5", "abc", "", "Infinity", "NaN"]) {
    assertEquals(limiteInferiorDoSentinela(`verificando:${chave}:${ms}`), null, ms);
  }
  for (const nao of [null, undefined, 5, "123456789", `${PEDIDO}:c0:1760000000000`]) {
    assertEquals(limiteInferiorDoSentinela(nao), null);
  }
});

Deno.test("chaveDoCartaoDaTentativa: tentativa inteira e não negativa vale; fração, negativo, texto e ausente caem em c0", () => {
  assertEquals(chaveDoCartaoDaTentativa(PEDIDO, 0), `${PEDIDO}:c0`);
  assertEquals(chaveDoCartaoDaTentativa(PEDIDO, 3), `${PEDIDO}:c3`);
  assertEquals(chaveDoCartaoDaTentativa(PEDIDO, "2"), `${PEDIDO}:c2`);
  for (const ruim of [1.5, -1, "abc", undefined, NaN, Infinity]) {
    assertEquals(chaveDoCartaoDaTentativa(PEDIDO, ruim), `${PEDIDO}:c0`, String(ruim));
  }
  assertEquals(chaveDoCartaoDaTentativa(PEDIDO, null), `${PEDIDO}:c0`, "null vale 0");
});

// ─── a busca de orders: o total do paging ────────────────────────────────────

async function buscar(corpo: unknown) {
  const original = console.error;
  console.error = () => {};
  try {
    return await buscarOrdersDoPedido({
      token: "token-de-teste",
      pedidoId: PEDIDO,
      desde: "2026-10-01T00:00:00.000Z",
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 })),
    });
  } finally {
    console.error = original;
  }
}

Deno.test("busca de orders: paging.total ZERO é um total legível (a lista é completa), mesmo com a página cheia; total ilegível com a página cheia é indecisão", async () => {
  const outras = Array.from({ length: 25 }, (_, i) => ({ id: `ORD${i}`, external_reference: `outro-${i}` }));
  assertEquals(await buscar({ data: outras, paging: { total: 0 } }), { ok: true, orders: [] });
  assertEquals(await buscar({ data: outras, paging: { total: "abc" } }), { ok: false });
});

// ─── o motivo da recusa: corpo ilegível não derruba ──────────────────────────

Deno.test("motivoDaRecusaDoErro: corpo nulo, erro nulo ou sem details, detalhe que não é texto — sempre a frase padrão, sem lançar", () => {
  const padrao = motivoDaRecusaDoErro(undefined);
  const corpos = [
    null,
    "texto",
    5,
    {},
    { errors: "x" },
    { errors: [null] },
    { errors: [{}] },
    { errors: [{ details: "x" }] },
    { errors: [{ details: [null, 5, {}] }] },
  ];
  for (const corpo of corpos) {
    assertEquals(motivoDaRecusaDoErro(corpo), padrao, JSON.stringify(corpo));
  }
  // O controle: um detalhe conhecido, depois de lixo, é achado.
  const achado = motivoDaRecusaDoErro({ errors: [null, {}, { details: [null, 5, "PAY01: insufficient_amount"] }] });
  assertEquals(achado, "Saldo ou limite insuficiente neste cartão.");
});

// ─── o que vai ao log ────────────────────────────────────────────────────────

Deno.test("resumoSemDadoPessoal: só códigos-palavra e caminhos de campo; e-mail, CPF e texto livre ficam de fora", () => {
  const corpo = {
    error: "bad_request",
    errors: [
      { code: "property_value", message: "payer.email com valor cliente@exemplo.invalid é inválido", details: ["items[0].unit_price"] },
      { code: "texto livre com cliente@exemplo.invalid" },
      null,
      { code: NaN },
    ],
    cause: [{ code: 2062 }],
  };
  const saida = resumoSemDadoPessoal(corpo);
  assert(!saida.includes("cliente@exemplo.invalid"), saida);
  assert(!saida.includes("texto livre"), saida);
  assertEquals(JSON.parse(saida), {
    codigos: ["property_value", 2062],
    erro: "bad_request",
    campos: ["items[0].unit_price", "payer.email"],
  });
});

Deno.test("resumoSemDadoPessoal: sem campo citado não há chave 'campos'; corpo que não é objeto (ou é lista) vira '(corpo não-JSON)'", () => {
  assertEquals(JSON.parse(resumoSemDadoPessoal({ errors: [{ code: "x" }] })), { codigos: ["x"] });
  for (const ruim of [null, undefined, "texto", 42, true, []]) {
    assertEquals(resumoSemDadoPessoal(ruim), "(corpo não-JSON)", JSON.stringify(ruim));
  }
  assertEquals(JSON.parse(resumoSemDadoPessoal({ data: { status: "failed", status_detail: "x" } })), {
    codigos: [],
    status: "failed",
    status_detail: "x",
  });
});

Deno.test("caminhosDeCampoPorErro: uma lista por erro, details antes da mensagem, erro nulo vira lista vazia, corpo ilegível vira []", () => {
  assertEquals(caminhosDeCampoPorErro(null), []);
  assertEquals(caminhosDeCampoPorErro("texto"), []);
  assertEquals(caminhosDeCampoPorErro({}), []);
  assertEquals(caminhosDeCampoPorErro({ errors: "x" }), []);
  assertEquals(
    caminhosDeCampoPorErro({
      errors: [
        null,
        { message: "campo payer.email inválido", details: "items[0].unit_price" },
        { details: ["transactions.payments[0].amount."] },
        { message: "sem campo nenhum" },
      ],
    }),
    [[], ["items[0].unit_price", "payer.email"], ["transactions.payments[0].amount"], []],
  );
});

const PII = {
  message: "falha",
  payer: { email: "cliente-de-teste@exemplo.invalid", identification: { number: "11122233344" } },
};

async function logsDe(f: () => Promise<unknown>): Promise<{ resultado: unknown; log: string }> {
  const linhas: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void linhas.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  try {
    return { resultado: await f(), log: linhas.join(" | ") };
  } finally {
    console.error = original;
  }
}

const respondendo = (status: number, corpo: unknown) => () => Promise.resolve(new Response(JSON.stringify(corpo), { status }));

Deno.test("cancelarOrder: o corpo do erro (com e-mail e CPF do pagador) nunca vai para o log", async () => {
  const { log } = await logsDe(() =>
    cancelarOrder({ token: "t", orderId: "ORD1", chaveIdempotencia: "k", fetchImpl: respondendo(500, PII) })
  );
  assert(log.length > 0);
  assert(!log.includes("cliente-de-teste@exemplo.invalid") && !log.includes("11122233344"), log);
});

Deno.test("consultarOrder: com corpoNoLog:false o corpo (erro e 2xx sem id) não vai ao log; sem o parâmetro (PIX) o corpo vai, como documentado", async () => {
  const consulta = (corpoNoLog: boolean | undefined, status: number, corpo: unknown) =>
    logsDe(() => consultarOrder({ token: "t", orderId: "ORD1", fetchImpl: respondendo(status, corpo), corpoNoLog }));
  for (const [status, corpo] of [[500, PII], [200, PII]]) {
    const fechado = await consulta(false, status, corpo);
    assert(fechado.log.length > 0, `status ${status}`);
    assert(
      !fechado.log.includes("cliente-de-teste@exemplo.invalid") && !fechado.log.includes("11122233344"),
      `status ${status}: ${fechado.log}`,
    );
    const aberto = await consulta(undefined, status, corpo);
    assert(aberto.log.includes("cliente-de-teste@exemplo.invalid"), `status ${status} (default): ${aberto.log}`);
    const explicito = await consulta(true, status, corpo);
    assert(explicito.log.includes("cliente-de-teste@exemplo.invalid"), `status ${status} (true)`);
  }
});

Deno.test("criarOrder: corpo de erro que não é objeto (texto, número, null em JSON) não vira corpoDoErro; o objeto vira", async () => {
  for (const corpo of ["texto", 5, null, true]) {
    const { resultado } = await logsDe(() =>
      criarOrder({ token: "t", corpo: {}, chaveIdempotencia: "k", fetchImpl: respondendo(500, corpo) })
    );
    assertEquals("corpoDoErro" in resultado, false, JSON.stringify(corpo));
  }
  const { resultado } = await logsDe(() =>
    criarOrder({
      token: "t",
      corpo: {},
      chaveIdempotencia: "k",
      fetchImpl: respondendo(409, { errors: [{ code: "idempotency_key_already_used" }] }),
    })
  );
  assertEquals(idempotencyKeyJaUsado(resultado.corpoDoErro), true);
});

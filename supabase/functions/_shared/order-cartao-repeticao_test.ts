/**
 * Testes da repeticao SEM campos opcionais do cartao (03/10/2026).
 *
 * Contexto: um campo OPCIONAL de antifraude (`items[0].external_code`) fez o
 * MP responder 400 `property_value` e derrubou a cobranca de cartao INTEIRA.
 * A regra agora: 400 de validacao que aponta SOMENTE para campo opcional ->
 * UMA repeticao sem eles. O que erra caro (e por isso e' o que se prova):
 *   - repetir quando NAO devia (timeout/5xx/402/409/423: o MP pode ter criado
 *     a order -> segunda cobranca);
 *   - repetir com a MESMA chave de idempotencia (a doc do MP: mesma chave +
 *     corpo diferente = 409, e o cartao ficaria "em verificacao" a toa);
 *   - repetir mais de uma vez.
 *
 * Nada aqui toca a rede: o `fetch` do MP e' um duble que registra cada POST.
 * Dados de comprador sao FALSOS (o repositorio e' publico).
 */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  corpoSemCamposOpcionais,
  criarOrderDeCartao,
  recusaApontaSoCamposOpcionais,
} from "./order-cartao-repeticao.ts";

const EMAIL_FALSO = "comprador.falso@exemplo.test";
const CPF_FALSO = "12345678909";
const TOKEN_FALSO = "tok-0123456789abcdef0123456789abcdef";
const CHAVE = "11111111-2222-4333-8444-555555555555:c0";

function corpoCompleto(): Record<string, unknown> {
  return {
    type: "online",
    processing_mode: "automatic",
    capture_mode: "automatic_async",
    external_reference: "11111111-2222-4333-8444-555555555555",
    total_amount: "100.00",
    payer: {
      email: EMAIL_FALSO,
      first_name: "Maria",
      last_name: "Falsa",
      identification: { type: "CPF", number: CPF_FALSO },
      phone: { area_code: "11", number: "987654321" },
      address: { zip_code: "01001000", street_name: "Rua Falsa", street_number: "10" },
    },
    items: [{ title: "Camiseta", unit_price: "100.00", quantity: 1, description: "Camiseta" }],
    shipment: { address: { zip_code: "01001000", street_name: "Rua Falsa", street_number: "10" } },
    transactions: {
      payments: [{
        amount: "100.00",
        payment_method: {
          id: "visa",
          type: "credit_card",
          token: TOKEN_FALSO,
          installments: 1,
          statement_descriptor: "LOJA TESTE",
        },
      }],
    },
    config: { online: { transaction_security: { validation: "on_fraud_risk", liability_shift: "required" } } },
  };
}

/** Corpo de erro 400 do MP no formato visto em producao: `errors[].details`. */
function erro400(code: string, ...details: string[]): Record<string, unknown> {
  return { errors: [{ code, message: "invalid", details }] };
}

const ERRO_EXTERNAL_CODE = erro400(
  "property_value",
  "items[0].external_code must be at most 30 characters",
);

type Chamada = { url: string; chave: string | null; sessao: string | null; corpo: Record<string, unknown> };

/** Duble do fetch do MP: devolve as respostas na ordem, e registra cada POST. */
function mpFalso(respostas: Array<{ status: number; corpo: unknown } | "rede">) {
  const chamadas: Chamada[] = [];
  const fn = ((url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({
      url,
      chave: headers["X-Idempotency-Key"] ?? null,
      sessao: headers["X-meli-session-id"] ?? null,
      corpo: JSON.parse(String(init?.body)),
    });
    const resposta = respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
    if (resposta === "rede") return Promise.reject(new TypeError("network error"));
    return Promise.resolve(new Response(JSON.stringify(resposta.corpo), { status: resposta.status }));
  }) as unknown as typeof fetch;
  return { fn, chamadas };
}

const ORDER_OK = { id: "ORDTST01", status: "processed", status_detail: "accredited" };

function chamar(fetchImpl: typeof fetch, corpo = corpoCompleto()) {
  return criarOrderDeCartao({
    token: "token-de-teste",
    corpo,
    chaveIdempotencia: CHAVE,
    fetchImpl,
    deviceId: "device-falso.123",
    corpoNoLog: false,
  });
}

/** Captura o que as funcoes logam, para provar que nao ha dado pessoal. */
async function comLogsCapturados<T>(trabalho: () => Promise<T>): Promise<{ resultado: T; logs: string }> {
  const originais = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  const linhas: unknown[][] = [];
  const captura = (...args: unknown[]) => {
    linhas.push(args);
  };
  console.warn = captura;
  console.error = captura;
  console.info = captura;
  console.log = captura;
  try {
    const resultado = await trabalho();
    return { resultado, logs: JSON.stringify(linhas) };
  } finally {
    Object.assign(console, originais);
  }
}

// ─── recusaApontaSoCamposOpcionais ──────────────────────────────────────────

Deno.test("recusaApontaSoCamposOpcionais: o caso do incidente (items[0].external_code, property_value) -> true", () => {
  assertEquals(recusaApontaSoCamposOpcionais(ERRO_EXTERNAL_CODE), true);
});

Deno.test("recusaApontaSoCamposOpcionais: todos os campos opcionais de antifraude sao reconhecidos", () => {
  for (
    const detalhe of [
      "items[0].title is too long",
      "items must contain at most 20 elements",
      "payer.phone.number must match pattern",
      "payer.address.zip_code is invalid",
      "shipment.address.state must have exactly 2 characters",
      "transactions.payments[0].payment_method.statement_descriptor is too long",
    ]
  ) {
    assertEquals(recusaApontaSoCamposOpcionais(erro400("property_value", detalhe)), true, detalhe);
  }
});

Deno.test("recusaApontaSoCamposOpcionais: varios erros, todos em opcionais -> true", () => {
  const corpo = {
    errors: [
      { code: "property_value", details: ["payer.phone.number is invalid"] },
      { code: "property_type", message: "items[1].quantity must be integer" },
    ],
  };
  assertEquals(recusaApontaSoCamposOpcionais(corpo), true);
});

Deno.test("recusaApontaSoCamposOpcionais: a palavra 'type' na frase NAO conta como campo (property_type de um opcional ainda repete)", () => {
  assertEquals(
    recusaApontaSoCamposOpcionais(erro400("property_type", "items[0].quantity must be of type integer")),
    true,
  );
});

Deno.test("recusaApontaSoCamposOpcionais: campo OBRIGATORIO recusado -> false (payer.email, transactions, token, valor)", () => {
  for (
    const detalhe of [
      "payer.email domain is not allowed",
      "transactions.payments[0].amount is invalid",
      "transactions.payments[0].payment_method.token is invalid",
      "total_amount must match pattern",
      "payer.identification.number is invalid",
      "payer.first_name contains invalid characters",
      "payer.phonenumber is invalid", // vizinho de nome parecido: NAO e' payer.phone
      "external_reference is invalid",
    ]
  ) {
    assertEquals(recusaApontaSoCamposOpcionais(erro400("property_value", detalhe)), false, detalhe);
  }
});

Deno.test("recusaApontaSoCamposOpcionais: opcional E obrigatorio no MESMO erro ou em erros diferentes -> false", () => {
  assertEquals(
    recusaApontaSoCamposOpcionais(erro400("property_value", "items[0].title and payer.email are invalid")),
    false,
  );
  assertEquals(
    recusaApontaSoCamposOpcionais({
      errors: [
        { code: "property_value", details: ["items[0].title is invalid"] },
        { code: "property_value", details: ["transactions.payments[0].amount is invalid"] },
      ],
    }),
    false,
  );
});

Deno.test("recusaApontaSoCamposOpcionais: um erro sem caminho de campo identificavel invalida o conjunto -> false", () => {
  assertEquals(
    recusaApontaSoCamposOpcionais({
      errors: [
        { code: "property_value", details: ["items[0].title is invalid"] },
        { code: "property_value", message: "Algo deu errado" },
      ],
    }),
    false,
  );
});

Deno.test("recusaApontaSoCamposOpcionais: codigo que nao e' de validacao de campo -> false, mesmo citando um opcional", () => {
  for (const code of ["invalid_card_token", "invalid_total_amount", "required_properties", "idempotency_key_already_used", "failed"]) {
    assertEquals(recusaApontaSoCamposOpcionais(erro400(code, "items[0].title")), false, code);
  }
});

Deno.test("recusaApontaSoCamposOpcionais: corpo vazio, sem errors, errors vazio ou nao-objeto -> false", () => {
  for (const corpo of [undefined, null, "texto", 42, {}, { errors: [] }, { errors: "x" }, { errors: [null] }]) {
    assertEquals(recusaApontaSoCamposOpcionais(corpo), false);
  }
});

Deno.test("recusaApontaSoCamposOpcionais: se o corpo do erro CARREGA uma order (id), ela pode existir -> false", () => {
  assertEquals(recusaApontaSoCamposOpcionais({ ...ERRO_EXTERNAL_CODE, data: { id: "ORDTST99" } }), false);
  assertEquals(recusaApontaSoCamposOpcionais({ ...ERRO_EXTERNAL_CODE, id: "ORDTST99" }), false);
});

// ─── corpoSemCamposOpcionais ────────────────────────────────────────────────

Deno.test("corpoSemCamposOpcionais tira items, payer.phone, payer.address, shipment e statement_descriptor", () => {
  const { corpo, removeu } = corpoSemCamposOpcionais(corpoCompleto());
  assertEquals(removeu, true);
  assertEquals("items" in corpo, false);
  assertEquals("shipment" in corpo, false);
  const payer = corpo.payer as Record<string, unknown>;
  assertEquals("phone" in payer, false);
  assertEquals("address" in payer, false);
  const metodo = ((corpo.transactions as Record<string, unknown>).payments as Array<Record<string, unknown>>)[0]
    .payment_method as Record<string, unknown>;
  assertEquals("statement_descriptor" in metodo, false);
});

Deno.test("corpoSemCamposOpcionais NAO toca no que cobra: valor, pagador, documento, token, parcelas, 3DS", () => {
  const original = corpoCompleto();
  const { corpo } = corpoSemCamposOpcionais(original);
  const esperado = corpoCompleto();
  delete esperado.items;
  delete esperado.shipment;
  delete (esperado.payer as Record<string, unknown>).phone;
  delete (esperado.payer as Record<string, unknown>).address;
  delete ((esperado.transactions as { payments: Array<{ payment_method: Record<string, unknown> }> }).payments[0]
    .payment_method).statement_descriptor;
  assertEquals(corpo, esperado);
});

Deno.test("corpoSemCamposOpcionais nao muda o corpo original (copia) e diz removeu:false quando nao havia nada", () => {
  const original = corpoCompleto();
  corpoSemCamposOpcionais(original);
  assertEquals(original, corpoCompleto());

  const enxuto = corpoCompleto();
  delete enxuto.items;
  delete enxuto.shipment;
  delete (enxuto.payer as Record<string, unknown>).phone;
  delete (enxuto.payer as Record<string, unknown>).address;
  delete ((enxuto.transactions as { payments: Array<{ payment_method: Record<string, unknown> }> }).payments[0]
    .payment_method).statement_descriptor;
  const resultado = corpoSemCamposOpcionais(enxuto);
  assertEquals(resultado.removeu, false);
  assertEquals(resultado.corpo, enxuto);
});

// ─── criarOrderDeCartao: a repeticao ────────────────────────────────────────

Deno.test("400 em items[0].external_code -> repete UMA vez sem os opcionais e APROVA", async () => {
  const mp = mpFalso([{ status: 400, corpo: ERRO_EXTERNAL_CODE }, { status: 201, corpo: ORDER_OK }]);
  const r = await chamar(mp.fn);

  assertEquals(r.ok, true);
  assertEquals(mp.chamadas.length, 2);
  // 1a chamada: o corpo COMPLETO, exatamente como foi pedido.
  assertEquals(mp.chamadas[0].corpo, corpoCompleto());
  // 2a chamada: sem NENHUM opcional, e com tudo que cobra intacto.
  const segundo = mp.chamadas[1].corpo;
  assertEquals("items" in segundo, false);
  assertEquals("shipment" in segundo, false);
  assertEquals((segundo.payer as Record<string, unknown>).email, EMAIL_FALSO);
  assertEquals(segundo.total_amount, "100.00");
  assertEquals(mp.chamadas[1].url.endsWith("/v1/orders"), true);
  // O Device ID e' cabecalho do antifraude: vai nas DUAS.
  assertEquals(mp.chamadas.map((c) => c.sessao), ["device-falso.123", "device-falso.123"]);
});

Deno.test("a repeticao usa uma chave de idempotencia NOVA (a mesma chave + corpo diferente = 409 do MP) e a 1a usa a original", async () => {
  const mp = mpFalso([{ status: 400, corpo: ERRO_EXTERNAL_CODE }, { status: 201, corpo: ORDER_OK }]);
  await chamar(mp.fn);

  const [primeira, segunda] = mp.chamadas.map((c) => c.chave);
  assertEquals(primeira, CHAVE);
  assertEquals(segunda === primeira, false);
  assertEquals(typeof segunda, "string");
  // Derivada da original (rastreavel) e dentro do limite de 128 caracteres da doc.
  assertEquals(segunda!.startsWith(`${CHAVE}:`), true);
  assertEquals(segunda!.length <= 128, true);
  // Nao pode colidir com a chave da PROXIMA tentativa do pedido (`:c1`).
  assertEquals(segunda!.startsWith("11111111-2222-4333-8444-555555555555:c1"), false);
});

Deno.test("400 em campo OBRIGATORIO (payer.email, transactions) -> NAO repete", async () => {
  for (
    const detalhe of ["payer.email domain is not allowed", "transactions.payments[0].amount is invalid"]
  ) {
    const mp = mpFalso([{ status: 400, corpo: erro400("property_value", detalhe) }, { status: 201, corpo: ORDER_OK }]);
    const r = await chamar(mp.fn);
    assertEquals(mp.chamadas.length, 1, detalhe);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.status, 400);
  }
});

Deno.test("400 misto (opcional + obrigatorio) -> NAO repete", async () => {
  const mp = mpFalso([
    { status: 400, corpo: erro400("property_value", "items[0].title is invalid", "payer.email is invalid") },
    { status: 201, corpo: ORDER_OK },
  ]);
  await chamar(mp.fn);
  assertEquals(mp.chamadas.length, 1);
});

Deno.test("NUNCA repete fora do 400: 5xx, timeout/rede, 401, 402, 403, 408, 409, 423, 429 -> exatamente 1 chamada", async () => {
  // O corpo do erro cita um opcional DE PROPOSITO: so o status segura a repeticao.
  const citaOpcional = ERRO_EXTERNAL_CODE;
  const casos: Array<[string, { status: number; corpo: unknown } | "rede"]> = [
    ["500", { status: 500, corpo: citaOpcional }],
    ["502", { status: 502, corpo: citaOpcional }],
    ["503", { status: 503, corpo: citaOpcional }],
    ["rede/timeout", "rede"],
    ["401", { status: 401, corpo: citaOpcional }],
    ["402", { status: 402, corpo: { ...citaOpcional, data: { id: "ORDTST7", status: "failed" } } }],
    ["402 sem order no corpo", { status: 402, corpo: citaOpcional }],
    ["403", { status: 403, corpo: citaOpcional }],
    ["408", { status: 408, corpo: citaOpcional }],
    ["409", { status: 409, corpo: erro400("idempotency_key_already_used", "items[0].title") }],
    ["423", { status: 423, corpo: erro400("resource_locked", "items[0].title") }],
    ["429", { status: 429, corpo: citaOpcional }],
  ];
  for (const [nome, resposta] of casos) {
    const mp = mpFalso([resposta, { status: 201, corpo: ORDER_OK }]);
    const r = await chamar(mp.fn);
    assertEquals(mp.chamadas.length, 1, nome);
    assertEquals(r.ok, false, nome);
  }
});

Deno.test("timeout de verdade (o sinal de aborto dispara) -> NAO repete: o MP pode ter criado a order", async () => {
  let chamadas = 0;
  const fetchPendurado = ((_url: string, init?: RequestInit) => {
    chamadas++;
    return new Promise<Response>((_resolve, rejeitar) => {
      init?.signal?.addEventListener("abort", () => rejeitar(new DOMException("aborted", "AbortError")));
    });
  }) as unknown as typeof fetch;
  const r = await criarOrderDeCartao({
    token: "t",
    corpo: corpoCompleto(),
    chaveIdempotencia: CHAVE,
    fetchImpl: fetchPendurado,
    tempoLimiteMs: 20,
    corpoNoLog: false,
  });
  assertEquals(chamadas, 1);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 0);
});

Deno.test("no MAXIMO 2 chamadas: se a repeticao tambem volta 400 de opcional, devolve esse resultado e para", async () => {
  const mp = mpFalso([{ status: 400, corpo: ERRO_EXTERNAL_CODE }]); // toda chamada devolve o mesmo 400
  const r = await chamar(mp.fn);
  assertEquals(mp.chamadas.length, 2);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 400);
});

Deno.test("repeticao que volta 5xx ou rede: devolve a falha da SEGUNDA (quem chama trata como ambigua) e para em 2", async () => {
  for (const segunda of [{ status: 500, corpo: {} }, "rede"] as const) {
    const mp = mpFalso([{ status: 400, corpo: ERRO_EXTERNAL_CODE }, segunda]);
    const r = await chamar(mp.fn);
    assertEquals(mp.chamadas.length, 2);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.status, segunda === "rede" ? 0 : 500);
  }
});

Deno.test("repeticao recusada pelo emissor (402) volta como 402 para quem chama tratar como recusa", async () => {
  const mp = mpFalso([
    { status: 400, corpo: ERRO_EXTERNAL_CODE },
    { status: 402, corpo: { errors: [{ code: "failed" }], data: { id: "ORDTST5", status: "failed" } } },
  ]);
  const r = await chamar(mp.fn);
  assertEquals(mp.chamadas.length, 2);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 402);
});

Deno.test("400 de opcional mas o corpo JA nao tinha nenhum opcional -> NAO repete (repetir mandaria o mesmo corpo)", async () => {
  const enxuto = corpoCompleto();
  delete enxuto.items;
  delete enxuto.shipment;
  delete (enxuto.payer as Record<string, unknown>).phone;
  delete (enxuto.payer as Record<string, unknown>).address;
  delete ((enxuto.transactions as { payments: Array<{ payment_method: Record<string, unknown> }> }).payments[0]
    .payment_method).statement_descriptor;
  const mp = mpFalso([{ status: 400, corpo: ERRO_EXTERNAL_CODE }, { status: 201, corpo: ORDER_OK }]);
  const r = await chamar(mp.fn, enxuto);
  assertEquals(mp.chamadas.length, 1);
  assertEquals(r.ok, false);
});

Deno.test("sucesso de primeira: 1 chamada, sem repeticao, corpo e chave intactos", async () => {
  const mp = mpFalso([{ status: 201, corpo: ORDER_OK }]);
  const r = await chamar(mp.fn);
  assertEquals(r.ok, true);
  assertEquals(mp.chamadas.length, 1);
  assertEquals(mp.chamadas[0].corpo, corpoCompleto());
  assertEquals(mp.chamadas[0].chave, CHAVE);
});

Deno.test("o log da repeticao diz QUAL campo caiu, e NAO leva dado pessoal (e-mail, CPF, token, rua, telefone)", async () => {
  const erroComEco = erro400(
    "property_value",
    `items[0].external_code ${EMAIL_FALSO} ${CPF_FALSO} ${TOKEN_FALSO} Rua Falsa 987654321 is invalid`,
  );
  const mp = mpFalso([{ status: 400, corpo: erroComEco }, { status: 201, corpo: ORDER_OK }]);
  const { resultado, logs } = await comLogsCapturados(() => chamar(mp.fn));

  assertEquals(resultado.ok, true);
  assertStringIncludes(logs, "repet"); // o log da repeticao existe
  assertStringIncludes(logs, "items[0].external_code"); // e diz o campo
  for (const dado of [EMAIL_FALSO, CPF_FALSO, TOKEN_FALSO, "Rua Falsa", "987654321", "Maria", CHAVE]) {
    assertEquals(logs.includes(dado), false, `vazou: ${dado}`);
  }
});

Deno.test("recusaApontaSoCamposOpcionais: indice de item com 2 digitos (items[12]) tambem e' reconhecido", () => {
  assertEquals(recusaApontaSoCamposOpcionais(erro400("property_value", "items[12].title is too long")), true);
  assertEquals(recusaApontaSoCamposOpcionais(erro400("property_value", "items[12].title and payer.email")), false);
});

Deno.test("o log da repeticao descarta um 'caminho' com valor colado (3+ digitos seguidos) em vez de logar o valor", async () => {
  // O MP ecoa o valor logo depois do campo, sem espaco: o caminho capturado
  // carrega o telefone junto. A repeticao acontece (o campo e' opcional), mas
  // o log nao pode levar os digitos.
  const mp = mpFalso([
    { status: 400, corpo: erro400("property_value", "payer.phone.number987654321 is invalid", "items[0].title is long") },
    { status: 201, corpo: ORDER_OK },
  ]);
  const { resultado, logs } = await comLogsCapturados(() => chamar(mp.fn));
  assertEquals(resultado.ok, true);
  assertEquals(mp.chamadas.length, 2);
  assertStringIncludes(logs, "items[0].title");
  assertEquals(logs.includes("987654321"), false);
});

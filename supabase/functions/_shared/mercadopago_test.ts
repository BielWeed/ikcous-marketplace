// @ts-nocheck
/**
 * Testes do cliente do Mercado Pago (CHECKOUT-010, #109).
 *
 * Nada aqui toca a rede: `criarPagamento` recebe o `fetch` por parâmetro, e os
 * testes passam um stub. O que se prova é o que erra caro — corpo com valor
 * errado cobra o cliente errado, e status mal mapeado marca como pago um
 * pedido recusado.
 */
import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  consultarOrder,
  consultarPagamento,
  criarOrder,
  criarPagamento,
  extrairDataExpiracaoOrder,
  extrairQrCode,
  formatarExpiracao,
  idEhClassico,
  MAPA_STATUS_ORDER,
  mapearStatus,
  mapearStatusOrder,
  minutosDaExpiracaoPix,
  montarCorpoCartao,
  montarCorpoPix,
  montarCorpoPixOrders,
} from "./mercadopago.ts";

Deno.test("mapearStatus traduz o que o MP devolve", () => {
  assertEquals(mapearStatus("approved"), "pago");
  assertEquals(mapearStatus("rejected"), "recusado");
  assertEquals(mapearStatus("cancelled"), "recusado");
  assertEquals(mapearStatus("pending"), "aguardando");
  assertEquals(mapearStatus("in_process"), "aguardando");
  assertEquals(mapearStatus("authorized"), "aguardando");
  assertEquals(mapearStatus("refunded"), "estornado");
  assertEquals(mapearStatus("charged_back"), "estornado");
});

Deno.test("mapearStatus devolve null para o que não conhece", () => {
  // Vale mais que um default otimista: status novo do MP não pode virar
  // 'pago' por engano. Quem chama decide o que fazer com o desconhecido.
  for (const desconhecido of ["", "qualquer_coisa", "APPROVED", null, undefined]) {
    assertEquals(mapearStatus(desconhecido as string), null);
  }
});

Deno.test("idEhClassico: só dígitos é clássico; qualquer outra forma (order/ULID) não é", () => {
  // Id clássico de pagamento do MP é sempre numérico ("123456789012").
  assertEquals(idEhClassico("123456789012"), true);
  assertEquals(idEhClassico("999"), true);
  // Id de order (Orders API): ULID maiúsculo, prefixo "ORD" em produção,
  // "ORDTST" em teste — nunca só dígitos.
  assertEquals(idEhClassico("ORDTST01KZZ4D94WC79335A68CZ5NZ7X"), false);
  assertEquals(idEhClassico("ORD01KZZ4D94WC79335A68CZ5NZ7X"), false);
  // Vazio e formas mistas também não são clássicas.
  assertEquals(idEhClassico(""), false);
  assertEquals(idEhClassico("123abc"), false);
  assertEquals(idEhClassico("abc123"), false);
});

Deno.test("montarCorpoPix leva valor, e-mail, validade e a referência do pedido", () => {
  const corpo = montarCorpoPix({
    valor: 149.9,
    descricao: "Pedido 3f2a1b8c",
    email: "cliente@exemplo.com",
    expiraEm: "2026-08-06T15:30:00.000-03:00",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
  });

  assertEquals(corpo.transaction_amount, 149.9);
  assertEquals(corpo.payment_method_id, "pix");
  assertEquals((corpo.payer as Record<string, unknown>).email, "cliente@exemplo.com");
  assertEquals(corpo.date_of_expiration, "2026-08-06T15:30:00.000-03:00");
  // Sem isso o MP não guarda ponteiro de volta para o pedido, e a
  // reconciliação da Fase 3 teria que casar valor + e-mail + horário na mão.
  assertEquals(corpo.external_reference, "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
});

Deno.test("montarCorpoPix leva o documento do pagador quando informado", () => {
  // A-2 da revisão final: o documento atravessava front → criar-pagamento e
  // sumia aqui, porque montarCorpoPix nem tinha o parâmetro na assinatura.
  // O corpo saía com `payer: { email }` e mais nada — e a documentação de
  // PIX do MP monta o payer com identification.
  const corpo = montarCorpoPix({
    valor: 149.9,
    descricao: "Pedido 3f2a1b8c",
    email: "cliente@exemplo.com",
    expiraEm: "2026-08-06T15:30:00.000-03:00",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    documento: { type: "CPF", number: "12345678909" },
  });

  assertEquals((corpo.payer as Record<string, unknown>).identification, {
    type: "CPF",
    number: "12345678909",
  });
  // E o e-mail continua no payer — o documento não pode substituí-lo.
  assertEquals((corpo.payer as Record<string, unknown>).email, "cliente@exemplo.com");
});

Deno.test("montarCorpoPix não quebra quando o documento não vem", () => {
  const corpo = montarCorpoPix({
    valor: 149.9,
    descricao: "Pedido 3f2a1b8c",
    email: "cliente@exemplo.com",
    expiraEm: "2026-08-06T15:30:00.000-03:00",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
  });

  assertEquals(
    (corpo.payer as Record<string, unknown>).identification,
    undefined,
  );
});

Deno.test("montarCorpoPix leva notification_url quando informado — Task 7 da Fase 3", () => {
  // Sem isto o webhook depende de configuracao no painel do MP — que ninguem
  // percebe quando some, e nenhum teste pega. Herança nº 4 da Fase 2.
  const corpo = montarCorpoPix({
    valor: 149.9,
    descricao: "Pedido 3f2a1b8c",
    email: "cliente@exemplo.com",
    expiraEm: "2026-08-06T15:30:00.000-03:00",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    notificationUrl: "https://xyz.supabase.co/functions/v1/webhook-mercadopago",
  });

  assertEquals(
    corpo.notification_url,
    "https://xyz.supabase.co/functions/v1/webhook-mercadopago",
  );
});

Deno.test("montarCorpoPix sem notificationUrl NÃO inclui a chave no corpo — não pode virar 'undefined' serializado", () => {
  // Asserção sobre a CHAVE, não sobre o valor: `corpo.notification_url ===
  // undefined` passaria tanto se a chave nunca existisse quanto se existisse
  // com valor `undefined` (que o JSON.stringify do fetch real simplesmente
  // omite, mas que um mutante poderia deixar passar aqui sem que este teste
  // acusasse).
  const corpo = montarCorpoPix({
    valor: 149.9,
    descricao: "Pedido 3f2a1b8c",
    email: "cliente@exemplo.com",
    expiraEm: "2026-08-06T15:30:00.000-03:00",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
  });

  assertEquals("notification_url" in corpo, false);
});

Deno.test("montarCorpoCartao leva o token, a referência do pedido, e NUNCA dados do cartão", () => {
  const corpo = montarCorpoCartao({
    valor: 149.9,
    descricao: "Pedido 3f2a1b8c",
    email: "cliente@exemplo.com",
    token: "tok_teste_123",
    parcelas: 3,
    metodo: "visa",
    emissor: "310",
    documento: { type: "CPF", number: "12345678909" },
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
  });

  assertEquals(corpo.token, "tok_teste_123");
  assertEquals(corpo.installments, 3);
  assertEquals(corpo.payment_method_id, "visa");
  assertEquals(corpo.issuer_id, "310");
  assertEquals(corpo.external_reference, "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b");

  // O número do cartão é tokenizado NO NAVEGADOR e não passa por aqui. Se
  // algum dia passar, este teste é o que avisa.
  const serializado = JSON.stringify(corpo);
  assertEquals(serializado.includes("card_number"), false);
  assertEquals(serializado.includes("security_code"), false);
});

Deno.test("formatarExpiracao devolve ISO com offset, que é o que o MP aceita", () => {
  const saida = formatarExpiracao("2026-08-06T18:30:00.000Z");
  // O MP recusa 'Z' e exige offset explícito.
  assertEquals(saida.endsWith("Z"), false);
  assertStringIncludes(saida, "2026-08-06T");
  assertEquals(/[+-]\d{2}:\d{2}$/.test(saida), true);
});

Deno.test("formatarExpiracao fixa o instante certo, não só o formato", () => {
  // Mutante perigoso: trocar o rótulo para -02:00 sem mexer no deslocamento
  // deixaria os dois testes de formato acima passando, e desloca a
  // expiração em 1h contra uma reserva de estoque de 30 min. Esta asserção
  // de valor exato é o que pega isso.
  assertEquals(
    formatarExpiracao("2026-08-06T18:30:00.000Z"),
    "2026-08-06T15:30:00.000-03:00",
  );
});

Deno.test("criarPagamento manda o token e a chave de idempotência", async () => {
  let capturada: { url: string; init: RequestInit } | null = null;

  const fetchStub = ((url: string, init: RequestInit) => {
    capturada = { url, init };
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 1234567890,
          status: "pending",
          point_of_interaction: {
            transaction_data: {
              qr_code: "00020126…",
              qr_code_base64: "iVBORw0KGgo=",
              ticket_url: "https://www.mercadopago.com.br/payments/123/ticket",
            },
          },
        }),
        { status: 201 },
      ),
    );
  }) as unknown as typeof fetch;

  const r = await criarPagamento({
    token: "TEST-token",
    corpo: { transaction_amount: 10 },
    chaveIdempotencia: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, true);
  if (r.ok) {
    // id vira string: o MP devolve número, e a coluna é text.
    assertEquals(r.id, "1234567890");
    assertEquals(r.status, "pending");
    assertEquals(r.qrCode, "00020126…");
  }

  const headers = capturada!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer TEST-token");
  assertEquals(headers["X-Idempotency-Key"], "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
  assertStringIncludes(capturada!.url, "/v1/payments");

  // Apagar o `body` do fetch deixaria o resto da suíte verde — é este valor,
  // o transaction_amount, que atravessa o corpo e decide quanto se cobra.
  assertEquals(
    JSON.parse(capturada!.init.body as string).transaction_amount,
    10,
  );
});

Deno.test("criarPagamento não rejeita quando o MP devolve 2xx com corpo ilegível", async () => {
  const fetchStub = (() =>
    Promise.resolve(
      new Response("<html>502</html>", { status: 201 }),
    )) as unknown as typeof fetch;

  const r = await criarPagamento({
    token: "TEST-token",
    corpo: {},
    chaveIdempotencia: "id-3",
    fetchImpl: fetchStub,
  });

  // Nenhum caminho de criarPagamento pode rejeitar: a Task 2 não tem
  // try/catch externo em volta desta chamada.
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 201);
});

Deno.test("criarPagamento não rejeita e não devolve ok quando o corpo 2xx não tem id", async () => {
  const fetchStub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ status: "pending" }), { status: 201 }),
    )) as unknown as typeof fetch;

  const r = await criarPagamento({
    token: "TEST-token",
    corpo: {},
    chaveIdempotencia: "id-4",
    fetchImpl: fetchStub,
  });

  // "undefined" nunca pode ir para gateway_payment_id: a coluna tem índice
  // UNIQUE parcial, e a segunda ocorrência estoura 23505.
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 201);
});

Deno.test("criarPagamento não vaza o corpo do erro do MP para quem chamou", async () => {
  const fetchStub = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ message: "invalid access token", cause: [{ code: 2001 }] }),
        { status: 401 },
      ),
    )) as unknown as typeof fetch;

  const r = await criarPagamento({
    token: "TEST-errado",
    corpo: {},
    chaveIdempotencia: "id-1",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 401);
    // Mensagem genérica: o detalhe do gateway vai para o log da função, não
    // para o navegador do cliente.
    assertEquals(r.erro.includes("access token"), false);
  }
});

Deno.test("criarPagamento trata rede caída sem estourar", async () => {
  const fetchStub = (() =>
    Promise.reject(new Error("connection refused"))) as unknown as typeof fetch;

  const r = await criarPagamento({
    token: "TEST-token",
    corpo: {},
    chaveIdempotencia: "id-2",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 0);
});

// --- consultarPagamento: reconsulta a cobrança já criada (CHECKOUT-050) ---
//
// O QR do PIX só existe na resposta da criação. O navegador mobile descarta a
// aba enquanto o cliente vai ao app do banco; ao voltar, a tela remonta e
// precisa do MESMO QR — sem criar uma segunda cobrança. `consultarPagamento`
// é a leitura que sustenta isso: GET, sem corpo, sem chave de idempotência
// (não é escrita).

Deno.test("consultarPagamento consulta por GET, sem corpo e sem chave de idempotência", async () => {
  let capturada: { url: string; init: RequestInit } | null = null;

  const fetchStub = ((url: string, init: RequestInit) => {
    capturada = { url, init };
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 1234567890,
          status: "pending",
          point_of_interaction: {
            transaction_data: {
              qr_code: "00020126…",
              qr_code_base64: "iVBORw0KGgo=",
            },
          },
        }),
        { status: 200 },
      ),
    );
  }) as unknown as typeof fetch;

  const r = await consultarPagamento({
    token: "TEST-token",
    paymentId: "1234567890",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.id, "1234567890");
    assertEquals(r.status, "pending");
    assertEquals(r.qrCode, "00020126…");
  }

  assertEquals(capturada!.init.method, "GET");
  assertEquals(capturada!.init.body, undefined);
  const headers = capturada!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer TEST-token");
  assertEquals(headers["X-Idempotency-Key"], undefined);
  assertStringIncludes(capturada!.url, "/v1/payments/1234567890");
});

Deno.test("consultarPagamento devolve o external_reference da resposta do MP — Task 4 precisa dele para achar o pedido", async () => {
  // O corpo do webhook NÃO é confiável para descobrir de qual pedido se
  // trata (qualquer um pode forjar um POST); a resposta do MP, autenticada
  // pelo token do gateway, é. Sem este campo a webhook-mercadopago não tem
  // como montar `p_order_id` para `confirmar_pagamento`.
  const fetchStub = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 999,
          status: "approved",
          external_reference: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
        }),
        { status: 200 },
      ),
    )) as unknown as typeof fetch;

  const r = await consultarPagamento({
    token: "TEST-token",
    paymentId: "999",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.externalReference, "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
  }
});

Deno.test("consultarPagamento não vaza o corpo do erro quando o MP devolve 404", async () => {
  const fetchStub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ message: "Payment not found" }), { status: 404 }),
    )) as unknown as typeof fetch;

  const r = await consultarPagamento({
    token: "TEST-token",
    paymentId: "id-inexistente",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 404);
    assertEquals(r.erro.includes("not found"), false);
  }
});

Deno.test("consultarPagamento não rejeita quando o MP devolve 2xx com corpo ilegível", async () => {
  const fetchStub = (() =>
    Promise.resolve(new Response("<html>502</html>", { status: 200 }))) as unknown as typeof fetch;

  const r = await consultarPagamento({
    token: "TEST-token",
    paymentId: "id-5",
    fetchImpl: fetchStub,
  });

  // Mesma regra da Task 1 para criarPagamento: nenhum caminho pode rejeitar.
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 200);
});

// --- Orders API (Task 1 da migração CHECKOUT-070) ---
//
// Diagnóstico medido contra a API real: `POST /v1/payments` com
// `payment_method_id: "pix"` devolve 500 hoje; `POST /v1/orders` devolve 201
// com QR Code. As funções abaixo são o caminho novo, ADICIONADO ao lado do
// clássico — as Tasks 2 a 4 ainda não migraram, e apagar o clássico agora
// quebraria a build delas.

Deno.test("montarCorpoPixOrders manda total_amount e o amount do pagamento como STRING de duas casas — o clássico usava número", () => {
  const corpo = montarCorpoPixOrders({
    valor: 50,
    email: "cliente@exemplo.com",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    expiracao: "PT30M",
  });

  assertEquals(corpo.total_amount, "50.00");
  assertEquals(corpo.type, "online");
  const transacoes = corpo.transactions as Record<string, unknown>;
  const pagamentos = transacoes.payments as Record<string, unknown>[];
  assertEquals(pagamentos[0].amount, "50.00");
  assertEquals(pagamentos[0].payment_method, { id: "pix", type: "bank_transfer" });
});

Deno.test("montarCorpoPixOrders arredonda para duas casas mesmo com valor quebrado", () => {
  const corpo = montarCorpoPixOrders({
    valor: 149.9,
    email: "cliente@exemplo.com",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    expiracao: "PT30M",
  });

  assertEquals(corpo.total_amount, "149.90");
  const transacoes = corpo.transactions as Record<string, unknown>;
  const pagamentos = transacoes.payments as Record<string, unknown>[];
  assertEquals(pagamentos[0].amount, "149.90");
});

Deno.test("montarCorpoPixOrders leva o external_reference — é o que a reconciliação usa para achar a cobrança", () => {
  const corpo = montarCorpoPixOrders({
    valor: 50,
    email: "cliente@exemplo.com",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    expiracao: "PT30M",
  });

  assertEquals(corpo.external_reference, "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
});

Deno.test("montarCorpoPixOrders leva o e-mail e o documento do pagador quando informados", () => {
  const corpo = montarCorpoPixOrders({
    valor: 50,
    email: "cliente@exemplo.com",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    expiracao: "PT30M",
    documento: { type: "CPF", number: "12345678909" },
    nome: "Maria",
  });

  const payer = corpo.payer as Record<string, unknown>;
  assertEquals(payer.email, "cliente@exemplo.com");
  assertEquals(payer.first_name, "Maria");
  assertEquals(payer.identification, { type: "CPF", number: "12345678909" });
});

Deno.test("montarCorpoPixOrders não quebra e não inclui first_name/identification quando não vêm", () => {
  const corpo = montarCorpoPixOrders({
    valor: 50,
    email: "cliente@exemplo.com",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    expiracao: "PT30M",
  });

  const payer = corpo.payer as Record<string, unknown>;
  assertEquals("first_name" in payer, false);
  assertEquals("identification" in payer, false);
});

// --- Achado 1 da revisão do PR: expiração da Orders API é OBRIGATÓRIA ---
//
// Sem expiration_time, o MP usa o default de 24h contra uma reserva de
// estoque de 30 min (20260807000000_reserva_com_expiracao.sql) — e a folga
// de pagamentos_a_reconciliar() (`expires_at > now() - interval '24 hours'`)
// cai de ~48x para 1,02x. `throw` em runtime, não parâmetro opcional de
// tipo: este arquivo tem `// @ts-nocheck` e `test:edge` roda com
// `deno test --no-check` — nenhum "obrigatório" do TypeScript obriga nada
// aqui.

Deno.test("montarCorpoPixOrders manda a expiração em transactions.payments[0].expiration_time, na duração recebida", () => {
  const corpo = montarCorpoPixOrders({
    valor: 50,
    email: "cliente@exemplo.com",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    expiracao: "PT30M",
  });

  const transacoes = corpo.transactions as Record<string, unknown>;
  const pagamentos = transacoes.payments as Record<string, unknown>[];
  assertEquals(pagamentos[0].expiration_time, "PT30M");
});

Deno.test("montarCorpoPixOrders lança quando a expiração não vem — default de 24h do MP mataria a folga da reconciliação", () => {
  assertThrows(() =>
    montarCorpoPixOrders({
      valor: 50,
      email: "cliente@exemplo.com",
      orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    } as unknown as Parameters<typeof montarCorpoPixOrders>[0])
  );
});

Deno.test("montarCorpoPixOrders lança quando a expiração não é uma duração ISO 8601 válida (/^PT\\d+[MH]$/)", () => {
  // "30M" sem o prefixo PT, "PT" sem número, "PT30S" em segundos (o MP só
  // aceita M/H), string vazia e null — nenhum passa pelo formato exigido.
  for (const invalida of ["30M", "PT", "PT30S", ""]) {
    assertThrows(() =>
      montarCorpoPixOrders({
        valor: 50,
        email: "cliente@exemplo.com",
        orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
        expiracao: invalida,
      })
    );
  }
  assertThrows(() =>
    montarCorpoPixOrders({
      valor: 50,
      email: "cliente@exemplo.com",
      orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
      expiracao: null as unknown as string,
    })
  );
});

// --- Ressalva da revisão (14/08/2026): minutosDaExpiracaoPix sem teste ----
//
// Símbolo novo e exportado, antes coberto só de lado (pelos testes de
// montarCorpoPixOrders e de expiracaoRealinhavel, criar-pagamento/index.ts).
// Aqui o contrato direto: devolve minutos, devolve null, nunca lança.

Deno.test("minutosDaExpiracaoPix converte horas para minutos (PT1H -> 60, PT2H -> 120)", () => {
  // A suíte inteira tinha só um caso com horas (PT720H, no teste de faixa
  // abaixo) — e ele prova o LIMITE aceito por montarCorpoPixOrders, não a
  // CONVERSÃO horas->minutos em si (bastaria a função devolver qualquer
  // número >= 43200 para aquele teste passar).
  assertEquals(minutosDaExpiracaoPix("PT1H"), 60);
  assertEquals(minutosDaExpiracaoPix("PT2H"), 120);
  assertEquals(minutosDaExpiracaoPix("PT30M"), 30);
  assertEquals(minutosDaExpiracaoPix("PT45M"), 45);
});

Deno.test("minutosDaExpiracaoPix: 'PT0M' devolve 0, não null — a distinção importa porque 0 é falsy e quem chama compara com === null", () => {
  assertEquals(minutosDaExpiracaoPix("PT0M"), 0);
});

Deno.test("minutosDaExpiracaoPix devolve null para sintaxe inválida, minúsculas, espaços e ausência — nunca lança", () => {
  for (
    const invalida of [
      "30M", // sem o prefixo PT
      "PT", // sem número
      "PT30S", // segundos, não aceito
      "", // vazia
      "pt30m", // minúsculas
      "PT30m", // unidade minúscula
      " PT30M", // espaço antes
      "PT30M ", // espaço depois
      "PT-30M", // negativo
      "PT30.5M", // fracionário
    ]
  ) {
    assertEquals(minutosDaExpiracaoPix(invalida), null, `deveria ser null para ${JSON.stringify(invalida)}`);
  }
});

Deno.test("minutosDaExpiracaoPix devolve null para tipos que não são string — nunca lança", () => {
  for (const invalido of [null, undefined, 30, {}, [], true]) {
    assertEquals(minutosDaExpiracaoPix(invalido as unknown as string), null);
  }
});

Deno.test("minutosDaExpiracaoPix devolve null (não Infinity) quando o número da duração estoura para não-finito", () => {
  // Achado da revisão (14/08/2026): Number("9".repeat(400)) é Infinity, não
  // NaN — o guard `!casamento` não pega isso, porque a regex CASA (são só
  // dígitos). Sem checar Number.isFinite, a função devolvia Infinity: hoje
  // isso é inalcançável (montarCorpoPixOrders lança antes, pela faixa de
  // 30-43200), mas a função é exportada — um consumidor futuro que a chame
  // direto receberia Infinity, e em expiracaoRealinhavel isso vira
  // `maximo = Infinity`, que aceita QUALQUER data futura, inclusive o
  // default de 24h que o teto existe para barrar.
  const duracaoAbsurda = `PT${"9".repeat(400)}M`;
  assertEquals(minutosDaExpiracaoPix(duracaoAbsurda), null);
});

// --- Tarefa 2: faixa de expiração — a regex só validava SINTAXE ------------
//
// Achado da revisão: /^PT\d+[MH]$/ deixava passar "PT0M" (zero), "PT1M" e
// "PT29M" (abaixo do mínimo de 30 min que o MP aceita) e "PT721H"/"PT99999H"
// (acima do máximo de 30 dias = 43200 min). O docstring da função promete o
// mínimo como restrição DURA; a faixa entra aqui.

Deno.test("montarCorpoPixOrders lança quando os minutos ficam abaixo do mínimo de 30 — inclui zero", () => {
  for (const abaixoDoMinimo of ["PT0M", "PT1M", "PT29M"]) {
    assertThrows(
      () =>
        montarCorpoPixOrders({
          valor: 50,
          email: "cliente@exemplo.com",
          orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
          expiracao: abaixoDoMinimo,
        }),
      undefined,
      undefined,
      `deveria lançar para ${abaixoDoMinimo}`,
    );
  }
});

Deno.test("montarCorpoPixOrders lança quando as horas passam do máximo de 30 dias (721h > 43200min)", () => {
  for (const acimaDoMaximo of ["PT721H", "PT99999H"]) {
    assertThrows(
      () =>
        montarCorpoPixOrders({
          valor: 50,
          email: "cliente@exemplo.com",
          orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
          expiracao: acimaDoMaximo,
        }),
      undefined,
      undefined,
      `deveria lançar para ${acimaDoMaximo}`,
    );
  }
});

Deno.test("montarCorpoPixOrders aceita os dois limites da faixa: 30 minutos e 30 dias (720h = 43200min)", () => {
  const expiracaoEnviada = (expiracao: string) => {
    const corpo = montarCorpoPixOrders({
      valor: 50,
      email: "cliente@exemplo.com",
      orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
      expiracao,
    });
    const transacoes = corpo.transactions as Record<string, unknown>;
    const pagamentos = transacoes.payments as Record<string, unknown>[];
    return pagamentos[0].expiration_time;
  };

  assertEquals(expiracaoEnviada("PT30M"), "PT30M");
  assertEquals(expiracaoEnviada("PT720H"), "PT720H");
});

Deno.test("montarCorpoPixOrders manda processing_mode 'automatic' — a Orders API documenta como obrigatório no corpo", () => {
  // Doc oficial (checkout-api-orders/payment-integration/pix, context7,
  // 13/08/2026) lista `processing_mode` como Required no corpo E o inclui em
  // TODO exemplo de requisição (Pix e cartão), e o SDK oficial Node.js faz o
  // mesmo. Medido contra a API real sem este campo o MP aceitou (201) — mas
  // doc e SDK concordam entre si aqui (ao contrário do caso de x-signature,
  // onde doc e SDK divergiam e o SDK ganhava), então não há motivo para
  // divergir do que os dois dizem.
  const corpo = montarCorpoPixOrders({
    valor: 50,
    email: "cliente@exemplo.com",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    expiracao: "PT30M",
  });
  assertEquals(corpo.processing_mode, "automatic");
});

Deno.test("criarOrder manda o token, o Content-Type e a chave de idempotência para /v1/orders", async () => {
  let capturada: { url: string; init: RequestInit } | null = null;

  const fetchStub = ((url: string, init: RequestInit) => {
    capturada = { url, init };
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: "ORDTST01KZY123",
          status: "action_required",
          status_detail: "waiting_transfer",
          external_reference: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
          transactions: {
            payments: [
              {
                id: "PAY01KZY456",
                payment_method: {
                  qr_code: "00020126580014br.gov.bcb...",
                  qr_code_base64: "iVBORw0KGgo=",
                },
              },
            ],
          },
        }),
        { status: 201 },
      ),
    );
  }) as unknown as typeof fetch;

  const r = await criarOrder({
    token: "APP_USR-token",
    corpo: { total_amount: "50.00" },
    chaveIdempotencia: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals((r.order as Record<string, unknown>).id, "ORDTST01KZY123");
  }

  assertStringIncludes(capturada!.url, "/v1/orders");
  const headers = capturada!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer APP_USR-token");
  assertEquals(headers["Content-Type"], "application/json");
  assertEquals(headers["X-Idempotency-Key"], "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
});

Deno.test("criarOrder não vaza o corpo do erro do MP para quem chamou", async () => {
  const fetchStub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ message: "invalid access token" }), { status: 401 }),
    )) as unknown as typeof fetch;

  const r = await criarOrder({
    token: "APP_USR-errado",
    corpo: {},
    chaveIdempotencia: "id-1",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 401);
    assertEquals(r.erro.includes("access token"), false);
  }
});

Deno.test("criarOrder trata rede caída sem estourar", async () => {
  const fetchStub = (() =>
    Promise.reject(new Error("connection refused"))) as unknown as typeof fetch;

  const r = await criarOrder({
    token: "APP_USR-token",
    corpo: {},
    chaveIdempotencia: "id-2",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 0);
});

Deno.test("criarOrder não rejeita quando o MP devolve 2xx com corpo ilegível", async () => {
  const fetchStub = (() =>
    Promise.resolve(new Response("<html>502</html>", { status: 201 }))) as unknown as typeof fetch;

  const r = await criarOrder({
    token: "APP_USR-token",
    corpo: {},
    chaveIdempotencia: "id-3",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 201);
});

Deno.test("criarOrder não rejeita e não devolve ok quando o corpo 2xx não tem id", async () => {
  const fetchStub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ status: "created" }), { status: 201 }),
    )) as unknown as typeof fetch;

  const r = await criarOrder({
    token: "APP_USR-token",
    corpo: {},
    chaveIdempotencia: "id-4",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 201);
});

// --- Achado 4 da revisão do PR: nenhum teste checava o CORPO enviado ---
//
// A revisão trocou o corpo por JSON.stringify({}) dentro de criarOrder e os
// 41 testes da suíte continuaram verdes — o irmão clássico já tinha essa
// prova (criarPagamento, :227 acima). Este teste é o que faltava do lado
// de criarOrder: monta o corpo de verdade com montarCorpoPixOrders (que já
// carrega o expiration_time do Achado 1) e confere o que de fato atravessa
// o fetch.

Deno.test("criarOrder manda o corpo real no body — total_amount, external_reference e expiration_time chegam intactos", async () => {
  let capturada: { url: string; init: RequestInit } | null = null;

  const fetchStub = ((url: string, init: RequestInit) => {
    capturada = { url, init };
    return Promise.resolve(
      new Response(
        JSON.stringify({ id: "ORDTST01KZY123", status: "action_required", status_detail: "waiting_transfer" }),
        { status: 201 },
      ),
    );
  }) as unknown as typeof fetch;

  const corpo = montarCorpoPixOrders({
    valor: 50,
    email: "cliente@exemplo.com",
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    expiracao: "PT30M",
  });

  await criarOrder({
    token: "APP_USR-token",
    corpo,
    chaveIdempotencia: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    fetchImpl: fetchStub,
  });

  // Apagar o `body` do fetch (ou trocá-lo por `{}`, como a revisão mutou e
  // os 41 testes anteriores não acusaram) deixaria o resto da suíte verde —
  // são estes três valores que decidem quanto se cobra, a qual pedido a
  // cobrança pertence, e por quanto tempo o QR fica pagável.
  const corpoEnviado = JSON.parse(capturada!.init.body as string);
  assertEquals(corpoEnviado.total_amount, "50.00");
  assertEquals(corpoEnviado.external_reference, "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
  assertEquals(corpoEnviado.transactions.payments[0].expiration_time, "PT30M");
});

// --- consultarOrder: reconsulta de ORDER, não de PAYMENT ---
//
// Achado ao migrar criar-pagamento (Tarefa 2): `gateway_payment_id` passa a
// guardar o id da ORDER (ver extrairQrCode acima). Reconsultar essa cobrança
// com `consultarPagamento` (GET /v1/payments/{id}) chamaria o endpoint
// ERRADO com um id de order — 404 garantido. `consultarOrder` é o
// equivalente para GET /v1/orders/{id}, mesmo contrato (nunca rejeita, erro
// do MP só no log) que `criarOrder` já prova.

Deno.test("consultarOrder consulta por GET em /v1/orders/{id}, sem corpo e sem chave de idempotência", async () => {
  let capturada: { url: string; init: RequestInit } | null = null;

  const fetchStub = ((url: string, init: RequestInit) => {
    capturada = { url, init };
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: "ORDTST01KZY123",
          status: "action_required",
          status_detail: "waiting_transfer",
        }),
        { status: 200 },
      ),
    );
  }) as unknown as typeof fetch;

  const r = await consultarOrder({
    token: "TEST-token",
    orderId: "ORDTST01KZY123",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals((r.order as Record<string, unknown>).id, "ORDTST01KZY123");
  }

  assertEquals(capturada!.init.method, "GET");
  assertEquals(capturada!.init.body, undefined);
  const headers = capturada!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer TEST-token");
  assertEquals(headers["X-Idempotency-Key"], undefined);
  assertStringIncludes(capturada!.url, "/v1/orders/ORDTST01KZY123");
});

Deno.test("consultarOrder não vaza o corpo do erro quando o MP devolve 404", async () => {
  const fetchStub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ message: "Order not found" }), { status: 404 }),
    )) as unknown as typeof fetch;

  const r = await consultarOrder({
    token: "TEST-token",
    orderId: "id-inexistente",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 404);
    assertEquals(r.erro.includes("not found"), false);
  }
});

Deno.test("consultarOrder trata rede caída sem estourar", async () => {
  const fetchStub = (() =>
    Promise.reject(new Error("connection refused"))) as unknown as typeof fetch;

  const r = await consultarOrder({
    token: "TEST-token",
    orderId: "id-1",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 0);
});

Deno.test("consultarOrder não rejeita quando o MP devolve 2xx com corpo ilegível", async () => {
  const fetchStub = (() =>
    Promise.resolve(new Response("<html>502</html>", { status: 200 }))) as unknown as typeof fetch;

  const r = await consultarOrder({
    token: "TEST-token",
    orderId: "id-2",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 200);
});

Deno.test("consultarOrder não rejeita e não devolve ok quando o corpo 2xx não tem id", async () => {
  const fetchStub = (() =>
    Promise.resolve(new Response(JSON.stringify({ status: "action_required" }), { status: 200 }))) as unknown as typeof fetch;

  const r = await consultarOrder({
    token: "TEST-token",
    orderId: "id-3",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 200);
});

// --- extrairQrCode: o QR não está mais na raiz da resposta ---
//
// Medido na resposta real de /v1/orders:
//   order.transactions.payments[0].payment_method.qr_code        → copia-e-cola
//   order.transactions.payments[0].payment_method.qr_code_base64 → imagem
//   order.id                                                     → id da order
//   order.transactions.payments[0].id                            → id do pagamento

Deno.test("extrairQrCode lê o QR, o ticket_url, os dois ids e a imagem quando a order tem tudo", () => {
  // Tarefa 2 (CHECKOUT-070): `criar-pagamento` hoje devolve `ticketUrl` ao
  // front (contrato declarado em useOrders.ts:1028) — a doc oficial mostra
  // este campo no MESMO objeto do QR (transactions.payments[0].payment_
  // method.ticket_url, context7 13/08/2026), então a extração acompanha o QR.
  const order = {
    id: "ORDTST01KZY123",
    transactions: {
      payments: [
        {
          id: "PAY01KZY456",
          payment_method: {
            qr_code: "00020126580014br.gov.bcb...",
            qr_code_base64: "iVBORw0KGgo=",
            ticket_url:
              "https://www.mercadopago.com.br/sandbox/payments/1/ticket?caller_id=1&hash=abc",
          },
        },
      ],
    },
  };

  const r = extrairQrCode(order);
  assertEquals(r, {
    orderId: "ORDTST01KZY123",
    paymentId: "PAY01KZY456",
    qrCode: "00020126580014br.gov.bcb...",
    qrCodeBase64: "iVBORw0KGgo=",
    ticketUrl:
      "https://www.mercadopago.com.br/sandbox/payments/1/ticket?caller_id=1&hash=abc",
  });
});

Deno.test("extrairQrCode devolve os campos ausentes como null sem estourar — ausência não é erro", () => {
  // `transactions` inteiro faltando: uma order que ainda não processou o
  // pagamento pode chegar assim. Isto NÃO é um erro de leitura — é a
  // Tarefa 2 quem decide o que fazer com QR ausente.
  const r = extrairQrCode({ id: "ORDTST01KZY123" });
  assertEquals(r, {
    orderId: "ORDTST01KZY123",
    paymentId: null,
    qrCode: null,
    qrCodeBase64: null,
    ticketUrl: null,
  });
});

Deno.test("extrairQrCode devolve null (não um objeto com campos vazios) quando a order em si é ilegível — isto é erro, não ausência", () => {
  assertEquals(extrairQrCode(null), null);
  assertEquals(extrairQrCode(undefined), null);
  assertEquals(extrairQrCode("não é um objeto" as unknown as Record<string, unknown>), null);
});

// --- Achado 2 da revisão do PR: id numérico não pode virar null silencioso ---
//
// `typeof order.id === "string" ? order.id : null` transforma um id
// NUMÉRICO em null — indistinguível de ausência. Se isso acontecer,
// gateway_payment_id grava NULL e confirmar_pagamento bate para sempre em
// "IS NULL → 'divergente'" (20260808000000_confirmar_pagamento.sql:53-57), e
// pagamentos_a_reconciliar nem seleciona o pedido (`WHERE gateway_payment_id
// IS NOT NULL`) — dinheiro que entra e nunca é registrado, e nenhuma
// varredura corrige. O caminho clássico (interpretarRespostaDePagamento,
// acima) já faz `String(json.id)` para o mesmo problema; a Task 1 divergia
// da própria regra do arquivo.

Deno.test("extrairQrCode normaliza id numérico do order e do pagamento para string, igual ao caminho clássico (String(json.id))", () => {
  const order = {
    id: 123456789012,
    transactions: {
      payments: [
        {
          id: 987654321,
          payment_method: {
            qr_code: "00020126580014br.gov.bcb...",
            qr_code_base64: "iVBORw0KGgo=",
          },
        },
      ],
    },
  };

  const r = extrairQrCode(order as unknown as Record<string, unknown>);
  assertEquals(r?.orderId, "123456789012");
  assertEquals(r?.paymentId, "987654321");
});

Deno.test("extrairQrCode não transforma AUSÊNCIA de id em string 'undefined'/'null' — mutação provada pela revisão: (order.id ?? null) passava nos 41 testes antigos", () => {
  // order.id ausente (não é erro de leitura da order em si — ela é um
  // objeto legível, só não tem id) e pagamento ausente (sem transactions).
  const r1 = extrairQrCode({});
  assertEquals(r1?.orderId, null);
  assertEquals(r1?.paymentId, null);

  // order.id === null explicitamente.
  const r2 = extrairQrCode({ id: null });
  assertEquals(r2?.orderId, null);
});

// --- extrairDataExpiracaoOrder: o vencimento ABSOLUTO do QR, para o
// realinhamento de expires_at (decisão do dono, 14/08/2026) ---
//
// Medido na resposta real de /v1/orders: o campo mora um nível ACIMA de
// payment_method — é o PAGAMENTO que carrega expiration_time/
// date_of_expiration, não o payment_method (que só tem qr_code/ticket_url).
// Função IRMÃ de extrairQrCode, não extensão dele — ver o comentário grande
// de extrairDataExpiracaoOrder em mercadopago.ts para o motivo.

Deno.test("extrairDataExpiracaoOrder lê date_of_expiration do pagamento", () => {
  const order = {
    id: "ORDTST01KZY123",
    transactions: {
      payments: [
        {
          id: "PAY01KZY456",
          expiration_time: "PT30M",
          date_of_expiration: "2026-08-14T20:25:32.488+00:00",
          payment_method: { qr_code: "00020126580014br.gov.bcb..." },
        },
      ],
    },
  };

  assertEquals(extrairDataExpiracaoOrder(order), "2026-08-14T20:25:32.488+00:00");
});

Deno.test("extrairDataExpiracaoOrder devolve null quando o campo está ausente — sem inventar prazo", () => {
  assertEquals(extrairDataExpiracaoOrder({ id: "ORDTST01" }), null);
  assertEquals(
    extrairDataExpiracaoOrder({
      id: "ORDTST01",
      transactions: { payments: [{ id: "PAY1" }] },
    }),
    null,
  );
});

Deno.test("extrairDataExpiracaoOrder devolve null quando a order em si é ilegível", () => {
  assertEquals(extrairDataExpiracaoOrder(null), null);
  assertEquals(extrairDataExpiracaoOrder(undefined), null);
  assertEquals(
    extrairDataExpiracaoOrder("não é um objeto" as unknown as Record<string, unknown>),
    null,
  );
});

Deno.test("extrairDataExpiracaoOrder devolve null quando o campo não é string (tipo errado)", () => {
  assertEquals(
    extrairDataExpiracaoOrder({
      transactions: { payments: [{ date_of_expiration: 123456 }] },
    }),
    null,
  );
});

// --- mapearStatusOrder: o mapa novo, para o par status + status_detail ---
//
// `processed` sozinho NÃO significa pago: `processed + partially_refunded`
// também é `processed`. Por isso o mapa trata o PAR, nunca só o `status`.
// Os valores de destino são os que a CHECK constraint
// marketplace_orders_payment_status_check já aceita (src/types/index.ts) —
// nenhum vocabulário novo.

Deno.test("mapearStatusOrder: processed + accredited é a única combinação que vira pago", () => {
  assertEquals(mapearStatusOrder("processed", "accredited"), "pago");
});

Deno.test("mapearStatusOrder: pendências viram aguardando", () => {
  assertEquals(mapearStatusOrder("created", "created"), "aguardando");
  assertEquals(mapearStatusOrder("processing", "in_process"), "aguardando");
  assertEquals(mapearStatusOrder("action_required", "waiting_payment"), "aguardando");
  assertEquals(mapearStatusOrder("action_required", "waiting_capture"), "aguardando");
  // waiting_transfer é o estado do PIX recém-criado — o mais frequente em produção.
  assertEquals(mapearStatusOrder("action_required", "waiting_transfer"), "aguardando");
});

Deno.test("mapearStatusOrder: processed + partially_refunded vira estornado, NÃO pago — pega quem mapeia só pelo status", () => {
  assertEquals(mapearStatusOrder("processed", "partially_refunded"), "estornado");
});

Deno.test("mapearStatusOrder: refunded + refunded vira estornado", () => {
  assertEquals(mapearStatusOrder("refunded", "refunded"), "estornado");
});

Deno.test("mapearStatusOrder: canceled + canceled vira recusado — mesmo rótulo que o mapearStatus clássico dá a 'cancelled'", () => {
  assertEquals(mapearStatusOrder("canceled", "canceled"), "recusado");
});

Deno.test("mapearStatusOrder: expired + expired vira expirado", () => {
  assertEquals(mapearStatusOrder("expired", "expired"), "expirado");
});

Deno.test("mapearStatusOrder: failed + failed vira recusado", () => {
  assertEquals(mapearStatusOrder("failed", "failed"), "recusado");
});

Deno.test("mapearStatusOrder: as três variantes de chargeback viram estornado", () => {
  assertEquals(mapearStatusOrder("charged_back", "in_process"), "estornado");
  assertEquals(mapearStatusOrder("charged_back", "settled"), "estornado");
  assertEquals(mapearStatusOrder("charged_back", "reimbursed"), "estornado");
});

Deno.test("mapearStatusOrder devolve null para combinação desconhecida — nunca um palpite", () => {
  // Duas combinações inválidas: par que não existe na tabela, e um status
  // conhecido emparelhado com um status_detail que não é dele.
  assertEquals(mapearStatusOrder("processed", "waiting_transfer"), null);
  assertEquals(mapearStatusOrder("action_required", "accredited"), null);
  assertEquals(mapearStatusOrder("", ""), null);
  assertEquals(mapearStatusOrder(null as unknown as string, null as unknown as string), null);
});

// --- MAPA_STATUS_ORDER: os 13 pares mapeiam para o payment_status certo ---

Deno.test("MAPA_STATUS_ORDER: os 14 pares mapeiam para o MESMO payment_status que mapearStatusOrder já devolve — a tabela não tem mais chave 'front'", () => {
  // CHECKOUT-080 (#213): até esta tarefa, MAPA_STATUS_ORDER guardava
  // `{ banco, front? }` — 6 dos 14 pares (estornos, chargeback, `expired`)
  // não tinham `front` de propósito, porque o vocabulário clássico do MP
  // não os representava. Esse contrato deixou de existir: `criar-pagamento`
  // apagou `traduzirStatusOrderParaClassico` e passou a emitir direto o
  // `payment_status` deste banco para o front. A tabela virou
  // `Record<string, string>` (par → payment_status) — o que precisa
  // continuar coberto é que os 13 pares batem no MESMO destino de sempre.
  //
  // Achado do lint (ITEM 1, PR anterior): indexar `MAPA_STATUS_ORDER[par]`
  // por VARIÁVEL dispara o "Generic Object Injection Sink" do eslint
  // (security/detect-object-injection) e estourou a catraca de warnings.
  // Por isso os pares abaixo são indexados por CHAVE LITERAL, não por
  // variável — mesma orientação que o teste anterior já seguia.
  assertEquals(MAPA_STATUS_ORDER["processed:accredited"], "pago");
  assertEquals(MAPA_STATUS_ORDER["created:created"], "aguardando");
  assertEquals(MAPA_STATUS_ORDER["processing:in_process"], "aguardando");
  assertEquals(MAPA_STATUS_ORDER["action_required:waiting_payment"], "aguardando");
  assertEquals(MAPA_STATUS_ORDER["action_required:waiting_capture"], "aguardando");
  assertEquals(MAPA_STATUS_ORDER["action_required:waiting_transfer"], "aguardando");
  assertEquals(MAPA_STATUS_ORDER["processed:partially_refunded"], "estornado");
  assertEquals(MAPA_STATUS_ORDER["refunded:refunded"], "estornado");
  assertEquals(MAPA_STATUS_ORDER["charged_back:in_process"], "estornado");
  assertEquals(MAPA_STATUS_ORDER["charged_back:settled"], "estornado");
  assertEquals(MAPA_STATUS_ORDER["charged_back:reimbursed"], "estornado");
  assertEquals(MAPA_STATUS_ORDER["canceled:canceled"], "recusado");
  assertEquals(MAPA_STATUS_ORDER["failed:failed"], "recusado");
  assertEquals(MAPA_STATUS_ORDER["expired:expired"], "expirado");

  // Conta as chaves para pegar um par ADICIONADO ou REMOVIDO — as 14
  // asserções acima sozinhas não acusariam uma 15ª chave sobrando na tabela.
  assertEquals(
    Object.keys(MAPA_STATUS_ORDER).length,
    14,
    "MAPA_STATUS_ORDER deveria ter exatamente os 14 pares conhecidos — ver a lista acima",
  );
});

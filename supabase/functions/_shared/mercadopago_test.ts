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
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  criarPagamento,
  formatarExpiracao,
  mapearStatus,
  montarCorpoCartao,
  montarCorpoPix,
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

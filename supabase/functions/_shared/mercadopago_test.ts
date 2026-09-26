// @ts-nocheck
/**
 * Testes do cliente do Mercado Pago (CHECKOUT-010, #109).
 *
 * Nada aqui toca a rede: `criarOrder`/`consultarOrder`/`cancelarOrder`/
 * `consultarPagamento` recebem o `fetch` por parâmetro, e os testes passam um
 * stub. O que se prova é o que erra caro — corpo com valor errado cobra o
 * cliente errado, e status mal mapeado marca como pago um pedido recusado.
 */
import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  cancelarOrder,
  consultarOrder,
  consultarPagamento,
  criarOrder,
  erro400EhDeDadoDoCartao,
  extrairDataExpiracaoOrder,
  extrairDesafio3ds,
  extrairQrCode,
  formatarExpiracao,
  idEhClassico,
  MAPA_STATUS_ORDER,
  mapearStatus,
  mapearStatusOrder,
  minutosDaExpiracaoPix,
  montarCorpoCartaoOrders,
  montarCorpoPix,
  montarCorpoPixOrders,
  MOTIVO_RECUSA_DADOS_DO_CARTAO,
  MOTIVO_RECUSA_PADRAO,
  motivoDaRecusa,
  motivoDaRecusaDoErro,
  normalizarDocumento,
  orderCancelada,
  orderEhDeCartao,
  recusaLiberaAVaga,
  TEMPO_LIMITE_MS,
  tipoDoPagamentoDaOrder,
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

Deno.test("consultarPagamento devolve `corpo` com o JSON cru — item (b) do brief da T5 (webhook lê refunds[]/status_detail sem 2o GET)", async () => {
  const fetchStub = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 999,
          status: "refunded",
          status_detail: "refunded",
          transaction_amount_refunded: 100,
          refunds: [{ id: "r1", amount: 100, status: "approved" }],
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
    assertEquals(r.corpo?.status_detail, "refunded");
    assertEquals(r.corpo?.transaction_amount_refunded, 100);
    assertEquals(Array.isArray(r.corpo?.refunds), true);
    assertEquals((r.corpo?.refunds as unknown[])[0], { id: "r1", amount: 100, status: "approved" });
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

Deno.test("mapearStatusOrder: processed + partially_refunded devolve null, NÃO estornado — PEDIDO-05: este banco não tem coluna de valor estornado, então marcar o pedido inteiro como 'estornado' apagaria a venda TOTAL dos relatórios por causa de uma devolução PARCIAL (ex.: R$ 5 de um pedido de R$ 200)", () => {
  assertEquals(mapearStatusOrder("processed", "partially_refunded"), null);
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

Deno.test("mapearStatusOrder: failed com QUALQUER detalhe vira recusado — a recusa de cartão traz o motivo no status_detail (Fase 3.5)", () => {
  assertEquals(mapearStatusOrder("failed", "rejected_by_issuer"), "recusado");
  assertEquals(mapearStatusOrder("failed", "high_risk"), "recusado");
  assertEquals(mapearStatusOrder("failed", "um_motivo_que_o_mp_inventar_amanha"), "recusado");
  // A regra é do STATUS `failed`, não do detalhe: o mesmo detalhe com outro
  // status continua desconhecido — nunca um palpite.
  assertEquals(mapearStatusOrder("processed", "rejected_by_issuer"), null);
  assertEquals(mapearStatusOrder("processing", "failed"), null);
});

Deno.test("mapearStatusOrder: desafio 3DS pendente e análise antifraude do cartão viram aguardando (Fase 3.5)", () => {
  assertEquals(mapearStatusOrder("action_required", "pending_challenge"), "aguardando");
  assertEquals(mapearStatusOrder("processing", "in_review"), "aguardando");
  assertEquals(mapearStatusOrder("processing", "pending_review_manual"), "aguardando");
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

Deno.test("MAPA_STATUS_ORDER: os 16 pares mapeiam para o MESMO payment_status que mapearStatusOrder já devolve — a tabela não tem mais chave 'front'", () => {
  // CHECKOUT-080 (#213): até esta tarefa, MAPA_STATUS_ORDER guardava
  // `{ banco, front? }` — 6 dos 14 pares (estornos, chargeback, `expired`)
  // não tinham `front` de propósito, porque o vocabulário clássico do MP
  // não os representava. Esse contrato deixou de existir: `criar-pagamento`
  // apagou `traduzirStatusOrderParaClassico` e passou a emitir direto o
  // `payment_status` deste banco para o front. A tabela virou
  // `Record<string, string>` (par → payment_status) — o que precisa
  // continuar coberto é que os pares batem no MESMO destino de sempre.
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
  assertEquals(MAPA_STATUS_ORDER["refunded:refunded"], "estornado");
  assertEquals(MAPA_STATUS_ORDER["charged_back:in_process"], "estornado");
  assertEquals(MAPA_STATUS_ORDER["charged_back:settled"], "estornado");
  assertEquals(MAPA_STATUS_ORDER["charged_back:reimbursed"], "estornado");
  assertEquals(MAPA_STATUS_ORDER["canceled:canceled"], "recusado");
  assertEquals(MAPA_STATUS_ORDER["failed:failed"], "recusado");
  assertEquals(MAPA_STATUS_ORDER["expired:expired"], "expirado");
  // Fase 3.5 (cartão): desafio 3DS pendente e as duas análises antifraude.
  assertEquals(MAPA_STATUS_ORDER["action_required:pending_challenge"], "aguardando");
  assertEquals(MAPA_STATUS_ORDER["processing:in_review"], "aguardando");
  assertEquals(MAPA_STATUS_ORDER["processing:pending_review_manual"], "aguardando");

  // PEDIDO-05: "processed:partially_refunded" SAIU da tabela de propósito —
  // não é mais um par conhecido que aponta para "estornado". A CHAVE em si
  // precisa estar ausente (não só o valor diferente de "estornado"), senão um
  // mutante que trocasse o valor por qualquer outra string do conjunto
  // fechado passaria despercebido por esta suíte.
  assertEquals("processed:partially_refunded" in MAPA_STATUS_ORDER, false);

  // Conta as chaves para pegar um par ADICIONADO ou REMOVIDO — as asserções
  // acima sozinhas não acusariam uma 17ª chave sobrando na tabela. (13 até a
  // Fase 3.5, que acrescentou os três pares de espera do cartão; o
  // `failed:<qualquer detalhe>` é regra de `mapearStatusOrder`, não chave.)
  assertEquals(
    Object.keys(MAPA_STATUS_ORDER).length,
    16,
    "MAPA_STATUS_ORDER deveria ter exatamente os 16 pares conhecidos — ver a lista acima",
  );
});

// --- P-4 (laudo varredura 01/09): fetch com TEMPO DE ESPERA ---
//
// Até este conserto as quatro chamadas a API do MP deste arquivo
// (criarOrder/consultarOrder/criarPagamento/consultarPagamento) penduravam
// sem limite — gateway lento/pendurado segurava o checkout do PIX até o
// wall-clock da plataforma. Mesmo padrão do `buscarComTempo` do
// calculate-shipping (laudo 31/08, D2): AbortController + setTimeout +
// clearTimeout no finally, e o aborto é visto por quem chama como falha de
// rede comum (status 0), caindo no tratamento que já existe.

// Gateway pendurado: a promessa nunca resolve por conta própria — só o aborto
// a resolve (rejeitando), exatamente como um fetch real contra um servidor
// que nunca responde.
function buscarPendurado(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_ok, falhou) => {
    init?.signal?.addEventListener(
      "abort",
      () => falhou(new DOMException("The operation was aborted.", "AbortError")),
    );
  });
}

Deno.test("P-4 - TEMPO_LIMITE_MS é 15s, o mesmo teto do padrão da casa (calculate-shipping)", () => {
  assertEquals(TEMPO_LIMITE_MS, 15000);
});

Deno.test("P-4 - criarOrder com gateway pendurado devolve ok:false PELO TIMEOUT (não pendura)", async () => {
  const inicio = Date.now();
  const r = await criarOrder({
    token: "t",
    corpo: {},
    chaveIdempotencia: "k",
    fetchImpl: buscarPendurado as unknown as typeof fetch,
    tempoLimiteMs: 20,
  });
  const duracao = Date.now() - inicio;
  assertEquals(r.ok, false);
  // status 0 = nem chegou a haver resposta HTTP — o aborto vira falha de
  // rede comum, não erro estourando.
  assertEquals(r.ok ? null : r.status, 0);
  // Prova do "não pendura": voltou dezenas de ms (o teto do teste), não 15s
  // do default nem o wall-clock da plataforma.
  assertEquals(duracao < 5000, true);
});

Deno.test("P-4 - consultarOrder com gateway pendurado devolve ok:false PELO TIMEOUT", async () => {
  const r = await consultarOrder({
    token: "t",
    orderId: "ORD01KZZ4D94WC79335A68CZ5NZ7X",
    fetchImpl: buscarPendurado as unknown as typeof fetch,
    tempoLimiteMs: 20,
  });
  assertEquals(r.ok, false);
  assertEquals(r.ok ? null : r.status, 0);
});

Deno.test("P-4 - consultarPagamento com gateway pendurado devolve ok:false PELO TIMEOUT", async () => {
  const r = await consultarPagamento({
    token: "t",
    paymentId: "123456789",
    fetchImpl: buscarPendurado as unknown as typeof fetch,
    tempoLimiteMs: 20,
  });
  assertEquals(r.ok, false);
  assertEquals(r.ok ? null : r.status, 0);
});

Deno.test("P-4 - fetch lento mas DENTRO do tempo passa, e o fetch leva um sinal de aborto", async () => {
  let sinalRecebido: AbortSignal | null = null;
  const buscarLentoMasOk = (_url: string, init?: RequestInit) => {
    sinalRecebido = init?.signal ?? null;
    return new Promise<Response>((ok) => {
      setTimeout(
        () => ok(new Response(JSON.stringify({ id: "ORD01KZZ4D94WC79335A68CZ5NZ7X" }))),
        20,
      );
    });
  };
  const r = await criarOrder({
    token: "t",
    corpo: {},
    chaveIdempotencia: "k",
    fetchImpl: buscarLentoMasOk as unknown as typeof fetch,
    tempoLimiteMs: 60000,
  });
  assertEquals(r.ok, true);
  assertEquals(sinalRecebido instanceof AbortSignal, true);
});

Deno.test("P-4 - o timer do timeout é LIMPO depois da resposta (sem leak)", async () => {
  const clearTimeoutReal = globalThis.clearTimeout;
  let foiLimpo = false;
  (globalThis as unknown as Record<string, unknown>).clearTimeout = (
    id: Parameters<typeof clearTimeoutReal>[0],
  ) => {
    foiLimpo = true;
    return clearTimeoutReal(id);
  };
  try {
    const r = await criarOrder({
      token: "t",
      corpo: {},
      chaveIdempotencia: "k",
      fetchImpl: (() =>
        Promise.resolve(new Response(JSON.stringify({ id: "ORD01KZZ4D94WC79335A68CZ5NZ7X" })))) as unknown as typeof fetch,
      tempoLimiteMs: 60000,
    });
    assertEquals(r.ok, true);
    // Se o timer não fosse limpo, cada chamada deixaria 60s pendurados no
    // event loop — o deno test esperaria cada um antes de encerrar.
    assertEquals(foiLimpo, true);
  } finally {
    globalThis.clearTimeout = clearTimeoutReal;
  }
});

// ═══ Fase 3.5 (26/09/2026): cartão pela Orders API ══════════════════════════
//
// O que erra caro aqui: um corpo que cobra valor errado, parcela débito,
// manda dado que não devia (issuer_id do Brick, número do cartão), ou um
// validador frouxo que deixa lixo chegar ao MP. E, do lado da leitura, uma
// recusa de cartão confundida com recusa de PIX — que CANCELA o pedido.

const PEDIDO_CARTAO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const TOKEN_CARTAO = "ff8080814c11e237014c1ff593b57b4d";
const CPF_TESTE = "12345678909";

function argsCartao(extra: Record<string, unknown> = {}) {
  return {
    orderId: PEDIDO_CARTAO,
    valor: 149.9,
    email: "cliente@exemplo.com",
    documento: { type: "CPF", number: CPF_TESTE },
    token: TOKEN_CARTAO,
    paymentMethodId: "master",
    paymentTypeId: "credit_card",
    parcelas: 3,
    ...extra,
  } as Parameters<typeof montarCorpoCartaoOrders>[0];
}

Deno.test("montarCorpoCartaoOrders (crédito): corpo Orders completo — valores em string, 3DS on_fraud_risk, captura automatic_async", () => {
  const corpo = montarCorpoCartaoOrders(argsCartao());

  assertEquals(corpo, {
    type: "online",
    processing_mode: "automatic",
    capture_mode: "automatic_async",
    external_reference: PEDIDO_CARTAO,
    total_amount: "149.90",
    payer: {
      email: "cliente@exemplo.com",
      identification: { type: "CPF", number: CPF_TESTE },
    },
    transactions: {
      payments: [
        {
          amount: "149.90",
          payment_method: {
            id: "master",
            type: "credit_card",
            token: TOKEN_CARTAO,
            installments: 3,
          },
        },
      ],
    },
    config: {
      online: {
        transaction_security: { validation: "on_fraud_risk", liability_shift: "required" },
      },
    },
  });
});

Deno.test("montarCorpoCartaoOrders (débito): installments SEMPRE 1, mesmo pedindo 6 — débito não parcela", () => {
  const corpo = montarCorpoCartaoOrders(
    argsCartao({ paymentTypeId: "debit_card", paymentMethodId: "debelo", parcelas: 6 }),
  );
  const pagamento = (corpo.transactions as { payments: Array<Record<string, unknown>> }).payments[0];
  assertEquals(pagamento.payment_method, {
    id: "debelo",
    type: "debit_card",
    token: TOKEN_CARTAO,
    installments: 1,
  });
});

Deno.test("montarCorpoCartaoOrders: NUNCA manda issuer_id, processing_mode do Brick nem dado cru do cartão", () => {
  const corpo = montarCorpoCartaoOrders(
    argsCartao({ issuer_id: "310", processing_mode: "aggregator", cardNumber: "5031433215406351" }),
  );
  const serializado = JSON.stringify(corpo);
  assertEquals(serializado.includes("issuer_id"), false);
  assertEquals(serializado.includes("aggregator"), false);
  assertEquals(serializado.includes("5031433215406351"), false);
  assertEquals(serializado.includes("card_number"), false);
  assertEquals(serializado.includes("security_code"), false);
  // O modo de processamento é decisão do servidor.
  assertEquals(corpo.processing_mode, "automatic");
});

Deno.test("montarCorpoCartaoOrders: documento com máscara vira só dígitos; CNPJ de 14 dígitos passa; nome vira first_name", () => {
  const cpf = montarCorpoCartaoOrders(
    argsCartao({ documento: { type: "CPF", number: "123.456.789-09" }, nome: "APRO" }),
  );
  assertEquals((cpf.payer as Record<string, unknown>).identification, { type: "CPF", number: CPF_TESTE });
  assertEquals((cpf.payer as Record<string, unknown>).first_name, "APRO");

  const cnpj = montarCorpoCartaoOrders(
    argsCartao({ documento: { type: "CNPJ", number: "12.345.678/0001-95" } }),
  );
  assertEquals(
    (cnpj.payer as Record<string, unknown>).identification,
    { type: "CNPJ", number: "12345678000195" },
  );
  assertEquals("first_name" in (cnpj.payer as Record<string, unknown>), false);
});

Deno.test("montarCorpoCartaoOrders arredonda o valor para duas casas (string), igual ao PIX", () => {
  const corpo = montarCorpoCartaoOrders(argsCartao({ valor: 10.005 + 0.001 }));
  assertEquals(corpo.total_amount, "10.01");
});

for (
  const caso of [
    { nome: "token curto", extra: { token: "abc123" } },
    { nome: "token com caractere fora do alfabeto", extra: { token: "ff8080814c11e237014c1ff5;DROP" } },
    { nome: "token ausente", extra: { token: undefined } },
    { nome: "token longo demais (129)", extra: { token: "a".repeat(129) } },
    { nome: "paymentMethodId maiúsculo", extra: { paymentMethodId: "MASTER" } },
    { nome: "paymentMethodId de 1 letra", extra: { paymentMethodId: "m" } },
    { nome: "paymentTypeId que não é cartão", extra: { paymentTypeId: "bank_transfer" } },
    { nome: "parcelas zero", extra: { parcelas: 0 } },
    { nome: "parcelas 13", extra: { parcelas: 13 } },
    { nome: "parcelas fracionária", extra: { parcelas: 1.5 } },
    { nome: "parcelas em string", extra: { parcelas: "3" } },
    { nome: "CPF com 10 dígitos", extra: { documento: { type: "CPF", number: "1234567890" } } },
    { nome: "CNPJ com 11 dígitos", extra: { documento: { type: "CNPJ", number: CPF_TESTE } } },
    { nome: "documento com letra", extra: { documento: { type: "CPF", number: "1234567890a" } } },
    { nome: "tipo de documento desconhecido", extra: { documento: { type: "RG", number: CPF_TESTE } } },
    { nome: "documento ausente", extra: { documento: undefined } },
    { nome: "valor zero", extra: { valor: 0 } },
    { nome: "valor negativo", extra: { valor: -10 } },
    { nome: "valor NaN", extra: { valor: Number.NaN } },
    { nome: "e-mail sem domínio", extra: { email: "a@" } },
    { nome: "orderId vazio", extra: { orderId: "" } },
  ]
) {
  Deno.test(`montarCorpoCartaoOrders LANÇA com ${caso.nome} — e a mensagem não carrega token, CPF nem e-mail`, () => {
    const erro = assertThrows(() => montarCorpoCartaoOrders(argsCartao(caso.extra))) as Error;
    assertEquals(erro.message.includes(TOKEN_CARTAO), false);
    assertEquals(erro.message.includes(CPF_TESTE), false);
    assertEquals(erro.message.includes("cliente@exemplo.com"), false);
  });
}

Deno.test("normalizarDocumento: devolve null para o que não é objeto, e nunca 'conserta' por palpite", () => {
  assertEquals(normalizarDocumento(null), null);
  assertEquals(normalizarDocumento("12345678909"), null);
  assertEquals(normalizarDocumento({ type: "CPF", number: 12345678909 }), null);
  assertEquals(normalizarDocumento({ type: "cpf", number: CPF_TESTE }), null);
  assertEquals(normalizarDocumento({ type: "CPF", number: " 123 456 789 09 " }), {
    type: "CPF",
    number: CPF_TESTE,
  });
});

Deno.test("tipoDoPagamentoDaOrder lê transactions.payments[0].payment_method.type; orderEhDeCartao só para crédito/débito", () => {
  const ordem = (tipo?: string) => ({
    id: "ORD1",
    transactions: { payments: [{ id: "PAY1", payment_method: tipo ? { id: "x", type: tipo } : { id: "x" } }] },
  });
  assertEquals(tipoDoPagamentoDaOrder(ordem("credit_card")), "credit_card");
  assertEquals(tipoDoPagamentoDaOrder(ordem("debit_card")), "debit_card");
  assertEquals(tipoDoPagamentoDaOrder(ordem("bank_transfer")), "bank_transfer");
  assertEquals(tipoDoPagamentoDaOrder(ordem()), null);
  assertEquals(tipoDoPagamentoDaOrder({ id: "ORD1" }), null);
  assertEquals(tipoDoPagamentoDaOrder(null), null);
  assertEquals(orderEhDeCartao(ordem("credit_card")), true);
  assertEquals(orderEhDeCartao(ordem("debit_card")), true);
  assertEquals(orderEhDeCartao(ordem("bank_transfer")), false);
  assertEquals(orderEhDeCartao(ordem()), false);
});

Deno.test("extrairDesafio3ds: devolve a URL https só com a order em action_required", () => {
  const ordem = (status: string, url: unknown) => ({
    id: "ORD1",
    status,
    status_detail: "pending_challenge",
    transactions: {
      payments: [{
        id: "PAY1",
        payment_method: { type: "credit_card", transaction_security: { url, type: "challenge" } },
      }],
    },
  });
  const url = "https://www.mercadopago.com.br/3ds/challenge/abc";
  assertEquals(extrairDesafio3ds(ordem("action_required", url)), url);
  // Desafio já resolvido (order seguiu adiante) não pode ser reaberto.
  assertEquals(extrairDesafio3ds(ordem("processing", url)), null);
  assertEquals(extrairDesafio3ds(ordem("processed", url)), null);
  // Só URL segura vira iframe.
  assertEquals(extrairDesafio3ds(ordem("action_required", "http://inseguro.example/3ds")), null);
  assertEquals(extrairDesafio3ds(ordem("action_required", "javascript:alert(1)")), null);
  assertEquals(extrairDesafio3ds(ordem("action_required", 42)), null);
  assertEquals(extrairDesafio3ds({ id: "ORD1", status: "action_required" }), null);
  assertEquals(extrairDesafio3ds(null), null);
});

Deno.test("motivoDaRecusa traduz cada status_detail conhecido do pagamento para a frase do contrato", () => {
  const recusada = (detalhe: string) => ({
    id: "ORD1",
    status: "failed",
    status_detail: "failed",
    transactions: { payments: [{ id: "PAY1", status: "failed", status_detail: detalhe }] },
  });
  const esperados: Array<[string, string]> = [
    ["bad_filled_card_data", "Confira os dados do cartão e tente de novo."],
    ["insufficient_amount", "Saldo ou limite insuficiente neste cartão."],
    ["card_insufficient_amount", "Saldo ou limite insuficiente neste cartão."],
    ["amount_limit_exceeded", "Saldo ou limite insuficiente neste cartão."],
    ["rejected_by_issuer", "O banco emissor recusou o pagamento."],
    ["high_risk", "Pagamento recusado por segurança. Tente outro cartão ou pague com PIX."],
    ["required_call_for_authorize", "Seu banco pede autorização: ligue para ele e tente de novo."],
    ["card_disabled", "Cartão desabilitado. Fale com o seu banco."],
    ["max_attempts_exceeded", "Limite de tentativas atingido para este cartão. Use outro cartão."],
    ["invalid_installments", "Esse parcelamento não está disponível para este cartão."],
    ["3ds_challenge_expired", "A autenticação do banco não foi concluída."],
    ["cc_rejected_3ds_challenge", "A autenticação do banco não foi concluída."],
    ["invalid_card_token", "Os dados do cartão expiraram. Digite de novo."],
  ];
  for (const [detalhe, frase] of esperados) {
    assertEquals(motivoDaRecusa(recusada(detalhe)), frase, detalhe);
  }
  assertEquals(MOTIVO_RECUSA_DADOS_DO_CARTAO, "Confira os dados do cartão e tente de novo.");
});

Deno.test("motivoDaRecusa: detalhe do PAGAMENTO vence o da raiz; raiz é o fallback; desconhecido vira a frase padrão (nunca o código cru)", () => {
  assertEquals(
    motivoDaRecusa({
      status_detail: "high_risk",
      transactions: { payments: [{ status_detail: "rejected_by_issuer" }] },
    }),
    "O banco emissor recusou o pagamento.",
  );
  assertEquals(
    motivoDaRecusa({ status_detail: "high_risk", transactions: { payments: [{ status_detail: "failed" }] } }),
    "Pagamento recusado por segurança. Tente outro cartão ou pague com PIX.",
  );
  assertEquals(
    motivoDaRecusa({ transactions: { payments: [{ status_detail: "cc_rejected_novo_motivo" }] } }),
    MOTIVO_RECUSA_PADRAO,
  );
  assertEquals(MOTIVO_RECUSA_PADRAO, "Pagamento recusado. Tente outro cartão ou pague com PIX.");
  assertEquals(motivoDaRecusa(null), MOTIVO_RECUSA_PADRAO);
  // Chave que existe no protótipo de um objeto comum não pode virar motivo.
  assertEquals(motivoDaRecusa({ status_detail: "constructor" }), MOTIVO_RECUSA_PADRAO);
});

Deno.test("motivoDaRecusaDoErro: lê a order recusada em `data` do 402; sem motivo lá, o sufixo de errors[].details; lixo vira a frase padrão", () => {
  assertEquals(
    motivoDaRecusaDoErro({
      errors: [{ code: "failed", message: "The following transactions failed" }],
      data: {
        id: "ORD1",
        status: "failed",
        transactions: { payments: [{ status: "failed", status_detail: "insufficient_amount" }] },
      },
    }),
    "Saldo ou limite insuficiente neste cartão.",
  );
  assertEquals(
    motivoDaRecusaDoErro({
      errors: [{ code: "failed", details: ["PAY01ABC: card_disabled"] }],
    }),
    "Cartão desabilitado. Fale com o seu banco.",
  );
  assertEquals(motivoDaRecusaDoErro({ errors: [{ code: "x", details: ["sem motivo"] }] }), MOTIVO_RECUSA_PADRAO);
  assertEquals(motivoDaRecusaDoErro(undefined), MOTIVO_RECUSA_PADRAO);
  assertEquals(motivoDaRecusaDoErro("texto"), MOTIVO_RECUSA_PADRAO);
});

Deno.test("erro400EhDeDadoDoCartao (Achado A4): só os códigos CURADOS de dado do cartão são 'sim' — o resto (ausente, desconhecido, corpo ilegível) é 'não', para não virar recusa de cartão à toa", () => {
  // Os três códigos comprovadamente do CARTÃO.
  assertEquals(erro400EhDeDadoDoCartao({ errors: [{ code: "invalid_card_token" }] }), true);
  assertEquals(erro400EhDeDadoDoCartao({ errors: [{ code: "card_token_not_found" }] }), true);
  assertEquals(erro400EhDeDadoDoCartao({ errors: [{ code: "bad_filled_card_data" }] }), true);
  // Um dos vários códigos, não só o primeiro do array.
  assertEquals(
    erro400EhDeDadoDoCartao({ errors: [{ code: "outro_codigo" }, { code: "invalid_card_token" }] }),
    true,
  );
  // Causa de 400 que NÃO é do cartão (ex.: total_amount que não bate com a
  // soma dos pagamentos) — bug de integração, não "confira seu cartão".
  assertEquals(
    erro400EhDeDadoDoCartao({ errors: [{ code: "invalid_parameter", message: "total_amount mismatch" }] }),
    false,
  );
  // Nada reconhecível: nunca um palpite otimista.
  assertEquals(erro400EhDeDadoDoCartao({ errors: [] }), false);
  assertEquals(erro400EhDeDadoDoCartao({ message: "corpo sem errors[]" }), false);
  assertEquals(erro400EhDeDadoDoCartao(undefined), false);
  assertEquals(erro400EhDeDadoDoCartao(null), false);
  assertEquals(erro400EhDeDadoDoCartao("texto"), false);
});

Deno.test("recusaLiberaAVaga: cartão recusado/cancelado/expirado libera; PIX recusado/expirado NÃO (cancela o pedido como antes); PIX CANCELADO libera", () => {
  const ordem = (tipo: string, status: string) => ({
    id: "ORD1",
    status,
    transactions: { payments: [{ payment_method: { type: tipo } }] },
  });
  assertEquals(recusaLiberaAVaga(ordem("credit_card", "failed"), "recusado"), true);
  assertEquals(recusaLiberaAVaga(ordem("debit_card", "canceled"), "recusado"), true);
  assertEquals(recusaLiberaAVaga(ordem("credit_card", "expired"), "expirado"), true);
  // Cartão que não é desfecho sem dinheiro nunca libera.
  assertEquals(recusaLiberaAVaga(ordem("credit_card", "processed"), "pago"), false);
  assertEquals(recusaLiberaAVaga(ordem("credit_card", "processing"), "aguardando"), false);
  assertEquals(recusaLiberaAVaga(ordem("credit_card", "refunded"), "estornado"), false);
  assertEquals(recusaLiberaAVaga(ordem("credit_card", "x"), null), false);
  // PIX: comportamento de antes, exceto o cancelamento (que é o app trocando
  // para cartão — ver o docstring da função).
  assertEquals(recusaLiberaAVaga(ordem("bank_transfer", "failed"), "recusado"), false);
  assertEquals(recusaLiberaAVaga(ordem("bank_transfer", "expired"), "expirado"), false);
  assertEquals(recusaLiberaAVaga(ordem("bank_transfer", "canceled"), "recusado"), true);
  assertEquals(recusaLiberaAVaga({ id: "ORD1", status: "canceled" }, "recusado"), true);
});

Deno.test("orderCancelada aceita 'canceled' (grafia do MP) e 'cancelled'; nada mais", () => {
  assertEquals(orderCancelada({ status: "canceled" }), true);
  assertEquals(orderCancelada({ status: "cancelled" }), true);
  assertEquals(orderCancelada({ status: "action_required" }), false);
  assertEquals(orderCancelada(null), false);
});

Deno.test("cancelarOrder: POST em /v1/orders/{id}/cancel, com Bearer e chave de idempotência, sem corpo", async () => {
  let capturada: { url: string; init: RequestInit } | null = null;
  const fetchStub = ((url: string, init: RequestInit) => {
    capturada = { url, init };
    return Promise.resolve(
      new Response(JSON.stringify({ id: "ORD01PIX", status: "canceled", status_detail: "canceled" }), {
        status: 200,
      }),
    );
  }) as unknown as typeof fetch;

  const r = await cancelarOrder({
    token: "APP_USR-token",
    orderId: "ORD01PIX",
    chaveIdempotencia: "cancelar:ORD01PIX",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.order.status, "canceled");
  assertStringIncludes(capturada!.url, "/v1/orders/ORD01PIX/cancel");
  assertEquals(capturada!.init.method, "POST");
  assertEquals(capturada!.init.body, undefined);
  const headers = capturada!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer APP_USR-token");
  assertEquals(headers["X-Idempotency-Key"], "cancelar:ORD01PIX");
});

Deno.test("cancelarOrder codifica o id no caminho — dado nunca vai cru para a URL", async () => {
  let url = "";
  const fetchStub = ((u: string) => {
    url = u;
    return Promise.resolve(new Response(JSON.stringify({ id: "x", status: "canceled" })));
  }) as unknown as typeof fetch;
  await cancelarOrder({ token: "t", orderId: "ORD/../payments", chaveIdempotencia: "k", fetchImpl: fetchStub });
  assertStringIncludes(url, "/v1/orders/ORD%2F..%2Fpayments/cancel");
});

Deno.test("cancelarOrder: MP recusa (PIX já pago) -> ok:false com o status, sem vazar o corpo na mensagem; rede caída -> status 0", async () => {
  const recusou = await cancelarOrder({
    token: "t",
    orderId: "ORD01PAGO",
    chaveIdempotencia: "k",
    fetchImpl: (() =>
      Promise.resolve(
        new Response(JSON.stringify({ errors: [{ code: "cannot_cancel_order", message: "conta 999" }] }), {
          status: 409,
        }),
      )) as unknown as typeof fetch,
  });
  assertEquals(recusou.ok, false);
  if (!recusou.ok) {
    assertEquals(recusou.status, 409);
    assertEquals(recusou.erro.includes("conta 999"), false);
  }

  const semRede = await cancelarOrder({
    token: "t",
    orderId: "ORD01",
    chaveIdempotencia: "k",
    fetchImpl: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch,
  });
  assertEquals(semRede.ok, false);
  if (!semRede.ok) assertEquals(semRede.status, 0);
});

Deno.test("P-4 - cancelarOrder com gateway pendurado devolve ok:false PELO TIMEOUT", async () => {
  const r = await cancelarOrder({
    token: "t",
    orderId: "ORD01",
    chaveIdempotencia: "k",
    fetchImpl: buscarPendurado as unknown as typeof fetch,
    tempoLimiteMs: 20,
  });
  assertEquals(r.ok, false);
  assertEquals(r.ok ? null : r.status, 0);
});

Deno.test("criarOrder devolve `corpoDoErro` parseado no 402 (recusa de cartão) — quem chama lê o motivo sem um segundo GET", async () => {
  const corpo402 = {
    errors: [{ code: "failed", message: "The following transactions failed" }],
    data: {
      id: "ORD01FAIL",
      status: "failed",
      transactions: { payments: [{ status: "failed", status_detail: "rejected_by_issuer" }] },
    },
  };
  const r = await criarOrder({
    token: "t",
    corpo: {},
    chaveIdempotencia: "k",
    fetchImpl: (() =>
      Promise.resolve(new Response(JSON.stringify(corpo402), { status: 402 }))) as unknown as typeof fetch,
    corpoNoLog: false,
  });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 402);
    assertEquals(r.corpoDoErro, corpo402);
    assertEquals(r.erro, "Não foi possível gerar a cobrança.");
  }
});

Deno.test("criarOrder com corpoNoLog:false NÃO põe e-mail nem CPF do pagador no log — só códigos e status", async () => {
  const logados: unknown[][] = [];
  const consoleErrorReal = console.error;
  console.error = (...args: unknown[]) => {
    logados.push(args);
  };
  try {
    await criarOrder({
      token: "t",
      corpo: {},
      chaveIdempotencia: "k",
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [{ code: "failed" }],
              data: {
                status: "failed",
                payer: { email: "cliente@exemplo.com", identification: { type: "CPF", number: CPF_TESTE } },
                transactions: { payments: [{ status_detail: "high_risk", payment_method: { token: TOKEN_CARTAO } }] },
              },
            }),
            { status: 402 },
          ),
        )) as unknown as typeof fetch,
      corpoNoLog: false,
    });
  } finally {
    console.error = consoleErrorReal;
  }
  const texto = JSON.stringify(logados);
  assertEquals(texto.includes("cliente@exemplo.com"), false);
  assertEquals(texto.includes(CPF_TESTE), false);
  assertEquals(texto.includes(TOKEN_CARTAO), false);
  // O que ajuda a depurar continua lá.
  assertStringIncludes(texto, "high_risk");
  assertStringIncludes(texto, "402");
});

Deno.test("criarOrder SEM corpoNoLog (PIX) continua logando o corpo do erro como sempre — o conserto do cartão não muda o PIX", async () => {
  const logados: unknown[][] = [];
  const consoleErrorReal = console.error;
  console.error = (...args: unknown[]) => {
    logados.push(args);
  };
  try {
    await criarOrder({
      token: "t",
      corpo: {},
      chaveIdempotencia: "k",
      fetchImpl: (() =>
        Promise.resolve(new Response("detalhe-bruto-do-mp", { status: 500 }))) as unknown as typeof fetch,
    });
  } finally {
    console.error = consoleErrorReal;
  }
  assertEquals(logados.length, 1);
  assertEquals(logados[0][0], "mercadopago: orders recusou");
  assertEquals(logados[0][2], "detalhe-bruto-do-mp");
});

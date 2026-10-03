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
  buscarOrdersDoPedido,
  cancelarOrder,
  consultarOrder,
  consultarPagamento,
  criarOrder,
  deviceIdValido,
  dividirNomeDoPagador,
  erro400EhDeDadoDoCartao,
  extrairDataExpiracaoOrder,
  extrairDesafio3ds,
  extrairQrCode,
  formatarExpiracao,
  idEhClassico,
  limiteInferiorDoSentinela,
  MAPA_STATUS_ORDER,
  mapearStatus,
  mapearStatusOrder,
  MARGEM_LIBERAR_APOS_LIMITE_MS,
  MARGEM_RELOGIO_BUSCA_MS,
  minutosDaExpiracaoPix,
  montarCorpoCartaoOrders,
  montarCorpoPix,
  montarCorpoPixOrders,
  montarSentinela,
  MOTIVO_RECUSA_DADOS_DO_CARTAO,
  MOTIVO_RECUSA_PADRAO,
  motivoDaRecusa,
  motivoDaRecusaDoErro,
  normalizarDocumento,
  orderCancelada,
  orderEhDeCartao,
  parcelasDaOrder,
  recusaLiberaAVaga,
  resolverSentinela,
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

// --- buscarOrdersDoPedido: GET /v1/orders?external_reference=... (Ponto 1,
// 4ª revisão de risco, 26/09/2026) — parâmetros exatos, paginação e atraso de
// indexação UNVERIFIED contra a API real (ver o docstring da função);
// mesmo contrato de `consultarOrder`: nunca rejeita, corpo do erro só no log.

Deno.test("buscarOrdersDoPedido: GET com external_reference/begin_date/end_date na query, sem corpo e sem chave de idempotência", async () => {
  let capturada: { url: string; init: RequestInit } | null = null;
  const fetchStub = ((url: string, init: RequestInit) => {
    capturada = { url, init };
    return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
  }) as unknown as typeof fetch;

  const r = await buscarOrdersDoPedido({
    token: "TEST-token",
    pedidoId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    desde: "2026-09-26T12:00:00.000Z",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.orders, []);
  assertEquals(capturada!.init.method, "GET");
  assertEquals(capturada!.init.body, undefined);
  const headers = capturada!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer TEST-token");
  assertEquals(headers["X-Idempotency-Key"], undefined);
  assertStringIncludes(capturada!.url, "/v1/orders?");
  assertStringIncludes(capturada!.url, "external_reference=3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
  // B1 (5ª revisão de risco, 26/09/2026): `begin_date` normalizado em ISO e
  // com MARGEM_RELOGIO_BUSCA_MS (2 min) de folga PARA TRÁS — nunca o
  // `desde` cru sem margem.
  assertStringIncludes(capturada!.url, "begin_date=2026-09-26T11%3A58%3A00.000Z");
  const endDateBruto = new URL(capturada!.url).searchParams.get("end_date")!;
  assertEquals(
    Math.abs(Date.parse(endDateBruto) - (Date.now() + MARGEM_RELOGIO_BUSCA_MS)) < 2000,
    true,
    "end_date com a MESMA margem, para a FRENTE de agora",
  );
});

Deno.test("buscarOrdersDoPedido: begin_date ilegível vai CRU (mais seguro que omitir um parâmetro talvez obrigatório)", async () => {
  let capturada: string | null = null;
  const fetchStub = ((url: string) => {
    capturada = url;
    return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
  }) as unknown as typeof fetch;
  await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "não é data nenhuma", fetchImpl: fetchStub });
  const beginDate = new URL(capturada!).searchParams.get("begin_date");
  assertEquals(beginDate, "não é data nenhuma");
});

Deno.test("buscarOrdersDoPedido: aceita 'results' OU 'elements' como o campo da lista (nome exato não confirmado contra a API real)", async () => {
  const ordem = { id: "ORD1", external_reference: "p" };
  const comResults = (() =>
    Promise.resolve(new Response(JSON.stringify({ results: [ordem] }), { status: 200 }))) as unknown as typeof fetch;
  const comElements = (() =>
    Promise.resolve(new Response(JSON.stringify({ elements: [ordem] }), { status: 200 }))) as unknown as typeof fetch;

  const r1 = await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: comResults });
  const r2 = await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: comElements });
  assertEquals(r1, { ok: true, orders: [ordem] });
  assertEquals(r2, { ok: true, orders: [ordem] });
});

// B2 (5ª revisão de risco, 26/09/2026): a lista devolvida pode trazer order
// de OUTRO pedido (o filtro `external_reference` da query é do lado do
// SERVIDOR do MP, não verificado) — `buscarOrdersDoPedido` filtra de novo,
// no CLIENTE, antes de devolver.
Deno.test("buscarOrdersDoPedido: filtra por external_reference === pedidoId — order de OUTRO pedido (ou sem external_reference) nunca aparece na lista devolvida", async () => {
  const daquele = { id: "ORD-DESTE", external_reference: "pedido-A" };
  const deOutro = { id: "ORD-DE-OUTRO", external_reference: "pedido-B" };
  const semReferencia = { id: "ORD-ORFA" };
  const fetchStub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ results: [daquele, deOutro, semReferencia] }), { status: 200 }),
    )) as unknown as typeof fetch;

  const r = await buscarOrdersDoPedido({ token: "t", pedidoId: "pedido-A", desde: "d", fetchImpl: fetchStub });
  assertEquals(r, { ok: true, orders: [daquele] });
});

Deno.test("buscarOrdersDoPedido: HTTP não-2xx, corpo ilegível, corpo sem lista reconhecível, ou rede caída -> ok:false — NUNCA lista vazia (falha e 'nada encontrado' são fatos diferentes)", async () => {
  const naoOk = (() => Promise.resolve(new Response(JSON.stringify({ errors: [] }), { status: 500 }))) as unknown as typeof fetch;
  const ilegivel = (() => Promise.resolve(new Response("<html>não é JSON</html>", { status: 200 }))) as unknown as typeof fetch;
  const semLista = (() =>
    Promise.resolve(new Response(JSON.stringify({ paging: { total: 0 } }), { status: 200 }))) as unknown as typeof fetch;
  const redeCaida = (() => Promise.reject(new DOMException("aborted", "AbortError"))) as unknown as typeof fetch;

  assertEquals((await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: naoOk })).ok, false);
  assertEquals((await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: ilegivel })).ok, false);
  assertEquals((await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: semLista })).ok, false);
  assertEquals((await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: redeCaida })).ok, false);
});

// ACHADO (doc primária + SDK oficial mercadopago@3.2.1; confirmado na
// reference: response = { data: [...], paging: {...} }): a lista da busca de
// orders vem em `data` — NÃO em `results`/`elements`. Sem aceitar `data`, a
// busca volta ok:false SEMPRE em produção e a liberação do sentinela por
// busca (Ponto 1 da criar-pagamento e o webhook, Ponto 2) vira código morto:
// só `expires_at` liberaria.

Deno.test("buscarOrdersDoPedido: lista em 'data' (formato DOCUMENTADO da busca de orders) -> ok:true com as orders DESTE pedido — order de outro pedido dentro de 'data' continua refiltrada (B2)", async () => {
  const minha = { id: "ORD-MINHA", status: "failed", external_reference: "p" };
  const deOutro = { id: "ORD-OUTRA", status: "processed", external_reference: "outro-pedido" };
  const fetchStub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [minha, deOutro], paging: { total: 2, limit: 20 } }), { status: 200 }),
    )) as unknown as typeof fetch;

  const r = await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: fetchStub });
  assertEquals(r, { ok: true, orders: [minha] });
});

Deno.test("buscarOrdersDoPedido: {data:[]} -> ok:true com lista VAZIA ('nada encontrado' != falha) — e resolverSentinela com lista vazia segue NUNCA liberando (null)", async () => {
  const fetchStub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [], paging: { total: 0 } }), { status: 200 }),
    )) as unknown as typeof fetch;

  const r = await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: fetchStub });
  assertEquals(r, { ok: true, orders: [] });
  // A semântica fail-safe sobrevive ao novo nome: lista vazia NUNCA é
  // "liberar" — atraso de indexação não é o mesmo fato que "encontrei e está
  // morta".
  assertEquals(resolverSentinela(r.ok ? r.orders : [], AGORA_MS), null);
});

Deno.test("buscarOrdersDoPedido: 'data' que não é array (ou corpo só com paging) continua ok:false — NUNCA lista vazia", async () => {
  const dataNaoLista = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: null, paging: { total: 0 } }), { status: 200 }),
    )) as unknown as typeof fetch;
  const soPaging = (() =>
    Promise.resolve(new Response(JSON.stringify({ paging: { total: 0 } }), { status: 200 }))) as unknown as typeof fetch;

  assertEquals((await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: dataNaoLista })).ok, false);
  assertEquals((await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: soPaging })).ok, false);
});

// PAGINAÇÃO (02/10/2026): a busca antes não mandava `page_size` nem ordenação
// (a API devolve 20 por página) e devolvia `{ ok: true }` com a 1ª página como
// se fosse a lista COMPLETA — um pedido com 21+ orders na janela, e a viva (ou
// a capturada) só na página 2, soltava a vaga. Regra de completude, sobre a
// lista CRUA (antes do refiltro por `external_reference`):
//   (a) `paging.total` válido (inteiro >= 0) e <= tamanho da lista -> completa;
//   (b) `total` ausente/inválido e lista < 20 (o `page_size` DEFAULT da API, não
//       os 100 pedidos: se a API ignorar o parâmetro serve no máximo 20, então
//       uma página de 20 sem `paging` é ambígua) -> a última -> completa;
//   qualquer outro caso -> `{ ok: false }` (nunca libera, nunca recusa).
// Referência oficial (Search order, consultada em 02/10/2026): `page_size`
// default 20, máx. 100; `paging` = { total, total_pages, offset, limit } com os
// quatro campos como STRING.

function ordensDoPedido(n: number, pedidoId = "p"): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({ id: `ORD-${i}`, status: "failed", external_reference: pedidoId }));
}

function buscaComCorpo(corpo: unknown) {
  return (() => Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 }))) as unknown as typeof fetch;
}

Deno.test("buscarOrdersDoPedido (paginação): manda page_size=100, sort_by=created_date e sort_order=desc, junto dos parâmetros que já mandava", async () => {
  let capturada: string | null = null;
  const fetchStub = ((url: string) => {
    capturada = url;
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  }) as unknown as typeof fetch;

  await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    desde: "2026-09-26T12:00:00.000Z",
    fetchImpl: fetchStub,
  });

  const q = new URL(capturada!).searchParams;
  assertEquals(q.get("page_size"), "100");
  assertEquals(q.get("sort_by"), "created_date");
  assertEquals(q.get("sort_order"), "desc");
  assertEquals(q.get("external_reference"), "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
  assertEquals(q.get("begin_date"), "2026-09-26T11:58:00.000Z");
  assertEquals(typeof q.get("end_date"), "string");
  assertEquals(
    [...q.keys()].sort(),
    ["begin_date", "end_date", "external_reference", "page_size", "sort_by", "sort_order"],
    "nenhum parâmetro a mais nem a menos — e nenhum `page`: não paginamos",
  );
});

Deno.test("buscarOrdersDoPedido (paginação, a): 1ª página de 20 com paging.total='21' (a order viva está fora dela) -> ok:false, NUNCA ok:true com lista parcial", async () => {
  const fetchStub = buscaComCorpo({
    data: ordensDoPedido(20),
    paging: { total: "21", total_pages: "2", offset: "0", limit: "20" },
  });
  const r = await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl: fetchStub });
  assertEquals(r, { ok: false });
});

Deno.test("buscarOrdersDoPedido (paginação, b): sem paging e 20 itens (ou mais: 21, 99, 100) -> ok:false — 20 é o default da API, então uma página de 20 é ambígua (a API pode ter ignorado o page_size)", async () => {
  for (const n of [20, 21, 99, 100]) {
    const r = await buscarOrdersDoPedido({
      token: "t",
      pedidoId: "p",
      desde: "d",
      fetchImpl: buscaComCorpo({ data: ordensDoPedido(n) }),
    });
    assertEquals(r, { ok: false }, `${n} itens sem paging`);
  }
});

Deno.test("buscarOrdersDoPedido (paginação, c): sem paging e página CURTA (0, 3, 19 — menos de 20) -> ok:true (mantém os dublês antigos e a API que omite o paging)", async () => {
  for (const n of [0, 3, 19]) {
    const r = await buscarOrdersDoPedido({
      token: "t",
      pedidoId: "p",
      desde: "d",
      fetchImpl: buscaComCorpo({ data: ordensDoPedido(n) }),
    });
    assertEquals(r, { ok: true, orders: ordensDoPedido(n) }, `${n} itens sem paging`);
  }
});

Deno.test("buscarOrdersDoPedido (paginação, d): paging.total='3' com 3 itens (e total numérico) -> ok:true; total == tamanho da página cheia (100) também é completo", async () => {
  const comString = await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "p",
    desde: "d",
    fetchImpl: buscaComCorpo({
      data: ordensDoPedido(3),
      paging: { total: "3", total_pages: "1", offset: "0", limit: "100" },
    }),
  });
  assertEquals(comString, { ok: true, orders: ordensDoPedido(3) });

  const comNumero = await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "p",
    desde: "d",
    fetchImpl: buscaComCorpo({ data: ordensDoPedido(3), paging: { total: 3 } }),
  });
  assertEquals(comNumero, { ok: true, orders: ordensDoPedido(3) });

  // BORDA: exatamente uma página cheia e nada além -> total (100) <= n (100).
  const cheiaECompleta = await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "p",
    desde: "d",
    fetchImpl: buscaComCorpo({ data: ordensDoPedido(100), paging: { total: "100" } }),
  });
  assertEquals(cheiaECompleta.ok, true);
  // BORDA: um a mais que a página -> incompleta.
  const umAMais = await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "p",
    desde: "d",
    fetchImpl: buscaComCorpo({ data: ordensDoPedido(100), paging: { total: "101" } }),
  });
  assertEquals(umAMais, { ok: false });
});

Deno.test("buscarOrdersDoPedido (paginação, e): paging.total inválido ('abc', vazio, null, negativo, fracionário, booleano) -> cai na regra do tamanho: 19 itens ok:true, 20 (e 100) ok:false", async () => {
  for (const total of ["abc", "", "  ", null, "-1", -1, "2.5", 2.5, true, false, [], {}]) {
    const curta = await buscarOrdersDoPedido({
      token: "t",
      pedidoId: "p",
      desde: "d",
      fetchImpl: buscaComCorpo({ data: ordensDoPedido(19), paging: { total } }),
    });
    assertEquals(curta.ok, true, `total inválido ${JSON.stringify(total)} com 19 itens`);
    for (const n of [20, 100]) {
      const cheia = await buscarOrdersDoPedido({
        token: "t",
        pedidoId: "p",
        desde: "d",
        fetchImpl: buscaComCorpo({ data: ordensDoPedido(n), paging: { total } }),
      });
      assertEquals(cheia.ok, false, `total inválido ${JSON.stringify(total)} com ${n} itens NÃO pode virar 'total 0'`);
    }
  }
  // `paging` que nem objeto é.
  for (const paging of ["21", 21, null, []]) {
    const cheia = await buscarOrdersDoPedido({
      token: "t",
      pedidoId: "p",
      desde: "d",
      fetchImpl: buscaComCorpo({ data: ordensDoPedido(20), paging }),
    });
    assertEquals(cheia.ok, false, `paging ${JSON.stringify(paging)} ilegível com 20 itens`);
  }
});

Deno.test("buscarOrdersDoPedido (paginação): a completude olha a lista CRUA — 100 orders da loja com só 3 deste pedido e sem paging (filtro do servidor ignorado) -> ok:false; e total > crua também", async () => {
  const mistura = [...ordensDoPedido(3), ...ordensDoPedido(97, "outro-pedido")];
  const semPaging = await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "p",
    desde: "d",
    fetchImpl: buscaComCorpo({ data: mistura }),
  });
  assertEquals(semPaging, { ok: false }, "100 cruas = página cheia, mesmo que o refiltro deixe só 3");

  const totalMaior = await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "p",
    desde: "d",
    fetchImpl: buscaComCorpo({ data: ordensDoPedido(3), paging: { total: "40" } }),
  });
  assertEquals(totalMaior, { ok: false }, "o refiltro nunca encurta a lista a ponto de enganar: 3 de 40 é parcial");

  // E o refiltro continua valendo quando a lista É completa.
  const completa = await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "p",
    desde: "d",
    fetchImpl: buscaComCorpo({ data: [...ordensDoPedido(2), ...ordensDoPedido(1, "outro")], paging: { total: "3" } }),
  });
  assertEquals(completa, { ok: true, orders: ordensDoPedido(2) });
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

// Adendo 2 à 8ª rodada de risco (26/09/2026, revisão do front): a tabela só
// cobria o detalhe EXATO "canceled" — um detalhe novo do MP (medido por
// WebSearch contra a doc oficial, já que os domínios mercadopago.* estão
// bloqueados para fetch direto neste ambiente: "canceled_transaction",
// "canceled_by_api", UNVERIFIED contra a API real) caía em `null`, e a vaga
// ficava presa "em análise" para sempre — a Orders API só cancela order em
// `action_required`/`created` (sem dinheiro capturado ainda), então
// QUALQUER detalhe de `canceled`/`cancelled` é terminal, igual a `failed`.
Deno.test("mapearStatusOrder: canceled/cancelled com QUALQUER detalhe vira recusado — a Orders API só cancela order sem dinheiro capturado", () => {
  assertEquals(mapearStatusOrder("canceled", "canceled_transaction"), "recusado");
  assertEquals(mapearStatusOrder("canceled", "canceled_by_api"), "recusado");
  assertEquals(mapearStatusOrder("cancelled", "um_detalhe_que_o_mp_inventar_amanha"), "recusado");
  // A regra é do STATUS, não do detalhe: o mesmo detalhe com outro status
  // continua desconhecido.
  assertEquals(mapearStatusOrder("processing", "canceled"), null);
});

Deno.test("mapearStatusOrder: expired + expired vira expirado", () => {
  assertEquals(mapearStatusOrder("expired", "expired"), "expirado");
});

// Adendo 2 à 8ª rodada de risco (26/09/2026): mesma lacuna do canceled —
// a doc do MP descreve `expired` como "uma order cancelada sem pagamento
// aprovado ou pendente", terminal por definição, qualquer detalhe.
Deno.test("mapearStatusOrder: expired com QUALQUER detalhe vira expirado", () => {
  assertEquals(mapearStatusOrder("expired", "um_detalhe_que_o_mp_inventar_amanha"), "expirado");
  assertEquals(mapearStatusOrder("processing", "expired"), null);
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

// Achado S3 (3ª revisão de risco, 26/09/2026): parcelasDaOrder — a ADOÇÃO da
// vaga (`webhook-mercadopago/index.ts`) passou a gravar `parcelas` a partir
// deste leitor, em vez de deixar a coluna NULL para uma cobrança de cartão
// de verdade.
Deno.test("parcelasDaOrder lê transactions.payments[0].payment_method.installments — null quando ausente, não-inteiro, ou a order não é objeto", () => {
  const ordem = (installments?: unknown) => ({
    id: "ORD1",
    transactions: {
      payments: [{
        id: "PAY1",
        payment_method: installments === undefined ? { id: "x" } : { id: "x", installments },
      }],
    },
  });
  assertEquals(parcelasDaOrder(ordem(6)), 6);
  assertEquals(parcelasDaOrder(ordem(1)), 1);
  assertEquals(parcelasDaOrder(ordem()), null);
  assertEquals(parcelasDaOrder(ordem("6")), null, "string não é o formato que a Orders API manda — nunca converte por palpite");
  assertEquals(parcelasDaOrder(ordem(1.5)), null, "parcela fracionária não existe — não-inteiro é tratado como ausente");
  assertEquals(parcelasDaOrder({ id: "ORD1" }), null);
  assertEquals(parcelasDaOrder(null), null);
});

// Menor (4ª revisão de risco, 26/09/2026): a CHECK do banco só aceita 1..12
// (`parcelasValidas`, a MESMA regra) — fora da faixa vira `null`
// (desconhecido), nunca quebra a ADOÇÃO (`webhook-mercadopago/index.ts`) nem
// a resolução do sentinela (`criar-pagamento/index.ts`, Ponto 1) por causa de
// uma coluna cosmética.
Deno.test("parcelasDaOrder: fora de 1..12 (a CHECK do banco) vira null, nunca quebra quem chama", () => {
  const ordem = (installments: unknown) => ({
    id: "ORD1",
    transactions: { payments: [{ id: "PAY1", payment_method: { id: "x", installments } }] },
  });
  assertEquals(parcelasDaOrder(ordem(0)), null);
  assertEquals(parcelasDaOrder(ordem(-1)), null);
  assertEquals(parcelasDaOrder(ordem(13)), null);
  assertEquals(parcelasDaOrder(ordem(1)), 1);
  assertEquals(parcelasDaOrder(ordem(12)), 12);
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

// --- resolverSentinela: decide o sentinela por FATO (Ponto 1, 4ª revisão de
// risco, 26/09/2026; B1, 5ª revisão, 26/09/2026) --------------------------

const AGORA_MS = Date.parse("2026-09-26T12:10:00.000Z");
/** Dentro da janela por padrão — relógio REALISTA (BLOQUEIO da 7ª revisão de
 * risco, 26/09/2026): a margem de liberação é PARA A FRENTE
 * (`MARGEM_LIBERAR_APOS_LIMITE_MS`), então uma order "desta tentativa" só
 * conta se foi criada BEM depois do limite inferior — 60s é um retry humano
 * plausível (reabrir o formulário, digitar o cartão de novo). Os testes que
 * precisam de uma order FORA da janela (Q3, a order da tentativa ANTERIOR)
 * passam `dateCreated` explicitamente, ANTES do limite. */
const DATE_CREATED_PADRAO = new Date(AGORA_MS + 60_000).toISOString();

/** Uma order mínima, no formato que `buscarOrdersDoPedido` devolveria. */
function ordemMinima(
  status: string,
  tipo = "credit_card",
  id = "ORD1",
  dateCreated: string | null = DATE_CREATED_PADRAO,
): Record<string, unknown> {
  return {
    id,
    status,
    status_detail: `${status}_detail`,
    ...(dateCreated !== null ? { date_created: dateCreated } : {}),
    transactions: { payments: [{ id: "PAY1", payment_method: { id: "x", type: tipo } }] },
  };
}

Deno.test("resolverSentinela: lista vazia (nenhuma order de cartão encontrada) -> null, NUNCA 'liberar' — busca sem resultado não é o mesmo fato que 'encontrei e está morta'", () => {
  assertEquals(resolverSentinela([], AGORA_MS), null);
  // Só PIX na resposta (a busca por external_reference também devolve o PIX
  // do mesmo pedido) -> continua null, não "liberar".
  assertEquals(resolverSentinela([ordemMinima("action_required", "bank_transfer")], AGORA_MS), null);
});

Deno.test("resolverSentinela: uma order de cartão PROCESSED -> gravar (Achado 'adopt only on a fully known state', 6ª rodada: processed sozinho não decide mais aprovação — só a reconsulta por id decide), mesmo com status_detail que este arquivo não conhece", () => {
  assertEquals(resolverSentinela([ordemMinima("processed")], AGORA_MS), {
    acao: "gravar",
    order: ordemMinima("processed"),
  });
  const processedDetalheEstranho = { ...ordemMinima("processed"), status_detail: "algo_novo_do_mp" };
  assertEquals(resolverSentinela([processedDetalheEstranho], AGORA_MS), {
    acao: "gravar",
    order: processedDetalheEstranho,
  });
});

Deno.test("resolverSentinela: nenhuma aprovada, mas uma viva (created/processing/action_required) -> gravar", () => {
  for (const status of ["created", "processing", "action_required"]) {
    assertEquals(resolverSentinela([ordemMinima(status)], AGORA_MS), {
      acao: "gravar",
      order: ordemMinima(status),
    });
  }
});

Deno.test("resolverSentinela: TODAS reconhecidamente mortas (failed/canceled/expired/refunded/charged_back) E dentro da janela -> liberar", () => {
  for (const status of ["failed", "canceled", "cancelled", "expired", "refunded", "charged_back"]) {
    assertEquals(resolverSentinela([ordemMinima(status)], AGORA_MS), { acao: "liberar" }, status);
  }
  // Mais de uma, todas mortas -> ainda libera.
  assertEquals(
    resolverSentinela(
      [ordemMinima("failed", "credit_card", "ORD1"), ordemMinima("expired", "credit_card", "ORD2")],
      AGORA_MS,
    ),
    { acao: "liberar" },
  );
});

Deno.test("resolverSentinela: processed/viva tem prioridade sobre morta, quando as duas aparecem juntas", () => {
  const aprovada = ordemMinima("processed", "credit_card", "ORD-APROVADA");
  const viva = ordemMinima("processing", "credit_card", "ORD-VIVA");
  const morta = ordemMinima("failed", "credit_card", "ORD-MORTA");
  assertEquals(resolverSentinela([morta, viva, aprovada], AGORA_MS), { acao: "gravar", order: aprovada });
});

Deno.test("resolverSentinela: status DESCONHECIDO (nem aprovado, nem vivo, nem reconhecidamente morto) -> gravar (nunca libera às cegas)", () => {
  const desconhecida = ordemMinima("algo_que_o_mp_pode_inventar_depois");
  assertEquals(resolverSentinela([desconhecida], AGORA_MS), { acao: "gravar", order: desconhecida });
  // Uma morta reconhecida + uma desconhecida -> ainda "gravar" (não é
  // "TODAS mortas" enquanto sobrar uma que este arquivo não sabe classificar)
  // — qual das duas volta no `order` não importa aqui; o que importa é NUNCA
  // "liberar".
  const morta = ordemMinima("failed", "credit_card", "ORD-MORTA");
  assertEquals(resolverSentinela([morta, desconhecida], AGORA_MS).acao, "gravar");
});

// --- B1 (5ª revisão de risco, 26/09/2026), margem CORRIGIDA na 7ª revisão
// (BLOQUEIO, 26/09/2026): "liberar" só com uma order MORTA criada DEPOIS do
// limite inferior, com margem PARA A FRENTE (`> limiteInferiorMs +
// MARGEM_LIBERAR_APOS_LIMITE_MS`) — nunca por uma lista PARCIALMENTE
// indexada que só mostra a order MORTA de uma tentativa ANTERIOR (cenário
// Q3). Relógio REALISTA em todos os testes abaixo: a order da tentativa
// ANTERIOR nasce segundos ANTES do limite (é ela quem, ao morrer, causa a
// liberação que FIXA o limite); a order da tentativa ATUAL só pode nascer
// depois que o cliente reabre o formulário e digita o cartão de novo —
// nunca em menos de segundos. -----------------------------------------

Deno.test("resolverSentinela (B1, Q3): a order MORTA de uma tentativa ANTERIOR, criada ~1s ANTES do limite (relógio realista) -> NUNCA libera", () => {
  const limiteInferiorMs = AGORA_MS; // instante em que a vaga foi liberada para a tentativa atual (c1)
  const c0Morta = ordemMinima(
    "failed",
    "credit_card",
    "ORD-C0",
    new Date(limiteInferiorMs - 1_000).toISOString(), // c0: ~1s ANTES da liberação — o caso comum
  );
  // c1 (a tentativa atual) ainda não apareceu na busca — lista incompleta.
  assertEquals(resolverSentinela([c0Morta], limiteInferiorMs), null);
});

Deno.test("resolverSentinela (B1): a order MORTA da tentativa ATUAL, criada 60s DEPOIS do limite (retry humano plausível) -> libera normalmente", () => {
  const limiteInferiorMs = AGORA_MS;
  const c1Morta = ordemMinima(
    "failed",
    "credit_card",
    "ORD-C1",
    new Date(limiteInferiorMs + 60_000).toISOString(), // c1: 60s DEPOIS do limite — é da tentativa atual
  );
  assertEquals(resolverSentinela([c1Morta], limiteInferiorMs), { acao: "liberar" });
});

Deno.test("resolverSentinela (B1, BLOQUEIO 7ª rodada): a margem é PARA A FRENTE — uma order criada POUCO antes do limite (o caso comum, c0) NUNCA libera, mesmo dentro da folga de relógio", () => {
  const limiteInferiorMs = AGORA_MS;
  // Antes do BLOQUEIO, uma margem PARA TRÁS de 2 min incluía isto — o
  // próprio bug que a 7ª revisão mediu (R6-Q3): c0 nasce só ~1s antes.
  const poucoAntes = ordemMinima(
    "failed",
    "credit_card",
    "ORD-C0-1S-ANTES",
    new Date(limiteInferiorMs - 1_000).toISOString(),
  );
  assertEquals(resolverSentinela([poucoAntes], limiteInferiorMs), null);

  // Mesmo bem antes (3DS abandonado há minutos) — continua não liberando,
  // pela mesma regra (nunca foi o caso que quebrava; fica de controle).
  const bemAntes = ordemMinima(
    "failed",
    "credit_card",
    "ORD-C0-3MIN-ANTES",
    new Date(limiteInferiorMs - 3 * 60_000).toISOString(),
  );
  assertEquals(resolverSentinela([bemAntes], limiteInferiorMs), null);
});

Deno.test("resolverSentinela (B1): MARGEM_LIBERAR_APOS_LIMITE_MS — dentro da margem (logo depois do limite) NUNCA libera; passada a margem, libera", () => {
  const limiteInferiorMs = AGORA_MS;
  const dentroDaMargem = ordemMinima(
    "failed",
    "credit_card",
    "ORD-DENTRO-DA-MARGEM",
    new Date(limiteInferiorMs + MARGEM_LIBERAR_APOS_LIMITE_MS / 2).toISOString(),
  );
  assertEquals(resolverSentinela([dentroDaMargem], limiteInferiorMs), null);

  const passouAMargem = ordemMinima(
    "failed",
    "credit_card",
    "ORD-PASSOU-A-MARGEM",
    new Date(limiteInferiorMs + MARGEM_LIBERAR_APOS_LIMITE_MS + 1_000).toISOString(),
  );
  assertEquals(resolverSentinela([passouAMargem], limiteInferiorMs), { acao: "liberar" });
});

Deno.test("resolverSentinela (B1): limiteInferiorMs null (sentinela sem o sufixo novo) -> NUNCA libera, mesmo com todas mortas", () => {
  assertEquals(resolverSentinela([ordemMinima("failed")], null), null);
});

Deno.test("resolverSentinela (B1): order morta sem date_created/created_date legível não conta para a janela -> não libera sozinha", () => {
  const semData = ordemMinima("failed", "credit_card", "ORD-SEM-DATA", null);
  assertEquals(resolverSentinela([semData], AGORA_MS), null);
  const dataIlegivel = { ...ordemMinima("failed", "credit_card", "ORD-DATA-RUIM"), date_created: "não é data" };
  assertEquals(resolverSentinela([dataIlegivel], AGORA_MS), null);
  // created_date (grafia alternativa) também é aceita.
  const comCreatedDate = ordemMinima("failed", "credit_card", "ORD-CREATED-DATE", null);
  comCreatedDate.created_date = new Date(AGORA_MS + 60_000).toISOString();
  assertEquals(resolverSentinela([comCreatedDate], AGORA_MS), { acao: "liberar" });
});

// --- Troca PIX→cartão com resposta perdida (8ª rodada, achado #2; 9ª rodada,
// achado #3 — RESÍDUO DOCUMENTADO em AGENTS.md, "Fluxo do dinheiro") --------
// Cenário: o cliente troca PIX por cartão; o PIX é cancelado em T0 e a order
// de cartão nasce em T0+1s; a resposta da criação se perde (timeout/rede/5xx)
// e a vaga recebe o SENTINELA `verificando:<pedido>:c<n>:<T0>` — o limite
// inferior é gravado uma única vez, ≈ T0. A order ambígua nasce 1-2s DEPOIS
// do limite, portanto DENTRO da margem de 15s
// (`MARGEM_LIBERAR_APOS_LIMITE_MS`). A fronteira travada aqui:
//   morta + dentro da margem  -> presa até expires_at (resíduo aceito);
//   VIVA (ou processed)       -> adotada, MESMO dentro da margem;
//   morta + passada a margem  -> libera (20s, 60s; fronteira exata inclusa).

Deno.test("resolverSentinela (troca PIX→cartão, resposta perdida): a order ambígua MORRE de verdade (failed/canceled/expired) nascida ~1,5s depois do limite -> null — vaga presa até expires_at (RESÍDUO ACEITO pelo dono, AGENTS.md 8ª/9ª rodada)", () => {
  const limiteInferiorMs = AGORA_MS; // ≈ T0: o instante gravado no nascimento do sentinela
  // O sentinela nasce do formato real (`criar-pagamento/index.ts`): a leitura
  // de volta do limite é o que alimenta o segundo argumento abaixo.
  const sentinela = montarSentinela("3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b:c1", limiteInferiorMs);
  assertEquals(limiteInferiorDoSentinela(sentinela), limiteInferiorMs);
  for (const status of ["failed", "canceled", "expired"]) {
    const ambiguaMorta = ordemMinima(
      status,
      "credit_card",
      "ORD-C1-AMBIGUA",
      new Date(limiteInferiorMs + 1_500).toISOString(), // nasce 1,5s DEPOIS do limite — dentro da margem
    );
    // Mesmo morta DE VERDADE, uma order nascida dentro da margem nunca conta
    // para a janela de liberação (`criadaEm > limite + margem` é falso):
    // `resolverSentinela` devolve null — o chamador mantém o sentinela e a
    // vaga só libera por tempo em `expires_at` (~30-40 min): cliente fica sem
    // cartão E sem PIX até lá. Sem dinheiro em jogo (a vaga só afeta o
    // PRÓPRIO cliente) — resíduo aceito, não é buraco de cobrança dupla: o
    // lado seguro ("não libera") nunca cobra duas vezes.
    assertEquals(resolverSentinela([ambiguaMorta], limiteInferiorMs), null, status);
  }
});

Deno.test("resolverSentinela (9ª rodada, achado #3): enquanto a order ambígua segue VIVA (ou processed), ela é ADOTADA mesmo nascida dentro da margem -> gravar com o id — só a MORTE dela dentro da margem prende", () => {
  const limiteInferiorMs = AGORA_MS;
  for (const status of ["created", "processing", "action_required", "processed"]) {
    const ambigua = ordemMinima(
      status,
      "credit_card",
      "ORD-C1-AMBIGUA-VIVA",
      new Date(limiteInferiorMs + 1_000).toISOString(), // 1s depois do limite — dentro da margem de 15s
    );
    // A ADOÇÃO não olha data nenhuma: processed/viva -> gravar (o desfecho
    // fino fica com a reconsulta por id). Se este teste um dia falhar com
    // null, a troca PIX→cartão ficou PIOR que o documentado: nem a cobrança
    // viva seria rastreada pelo webhook.
    assertEquals(resolverSentinela([ambigua], limiteInferiorMs), { acao: "gravar", order: ambigua }, status);
  }
});

Deno.test("resolverSentinela (fronteira exata da troca PIX→cartão): order morta nascida a +20s do limite LIBERA; em limite+margem EM PONTO não libera (comparação estrita); 1ms depois disso libera", () => {
  const limiteInferiorMs = AGORA_MS;
  // Missão (b): morta MUITO depois do limite+15s (ex.: +20s) DEVE liberar.
  const vinteSegundos = ordemMinima(
    "failed",
    "credit_card",
    "ORD-20S-DEPOIS",
    new Date(limiteInferiorMs + 20_000).toISOString(),
  );
  assertEquals(resolverSentinela([vinteSegundos], limiteInferiorMs), { acao: "liberar" });
  // A comparação é ESTRITA (`>`): no ponto exato limite+margem ainda não.
  const noPonto = ordemMinima(
    "failed",
    "credit_card",
    "ORD-NO-PONTO-DA-MARGEM",
    new Date(limiteInferiorMs + MARGEM_LIBERAR_APOS_LIMITE_MS).toISOString(),
  );
  assertEquals(resolverSentinela([noPonto], limiteInferiorMs), null);
  const umMsDepoisDoPonto = ordemMinima(
    "failed",
    "credit_card",
    "ORD-1MS-APOS-A-MARGEM",
    new Date(limiteInferiorMs + MARGEM_LIBERAR_APOS_LIMITE_MS + 1).toISOString(),
  );
  assertEquals(resolverSentinela([umMsDepoisDoPonto], limiteInferiorMs), { acao: "liberar" });
});

Deno.test("troca PIX→cartão (B2 x B1, corpo em 'data'): order de OUTRO pedido NUNCA adota nem libera — o refiltro por external_reference no cliente roda ANTES do resolverSentinela", async () => {
  const limiteInferiorMs = AGORA_MS;
  // Se o MP ignorar o filtro da query, a busca devolveria também orders de
  // outro pedido: uma APROVADA e uma MORTA nascida FORA da margem. O refiltro
  // do cliente (`buscarOrdersDoPedido`) tira as duas ANTES do resolver.
  const deOutroAprovada = {
    id: "ORD-OUTRO-APROVADA",
    status: "processed",
    external_reference: "pedido-OUTRO",
    date_created: new Date(limiteInferiorMs + 60_000).toISOString(),
    transactions: { payments: [{ id: "PAY-OUTRO", payment_method: { id: "x", type: "credit_card" } }] },
  };
  const deOutroMortaForaDaMargem = {
    id: "ORD-OUTRO-MORTA",
    status: "failed",
    external_reference: "pedido-OUTRO",
    date_created: new Date(limiteInferiorMs + 60_000).toISOString(),
    transactions: { payments: [{ id: "PAY-OUTRO2", payment_method: { id: "x", type: "credit_card" } }] },
  };
  const minhaAmbiguaMortaDentroDaMargem = {
    id: "ORD-C1-AMBIGUA",
    status: "failed",
    external_reference: "pedido-MEU",
    date_created: new Date(limiteInferiorMs + 1_500).toISOString(),
    transactions: { payments: [{ id: "PAY-MEU", payment_method: { id: "x", type: "credit_card" } }] },
  };
  const fetchStub = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ data: [deOutroAprovada, deOutroMortaForaDaMargem, minhaAmbiguaMortaDentroDaMargem] }),
        { status: 200 },
      ),
    )) as unknown as typeof fetch;
  const busca = await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "pedido-MEU",
    desde: new Date(limiteInferiorMs).toISOString(),
    fetchImpl: fetchStub,
  });
  assertEquals(busca, { ok: true, orders: [minhaAmbiguaMortaDentroDaMargem] });
  // Nem a APROVADA de outro pedido é adotada, nem a MORTA de outro pedido
  // (fora da margem) libera: sobra só a ambígua DESTE pedido, morta dentro da
  // margem -> null (presa até expires_at — o resíduo documentado, não desvio).
  assertEquals(resolverSentinela(busca.ok ? busca.orders : [], limiteInferiorMs), null);
});

// --- montarSentinela / limiteInferiorDoSentinela: o formato NOVO do
// sentinela (B1, 5ª revisão de risco, 26/09/2026) --------------------------

Deno.test("montarSentinela/limiteInferiorDoSentinela: grava e lê de volta o MESMO limite inferior; o prefixo/chave continuam intactos", () => {
  const sentinela = montarSentinela("3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b:c1", 1758891234567);
  assertEquals(sentinela, "verificando:3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b:c1:1758891234567");
  assertEquals(limiteInferiorDoSentinela(sentinela), 1758891234567);
});

Deno.test("limiteInferiorDoSentinela: não-sentinela, sentinela no formato ANTIGO (sem o sufixo) e sufixo ilegível -> null (fail-closed, nunca um palpite)", () => {
  assertEquals(limiteInferiorDoSentinela(null), null);
  assertEquals(limiteInferiorDoSentinela(undefined), null);
  assertEquals(limiteInferiorDoSentinela("ORDTST0000000000000000001"), null);
  // Formato pré-B1 — pode existir em produção quando isto ligar.
  assertEquals(limiteInferiorDoSentinela("verificando:3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b:c0"), null);
  assertEquals(limiteInferiorDoSentinela("verificando:3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b:c0:lixo"), null);
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

Deno.test("criarOrder com corpoNoLog:false loga QUAL campo o MP recusou no 400, com o valor mascarado", async () => {
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
              errors: [{
                code: "property_value",
                message: "invalid value for cliente@exemplo.com",
                details: [
                  "payer.phone.number must match pattern, got '987654321'",
                  "invalid value Rua Secreta is invalid for shipment.address.street_name",
                  "payer.first_name Maria Aparecida contains invalid characters",
                  "The property 'items[0].unit_price' has an invalid value '1'",
                  `payer.identification.number ${CPF_TESTE} is invalid`,
                  `transactions.payments[0].payment_method.token ${TOKEN_CARTAO} is invalid`,
                ],
              }],
            }),
            { status: 400 },
          ),
        )) as unknown as typeof fetch,
      corpoNoLog: false,
    });
  } finally {
    console.error = consoleErrorReal;
  }
  const texto = JSON.stringify(logados);
  assertStringIncludes(texto, "property_value");
  assertStringIncludes(texto, "payer.phone.number");
  assertStringIncludes(texto, "shipment.address.street_name");
  assertStringIncludes(texto, "payer.first_name");
  assertStringIncludes(texto, "items[0].unit_price");
  assertStringIncludes(texto, "transactions.payments[0].payment_method.token");
  assertEquals(texto.includes("987654321"), false);
  assertEquals(texto.includes("Rua Secreta"), false);
  assertEquals(texto.includes("Maria"), false);
  assertEquals(texto.includes(CPF_TESTE), false);
  assertEquals(texto.includes(TOKEN_CARTAO), false);
  assertEquals(texto.includes("cliente@exemplo.com"), false);
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

// ─── Device ID do comprador (antifraude do Mercado Pago, 03/10/2026) ─────────
//
// Um cartão real foi recusado com `high_risk` porque o antifraude não recebia
// o Device ID. A Orders API pede o valor no cabeçalho `X-meli-session-id` do
// POST /v1/orders. O valor vem do navegador do cliente (`window.
// MP_DEVICE_SESSION_ID`, criado pelo security.js do MP): é ENTRADA NÃO
// CONFIÁVEL que vira cabeçalho HTTP — formato fechado, nunca "o que veio".

const DEVICE_ID_REAL = "armor.8c1f0e2b9d7a4c35b6e1f0a9d8c7b6a5.XyZ123abc.9f8e7d6c5b4a";

Deno.test("deviceIdValido: aceita o formato do security.js (letras, dígitos, ponto, hífen, sublinhado)", () => {
  for (const bom of [DEVICE_ID_REAL, "a", "abc-DEF_123.xyz", "x".repeat(512)]) {
    assertEquals(deviceIdValido(bom), true, bom.slice(0, 20));
  }
});

Deno.test("deviceIdValido: recusa o que não é string, vazio, grande demais e qualquer caractere fora do formato", () => {
  const ruins: unknown[] = [
    undefined,
    null,
    42,
    {},
    [],
    "",
    "x".repeat(513),
    " abc",
    "abc def",
    "abc\r\nX-Evil: 1",
    "abc\n",
    "abc:def",
    "abc/def",
    "abç",
    "<script>",
  ];
  for (const ruim of ruins) {
    assertEquals(deviceIdValido(ruim), false, JSON.stringify(ruim));
  }
});

function fetchQueCaptura() {
  const capturadas: Array<{ url: string; init: RequestInit }> = [];
  const fn = ((url: string, init: RequestInit) => {
    capturadas.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify({ id: "ORDTST01DEVICE", status: "processed", status_detail: "accredited" }), {
        status: 201,
      }),
    );
  }) as unknown as typeof fetch;
  return { fn, capturadas };
}

Deno.test("criarOrder com deviceId válido manda X-meli-session-id além da chave de idempotência", async () => {
  const { fn, capturadas } = fetchQueCaptura();
  const r = await criarOrder({
    token: "token-de-teste",
    corpo: { total_amount: "50.00" },
    chaveIdempotencia: "k-1",
    fetchImpl: fn,
    deviceId: DEVICE_ID_REAL,
  });
  assertEquals(r.ok, true);
  const headers = capturadas[0].init.headers as Record<string, string>;
  assertEquals(headers["X-meli-session-id"], DEVICE_ID_REAL);
  // O que já existia não muda: o cabeçalho novo só se soma.
  assertEquals(headers["X-Idempotency-Key"], "k-1");
  assertEquals(headers.Authorization, ["Bearer", "token-de-teste"].join(" "));
  assertEquals(headers["Content-Type"], "application/json");
});

Deno.test("criarOrder sem deviceId (PIX, ou cliente sem o valor) NÃO manda o cabeçalho — nem vazio", async () => {
  const { fn, capturadas } = fetchQueCaptura();
  await criarOrder({ token: "t", corpo: {}, chaveIdempotencia: "k-2", fetchImpl: fn });
  const headers = capturadas[0].init.headers as Record<string, string>;
  assertEquals("X-meli-session-id" in headers, false);
  assertEquals(Object.keys(headers).sort(), ["Authorization", "Content-Type", "X-Idempotency-Key"]);
});

Deno.test("criarOrder com deviceId INVÁLIDO ignora em vez de mandar (defesa em profundidade contra cabeçalho forjado) e a cobrança segue", async () => {
  for (const ruim of ["", "abc\r\nX-Evil: 1", "com espaço", "x".repeat(513)]) {
    const { fn, capturadas } = fetchQueCaptura();
    const r = await criarOrder({ token: "t", corpo: {}, chaveIdempotencia: "k-3", fetchImpl: fn, deviceId: ruim });
    assertEquals(r.ok, true);
    const headers = capturadas[0].init.headers as Record<string, string>;
    assertEquals("X-meli-session-id" in headers, false, JSON.stringify(ruim));
    assertEquals(Object.keys(headers).includes("X-Evil"), false);
  }
});

Deno.test("dividirNomeDoPagador: primeiro nome vira first_name e o RESTO vira last_name; nome único não inventa sobrenome", () => {
  assertEquals(dividirNomeDoPagador("Maria da Silva Souza"), { first_name: "Maria", last_name: "da Silva Souza" });
  assertEquals(dividirNomeDoPagador("  João   Pereira "), { first_name: "João", last_name: "Pereira" });
  assertEquals(dividirNomeDoPagador("Maria"), { first_name: "Maria" });
  assertEquals(dividirNomeDoPagador("APRO"), { first_name: "APRO" });
  assertEquals(dividirNomeDoPagador("Ana-Clara D'Ávila Jr."), { first_name: "Ana-Clara", last_name: "D'Ávila Jr." });
});

Deno.test("dividirNomeDoPagador: ausente, vazio ou com cara de lixo (dígito, símbolo, e-mail, comprido demais) NÃO manda nome nenhum", () => {
  for (const ruim of [undefined, null, 42, "", "   ", "Maria 2", "maria@exemplo.com", "<b>Maria</b>", "Maria\nSilva", "x".repeat(101)]) {
    assertEquals(dividirNomeDoPagador(ruim), {}, JSON.stringify(ruim));
  }
});

Deno.test("montarCorpoCartaoOrders com nome completo manda first_name e last_name — e nada além disso no payer", () => {
  const corpo = montarCorpoCartaoOrders(argsCartao({ nome: "Maria da Silva" }));
  assertEquals(corpo.payer, {
    email: "cliente@exemplo.com",
    first_name: "Maria",
    last_name: "da Silva",
    identification: { type: "CPF", number: CPF_TESTE },
  });
  // Nada de items, telefone, endereço nem additional_info nesta entrega.
  for (const campo of ["items", "additional_info", "phone", "address"]) {
    assertEquals(campo in corpo, false, campo);
    assertEquals(campo in (corpo.payer as Record<string, unknown>), false, campo);
  }
});

Deno.test("montarCorpoCartaoOrders com nome imprestável não manda nome e NÃO lança — o nome nunca bloqueia a cobrança", () => {
  const corpo = montarCorpoCartaoOrders(argsCartao({ nome: "Maria 2" }));
  assertEquals("first_name" in (corpo.payer as Record<string, unknown>), false);
  assertEquals("last_name" in (corpo.payer as Record<string, unknown>), false);
});

// ─── Dados do comprador e do produto no cartão (03/10/2026) ──────────────────
//
// O antifraude do MP recusou duas compras reais de teste vendo a venda como
// "Produto sem nome". `comprador` (opcional) leva itens, telefone e endereço.
// O que erra caro e se prova aqui: a soma dos itens NUNCA diverge do total, o
// lixo NUNCA vira campo torto nem lança, e SEM `comprador` o corpo é o de sempre.

const COMPRADOR_COMPLETO = {
  items: [
    { title: "Camiseta Azul", unit_price: "49.90", quantity: 2, description: "Camiseta Azul", external_code: "prod-1" },
    { title: "Frete", unit_price: "50.10", quantity: 1, description: "Frete" },
  ],
  phone: { area_code: "11", number: "987654321" },
  address: {
    zip_code: "06233903",
    street_name: "Rua Teste",
    street_number: "3003",
    neighborhood: "Bonfim",
    city: "Osasco",
    state: "SP",
    complement: "Apto 303",
  },
  shipmentAddress: {
    zip_code: "06233903",
    street_name: "Rua Teste",
    street_number: "3003",
    neighborhood: "Bonfim",
    city: "Osasco",
    state: "SP",
    complement: "Apto 303",
  },
};

Deno.test("montarCorpoCartaoOrders com comprador: manda items, payer.phone, payer.address e shipment.address no formato da doc — e o resto do corpo intacto", () => {
  const base = montarCorpoCartaoOrders(argsCartao({ valor: 149.9 }));
  const corpo = montarCorpoCartaoOrders(argsCartao({ valor: 149.9, comprador: COMPRADOR_COMPLETO }));

  // `external_code` que chegue no comprador NAO atravessa: o MP recusou o UUID
  // do produto com 400 property_value em compra real (03/10/2026).
  assertEquals(corpo.items, COMPRADOR_COMPLETO.items.map(({ external_code: _e, ...resto }) => resto));
  assertEquals(corpo.shipment, { address: COMPRADOR_COMPLETO.shipmentAddress });
  const payer = corpo.payer as Record<string, unknown>;
  assertEquals(payer.phone, { area_code: "11", number: "987654321" });
  assertEquals(payer.address, COMPRADOR_COMPLETO.address);
  // Tudo que ja existia segue igual: o comprador SO soma.
  const { items: _i, shipment: _s, payer: payerComDados, ...restoCom } = corpo;
  const { payer: payerBase, ...restoBase } = base;
  assertEquals(restoCom, restoBase);
  const { phone: _p, address: _a, ...payerSemExtras } = payerComDados as Record<string, unknown>;
  assertEquals(payerSemExtras, payerBase);
  // Nenhum campo fora do esquema de create-order.
  assertEquals("additional_info" in corpo, false);
});

Deno.test("montarCorpoCartaoOrders: SOMA DOS ITENS DIVERGENTE do total -> items NAO vai (um 400 derrubaria todo cartao), o resto vai", () => {
  // 149.90 de itens contra 100.00 de total (pedido com desconto, por exemplo).
  const corpo = montarCorpoCartaoOrders(argsCartao({ valor: 100, comprador: COMPRADOR_COMPLETO }));
  assertEquals("items" in corpo, false);
  assertEquals((corpo.payer as Record<string, unknown>).phone, { area_code: "11", number: "987654321" });
  assertEquals(corpo.shipment, { address: COMPRADOR_COMPLETO.shipmentAddress });
  // Um centavo de diferenca tambem derruba.
  assertEquals("items" in montarCorpoCartaoOrders(argsCartao({ valor: 149.91, comprador: COMPRADOR_COMPLETO })), false);
  assertEquals("items" in montarCorpoCartaoOrders(argsCartao({ valor: 149.89, comprador: COMPRADOR_COMPLETO })), false);
});

Deno.test("montarCorpoCartaoOrders: o total arredondado (10.005 -> duas casas) e' o que a soma compara", () => {
  const comprador = { items: [{ title: "A", unit_price: "10.01", quantity: 1, description: "A" }] };
  assertEquals("items" in montarCorpoCartaoOrders(argsCartao({ valor: 10.005 + 0.001, comprador })), true);
});

Deno.test("montarCorpoCartaoOrders: comprador ausente, vazio ou LIXO devolve o corpo de sempre — sem lancar", () => {
  const base = montarCorpoCartaoOrders(argsCartao());
  for (
    const comprador of [
      undefined,
      null,
      {},
      "texto",
      42,
      [],
      { items: "x", phone: 1, address: [], shipmentAddress: null },
      { items: [{}], phone: { area_code: "99" }, address: { zip_code: "abc" } },
    ]
  ) {
    assertEquals(montarCorpoCartaoOrders(argsCartao({ comprador })), base, JSON.stringify(comprador));
  }
});

Deno.test("montarCorpoCartaoOrders: comprador com chave estranha (cpf) nao atravessa para o corpo", () => {
  const corpo = montarCorpoCartaoOrders(
    argsCartao({
      valor: 149.9,
      comprador: {
        ...COMPRADOR_COMPLETO,
        phone: { area_code: "11", number: "987654321", cpf: "99999999999" },
        cpf: "99999999999",
      },
    }),
  );
  assertEquals(JSON.stringify(corpo).includes("99999999999"), false);
});

Deno.test("montarCorpoPixOrders: o PIX NAO ganha items, shipment, phone nem address — o escopo e' so o cartao", () => {
  const corpo = montarCorpoPixOrders({
    valor: 149.9,
    email: "cliente@exemplo.com",
    orderId: PEDIDO_CARTAO,
    expiracao: "PT30M",
    comprador: COMPRADOR_COMPLETO,
  } as never);
  for (const campo of ["items", "shipment", "additional_info"]) {
    assertEquals(campo in corpo, false, campo);
  }
  for (const campo of ["phone", "address"]) {
    assertEquals(campo in (corpo.payer as Record<string, unknown>), false, campo);
  }
});

// ─── Nome na fatura do cartão (03/10/2026) ──────────────────────────────────

const PARAMS_CARTAO_FATURA = {
  orderId: "11111111-2222-4333-8444-555555555555",
  valor: 100,
  email: "comprador.falso@exemplo.test",
  documento: { type: "CPF", number: "12345678909" },
  token: "ff8080814c11e237014c1ff593b57b4d",
  paymentMethodId: "master",
  paymentTypeId: "credit_card",
  parcelas: 2,
};

function metodoDoPagamento(corpo: Record<string, unknown>): Record<string, unknown> {
  return (corpo.transactions as { payments: Array<{ payment_method: Record<string, unknown> }> }).payments[0]
    .payment_method;
}

Deno.test("montarCorpoCartaoOrders: nomeNaFatura vai em transactions.payments[0].payment_method.statement_descriptor, normalizado", () => {
  const corpo = montarCorpoCartaoOrders({ ...PARAMS_CARTAO_FATURA, nomeNaFatura: "Açaí do Zé" });
  assertEquals(metodoDoPagamento(corpo).statement_descriptor, "ACAI DO ZE");
});

Deno.test("montarCorpoCartaoOrders: nome longo e' CORTADO em 13 caracteres, sem espaco no fim", () => {
  const corpo = montarCorpoCartaoOrders({ ...PARAMS_CARTAO_FATURA, nomeNaFatura: "Loja Muito Grande Mesmo" });
  assertEquals(metodoDoPagamento(corpo).statement_descriptor, "LOJA MUITO GR");
});

Deno.test("montarCorpoCartaoOrders: nome vazio, so' simbolo ou ausente NAO manda a chave", () => {
  for (const nome of [undefined, null, "", "   ", "★★", 7]) {
    const corpo = montarCorpoCartaoOrders({ ...PARAMS_CARTAO_FATURA, nomeNaFatura: nome });
    assertEquals("statement_descriptor" in metodoDoPagamento(corpo), false, String(nome));
  }
});

Deno.test("montarCorpoCartaoOrders: o nome na fatura NAO altera mais nada do corpo (so' acrescenta a chave)", () => {
  const sem = montarCorpoCartaoOrders(PARAMS_CARTAO_FATURA);
  const com = montarCorpoCartaoOrders({ ...PARAMS_CARTAO_FATURA, nomeNaFatura: "Loja Teste" });
  delete metodoDoPagamento(com).statement_descriptor;
  assertEquals(com, sem);
});

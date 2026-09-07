import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  confirmarPorConsulta,
  executarEstorno,
  guardaAntesDeChamar,
  interpretarResposta,
  montarRequisicao,
  type LinhaEstorno,
  type PedidoParaEstorno,
} from "./estorno.ts";

/**
 * Suíte da Task 2 da frente "estorno pelo app" (plano
 * 20260907-plano-estorno-pelo-app.md): E1–E27 — E1–E20, um por afirmativa do
 * plano; E21–E25 do conserto da reprovação Opus do PR #438 (laudo
 * 20260907-laudo-opus-pr438-t2-executor-do-estorno.md): fórmula acumulada,
 * credencial 401/403, "não sei" na confirmação, chave+corpo do POST e 2xx
 * desconhecido; E21 (rodada 2) e E26–E27 da alternativa B do I-A e do M-A
 * (laudo 20260907-laudo-opus-pr438-t2-executor-do-estorno-rodada2.md): o
 * caminho direto de `confirmarPorConsulta` (sem `codigo`) vira tentar_depois
 * em vez de falhou, e `refundIdDaConsulta` desempata por `date_created` e
 * nunca devolve o id do pagamento.
 *
 * NENHUMA chamada real ao Mercado Pago acontece aqui: todo `fetch` é dublê
 * (rota por método+trecho de URL) e a consulta da transação da order é uma
 * função falsa. Os corpos são os da tabela de interpretação do plano —
 * Payments clássica (`cause[].code` numérico) e Orders API
 * (`error_messages[].code` nomeado).
 *
 * E1–E4: guarda e montagem (funções puras, sem dublê).
 * E5–E18: uma por linha da tabela de interpretação; as linhas que a tabela
 * manda CONSULTAR (4296, order_already_refunded, idempotency_key_already_used)
 * só produzem o resultado final passando pelo `executarEstorno` com o GET de
 * confirmação dublado — é ele quem move o I/O.
 * E19–E20: o contrato do executor (nunca lança; não gasta chamada quando a
 * guarda recusa).
 * E21–E25: correções do laudo (fórmula acumulada × incremental, 401/403 →
 * tentar_depois, campo ausente na consulta → tentar_depois, asserções de
 * chave e corpo do POST, 2xx desconhecido → tentar_depois).
 */

const AGORA = new Date("2026-09-07T12:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;
const TOKEN = "TESTE_TOKEN";

function linhaCom(extras: Partial<LinhaEstorno> = {}): LinhaEstorno {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    order_id: "22222222-2222-4222-8222-222222222222",
    amount: 100,
    status: "solicitado",
    mp_refund_id: null,
    tentativas: 0,
    ...extras,
  };
}

function pedidoPagoCom(extras: Partial<PedidoParaEstorno> = {}): PedidoParaEstorno {
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

function pedidoOrder(extras: Partial<PedidoParaEstorno> = {}): PedidoParaEstorno {
  // I6 do laudo: esta função aceita extras DE VERDADE — `pedidoOrder({ total:
  // 100 })` no E20 era argumento descartado numa função de zero parâmetros, e
  // o E20 passava por coincidência (o pedido default, de total 100, também
  // recusava o amount 150).
  return pedidoPagoCom({
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    ...extras,
  });
}

function erroPayments(code: number): Record<string, unknown> {
  return { message: "erro", error: "bad_request", cause: [{ code }] };
}

function erroOrders(code: string): Record<string, unknown> {
  return { error: "invalid_request", error_messages: [{ code }] };
}

type RotaDuble = {
  metodo: string;
  trecho: string;
  status: number;
  corpo?: unknown;
  headers?: Record<string, string>;
};

function fetchDuble(rotas: RotaDuble[]) {
  // I4/I5 do laudo: o dublê também captura o CORPO do POST — sem isso, a
  // mutação que manda `{"transactions":[{"id":""}]}` sobrevive (M2 do laudo).
  const chamadas: { url: string; metodo: string; chave?: string; corpo?: string }[] = [];
  // Sem `async` de propósito: a função não espera nada (é tudo síncrono) e o
  // `require-await` do deno lint reprova async sem await — o dublê devolve a
  // Promise já resolvida.
  const f: typeof fetch = (entrada, init) => {
    const url = typeof entrada === "string"
      ? entrada
      : String(entrada instanceof URL ? entrada.href : entrada.url);
    const metodo = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({
      url,
      metodo,
      chave: headers["X-Idempotency-Key"],
      corpo: typeof init?.body === "string" ? init.body : undefined,
    });
    const rota = rotas.find((r) => r.metodo === metodo && url.includes(r.trecho));
    return Promise.resolve(
      !rota
        ? new Response("", { status: 500 })
        : new Response(
          rota.corpo === undefined ? "" : JSON.stringify(rota.corpo),
          { status: rota.status, headers: rota.headers ?? {} },
        ),
    );
  };
  return { f, chamadas };
}

const consultaTransacaoFalsa = (_orderId: string): Promise<string | null> =>
  Promise.resolve("PAY01XYZEXEMPLODETRANSA1");

// ---------------------------------------------------------------------------
// E1–E4 — guarda e montagem
// ---------------------------------------------------------------------------

Deno.test("E1 - guarda dos 180 dias: 181 recusa, 179 aceita; pago_apos_expirar e' dinheiro valido; sem paid_at recusa", () => {
  const ha181 = new Date(AGORA.getTime() - 181 * DIA_MS).toISOString();
  assertEquals(
    guardaAntesDeChamar(linhaCom(), pedidoPagoCom({ paid_at: ha181 }), AGORA).ok,
    false,
  );
  const ha179 = new Date(AGORA.getTime() - 179 * DIA_MS).toISOString();
  assertEquals(
    guardaAntesDeChamar(linhaCom(), pedidoPagoCom({ paid_at: ha179 }), AGORA).ok,
    true,
  );
  // Pago tarde e' dinheiro do mesmo jeito (a RPC da T1 aceita os dois; a
  // guarda nao pode criar linha que o executor recusaria para sempre).
  assertEquals(
    guardaAntesDeChamar(
      linhaCom(),
      pedidoPagoCom({ payment_status: "pago_apos_expirar" }),
      AGORA,
    ).ok,
    true,
  );
  // Sem carimbo de pagamento nao ha prazo a calcular: recusa com motivo claro.
  const semData = guardaAntesDeChamar(
    linhaCom(),
    pedidoPagoCom({ paid_at: null }),
    AGORA,
  ) as { ok: false; motivo: string };
  assertEquals(semData.ok, false);
  assertStringIncludes(semData.motivo, "data de pagamento");
});

Deno.test("E2 - guarda do saldo: amount acima do disponivel recusa, igual ao saldo aceita", () => {
  const acima = guardaAntesDeChamar(
    linhaCom({ amount: 120 }),
    pedidoPagoCom({ total: 100 }),
    AGORA,
  ) as { ok: false; motivo: string };
  assertEquals(acima.ok, false);
  assertStringIncludes(acima.motivo, "dispon");
  // Saldo = total - valor_estornado: 100 - 30 = 70.
  assertEquals(
    guardaAntesDeChamar(
      linhaCom({ amount: 80 }),
      pedidoPagoCom({ total: 100, valor_estornado: 30 }),
      AGORA,
    ).ok,
    false,
  );
  assertEquals(
    guardaAntesDeChamar(
      linhaCom({ amount: 70 }),
      pedidoPagoCom({ total: 100, valor_estornado: 30 }),
      AGORA,
    ).ok,
    true,
  );
  // C1 do laudo: o restante EXATO não pode ser recusado por aritmética de
  // float — R$50 − R$4,23 = 45,769999… em float cru, e o executor recusava
  // o 45,77 que a RPC (numeric, exata) tinha acabado de aceitar.
  assertEquals(
    guardaAntesDeChamar(
      linhaCom({ amount: 45.77 }),
      pedidoPagoCom({ total: 50, valor_estornado: 4.23 }),
      AGORA,
    ).ok,
    true,
  );
  assertEquals(
    guardaAntesDeChamar(
      linhaCom({ amount: 45.78 }),
      pedidoPagoCom({ total: 50, valor_estornado: 4.23 }),
      AGORA,
    ).ok,
    false,
  );
});

Deno.test("E3 - montar: id numerico vai para a Payments classica, com chave de idempotencia da linha e header de contingencia PIX", () => {
  const linha = linhaCom();
  const pedido = pedidoPagoCom({ gateway_payment_id: "123456789" });

  const total = montarRequisicao(linha, pedido);
  assertStringIncludes(total.url, "/v1/payments/123456789/refunds");
  assertEquals(total.body, {});
  assertEquals(total.headers["X-Idempotency-Key"], linha.id);
  assertEquals(total.headers["X-Render-In-Process-Refunds"], "true");

  const parcial = montarRequisicao(linhaCom({ amount: 10 }), pedido);
  assertStringIncludes(parcial.url, "/v1/payments/123456789/refunds");
  assertEquals(parcial.body, { amount: 10 });
});

Deno.test("E4 - montar: id de order vai para a Orders API com a transacao; parcial como string de 2 casas", () => {
  const pedido = pedidoOrder();

  const total = montarRequisicao(linhaCom(), pedido, "PAY01XYZEXEMPLODETRANSA1");
  assertStringIncludes(total.url, "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund");
  assertEquals(total.body, { transactions: [{ id: "PAY01XYZEXEMPLODETRANSA1" }] });
  assertEquals(total.headers["X-Idempotency-Key"], linhaCom().id);

  const parcial = montarRequisicao(
    linhaCom({ amount: 10 }),
    pedido,
    "PAY01XYZEXEMPLODETRANSA1",
  );
  assertEquals(parcial.body, {
    transactions: [{ id: "PAY01XYZEXEMPLODETRANSA1", amount: "10.00" }],
  });
});

// ---------------------------------------------------------------------------
// E5–E12 — tabela de interpretacao: Payments classica
// ---------------------------------------------------------------------------

Deno.test("E5 - Payments 201 approved -> concluido com refund id, status e valor", () => {
  assertEquals(
    interpretarResposta(
      201,
      { id: 111, payment_id: 123456789, amount: 100, status: "approved" },
      linhaCom(),
      pedidoPagoCom(),
    ),
    {
      tipo: "concluido",
      mp_refund_id: "111",
      mp_status: "approved",
      mp_status_detail: null,
      valor: 100,
    },
  );
});

Deno.test("E6 - Payments 201 in_process -> em_processamento", () => {
  assertEquals(
    interpretarResposta(
      201,
      { id: 222, payment_id: 123456789, amount: 100, status: "in_process" },
      linhaCom(),
      pedidoPagoCom(),
    ),
    { tipo: "em_processamento", mp_refund_id: "222", mp_status: "in_process" },
  );
});

Deno.test("E7 - Payments 400 code 2063 -> falhou definitiva: estado nao permite devolucao", () => {
  assertEquals(
    interpretarResposta(400, erroPayments(2063), linhaCom(), pedidoPagoCom()),
    {
      tipo: "falhou",
      motivo: "pagamento não está em estado que permita devolução",
      codigo: "2063",
    },
  );
});

Deno.test("E8 - Payments 400 code 4040/4041 -> falhou definitiva: valor invalido", () => {
  assertEquals(
    interpretarResposta(400, erroPayments(4040), linhaCom(), pedidoPagoCom()),
    { tipo: "falhou", motivo: "valor inválido", codigo: "4040" },
  );
  assertEquals(
    interpretarResposta(400, erroPayments(4041), linhaCom(), pedidoPagoCom()),
    { tipo: "falhou", motivo: "valor inválido", codigo: "4041" },
  );
});

Deno.test("E9 - Payments 404 code 2024/15016 -> falhou definitiva: mais de 180 dias", () => {
  assertEquals(
    interpretarResposta(404, erroPayments(2024), linhaCom(), pedidoPagoCom()),
    {
      tipo: "falhou",
      motivo: "pagamento com mais de 180 dias não pode mais ser devolvido",
      codigo: "2024",
    },
  );
  assertEquals(
    interpretarResposta(404, erroPayments(15016), linhaCom(), pedidoPagoCom()),
    {
      tipo: "falhou",
      motivo: "pagamento com mais de 180 dias não pode mais ser devolvido",
      codigo: "15016",
    },
  );
});

Deno.test("E10 - Payments 404 code 3024 -> falhou definitiva: so devolucao total", () => {
  assertEquals(
    interpretarResposta(404, erroPayments(3024), linhaCom(), pedidoPagoCom()),
    {
      tipo: "falhou",
      motivo: "este pagamento só aceita devolução total",
      codigo: "3024",
    },
  );
});

Deno.test("E11 - Payments 404 code 4296 -> consulta o payment: coberto conclui, descoberto falha", async () => {
  const linha = linhaCom();
  const pedido = pedidoPagoCom();

  const coberto = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/payments/123456789/refunds",
      status: 404,
      corpo: erroPayments(4296),
    },
    {
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: {
        id: 123456789,
        status: "approved",
        transaction_amount_refunded: 100,
        refunds: [{ id: 555, amount: 100 }],
      },
    },
  ]);
  assertEquals(
    await executarEstorno({ linha, pedido, token: TOKEN, buscar: coberto.f }),
    {
      tipo: "concluido",
      mp_refund_id: "555",
      mp_status: "approved",
      mp_status_detail: null,
      valor: 100,
    },
  );

  const descoberto = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/payments/123456789/refunds",
      status: 404,
      corpo: erroPayments(4296),
    },
    {
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: { id: 123456789, status: "approved", transaction_amount_refunded: 30 },
    },
  ]);
  const ruim = await executarEstorno({
    linha,
    pedido,
    token: TOKEN,
    buscar: descoberto.f,
  });
  assertEquals(ruim.tipo, "falhou");
  assertStringIncludes((ruim as { motivo: string }).motivo, "não cobre");
});

Deno.test("E12 - Payments 404 code 2000 -> falhou definitiva: pagamento nao encontrado no MP", () => {
  assertEquals(
    interpretarResposta(404, erroPayments(2000), linhaCom(), pedidoPagoCom()),
    {
      tipo: "falhou",
      motivo: "pagamento não encontrado no Mercado Pago",
      codigo: "2000",
    },
  );
});

// ---------------------------------------------------------------------------
// E13–E18 — tabela de interpretacao: retry, rede e Orders API
// ---------------------------------------------------------------------------

Deno.test("E13 - Payments 429 com Retry-After -> tentar_depois com retryAfterS; 5xx -> tentar_depois", async () => {
  const ocupado = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/payments/123456789/refunds",
      status: 429,
      corpo: { message: "too many requests" },
      headers: { "Retry-After": "30" },
    },
  ]);
  const r429 = await executarEstorno({
    linha: linhaCom(),
    pedido: pedidoPagoCom(),
    token: TOKEN,
    buscar: ocupado.f,
  });
  assertEquals(r429.tipo, "tentar_depois");
  assertEquals((r429 as { retryAfterS?: number }).retryAfterS, 30);

  const instavel = fetchDuble([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 502 },
  ]);
  const r5xx = await executarEstorno({
    linha: linhaCom(),
    pedido: pedidoPagoCom(),
    token: TOKEN,
    buscar: instavel.f,
  });
  assertEquals(r5xx.tipo, "tentar_depois");
});

Deno.test("E14 - Orders 201 refunded (ou processed+partially_refunded) -> concluido", () => {
  assertEquals(
    interpretarResposta(
      201,
      { id: "ORD01ABCDEFOLUIMWQKDXYZ01", status: "refunded", status_detail: "refunded" },
      linhaCom(),
      pedidoOrder(),
    ),
    {
      tipo: "concluido",
      mp_refund_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
      mp_status: "refunded",
      mp_status_detail: "refunded",
      valor: 100,
    },
  );
  assertEquals(
    interpretarResposta(
      201,
      { id: "ORD01ABCDEFOLUIMWQKDXYZ01", status: "processed", status_detail: "partially_refunded" },
      linhaCom({ amount: 30 }),
      pedidoOrder(),
    ).tipo,
    "concluido",
  );
});

Deno.test("E15 - Orders order_refund_already_in_process -> em_processamento", () => {
  assertEquals(
    interpretarResposta(409, erroOrders("order_refund_already_in_process"), linhaCom(), pedidoOrder()),
    {
      tipo: "em_processamento",
      mp_refund_id: null,
      mp_status: "order_refund_already_in_process",
    },
  );
});

Deno.test("E16 - Orders order_already_refunded -> consulta a order: soma cobre conclui, nao cobre falha", async () => {
  const linha = linhaCom();
  const pedido = pedidoOrder();
  const postJaRefunded = {
    metodo: "POST",
    trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
    status: 409,
    corpo: erroOrders("order_already_refunded"),
  };

  const coberto = fetchDuble([
    postJaRefunded,
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        status: "refunded",
        transactions: [{ refunds: [{ id: "REEMB1", amount: "100.00" }] }],
      },
    },
  ]);
  assertEquals(
    await executarEstorno({
      linha,
      pedido,
      token: TOKEN,
      buscar: coberto.f,
      consultarTransacaoDaOrder: consultaTransacaoFalsa,
    }),
    {
      tipo: "concluido",
      mp_refund_id: "REEMB1",
      mp_status: "refunded",
      mp_status_detail: null,
      valor: 100,
    },
  );

  const descoberto = fetchDuble([
    postJaRefunded,
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        status: "refunded",
        transactions: [{ refunds: [{ id: "REEMB1", amount: "30.00" }] }],
      },
    },
  ]);
  const ruim = await executarEstorno({
    linha,
    pedido,
    token: TOKEN,
    buscar: descoberto.f,
    consultarTransacaoDaOrder: consultaTransacaoFalsa,
  });
  assertEquals(ruim.tipo, "falhou");
  assertStringIncludes((ruim as { motivo: string }).motivo, "não cobre");
});

Deno.test("E17 - Orders refund_amount_exceeds e codigos de recusa -> falhou com o codigo", () => {
  const pedido = pedidoOrder();
  const excede = interpretarResposta(
    400,
    erroOrders("refund_amount_exceeds"),
    linhaCom(),
    pedido,
  );
  assertEquals(excede.tipo, "falhou");
  assertEquals((excede as { codigo: string }).codigo, "refund_amount_exceeds");

  for (const codigo of ["cannot_refund_order", "order_not_found", "transaction_not_found", "forbidden"]) {
    const r = interpretarResposta(400, erroOrders(codigo), linhaCom(), pedido);
    assertEquals(r.tipo, "falhou");
    assertEquals((r as { codigo: string }).codigo, codigo);
  }
});

Deno.test("E18 - Orders idempotency_key_already_used -> consulta a order (o resultado desta chave existe); Orders 429 -> tentar_depois", async () => {
  const linha = linhaCom();
  const pedido = pedidoOrder();

  const chaveUsada = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 409,
      corpo: erroOrders("idempotency_key_already_used"),
    },
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        status: "refunded",
        transactions: [{ refunds: [{ id: "REEMB9", amount: "100.00" }] }],
      },
    },
  ]);
  assertEquals(
    (await executarEstorno({
      linha,
      pedido,
      token: TOKEN,
      buscar: chaveUsada.f,
      consultarTransacaoDaOrder: consultaTransacaoFalsa,
    })).tipo,
    "concluido",
  );

  const ocupado = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 429,
      corpo: erroOrders("too_many_requests"),
    },
  ]);
  assertEquals(
    (await executarEstorno({
      linha,
      pedido,
      token: TOKEN,
      buscar: ocupado.f,
      consultarTransacaoDaOrder: consultaTransacaoFalsa,
    })).tipo,
    "tentar_depois",
  );
});

// ---------------------------------------------------------------------------
// E19–E20 — contrato do executor
// ---------------------------------------------------------------------------

Deno.test("E19 - executar com fetch que lanca -> tentar_depois, nunca lanca", async () => {
  const buscaQueLanca: typeof fetch = () =>
    Promise.reject(new Error("rede caiu"));
  assertEquals(
    (await executarEstorno({
      linha: linhaCom(),
      pedido: pedidoPagoCom(),
      token: TOKEN,
      buscar: buscaQueLanca,
    })).tipo,
    "tentar_depois",
  );
});

Deno.test("E20 - executar NUNCA chama o fetch quando a guarda recusa", async () => {
  const duble = fetchDuble([]);
  let consultas = 0;
  const resultado = await executarEstorno({
    linha: linhaCom({ amount: 150 }),
    pedido: pedidoOrder({ total: 100 }),
    token: TOKEN,
    buscar: duble.f,
    consultarTransacaoDaOrder: (orderId) => {
      consultas++;
      return consultaTransacaoFalsa(orderId);
    },
  });
  assertEquals(resultado.tipo, "recusado");
  assertEquals(duble.chamadas.length, 0);
  assertEquals(consultas, 0);
});

// ---------------------------------------------------------------------------
// E21–E25 — correções do laudo Opus do PR #438 (07/09)
// ---------------------------------------------------------------------------

Deno.test("E21 - confirmacao compara o ACUMULADO do MP com o ACUMULADO do ledger, nao com a linha incremental (I2)", async () => {
  // Pedido de R$100 com R$30 ja somados no ledger; linha nova de R$20.
  // O acumulado exigido do MP e' 30 + 20 = 50 — MP ainda em 30 NAO conclui.
  const linha = linhaCom({ amount: 20 });
  const pedido = pedidoPagoCom({ total: 100, valor_estornado: 30 });
  const post4296 = {
    metodo: "POST",
    trecho: "/v1/payments/123456789/refunds",
    status: 404,
    corpo: erroPayments(4296),
  };

  const mpEm30 = fetchDuble([
    post4296,
    {
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: {
        id: 123456789,
        status: "approved",
        transaction_amount_refunded: 30,
      },
    },
  ]);
  // Com pré-veredito (o POST voltou 4296: o MP AFIRMOU "já devolvido"),
  // insuficiente é definitivo — falhou, com o marcador único do achado.
  const comCodigo = await executarEstorno({
    linha,
    pedido,
    token: TOKEN,
    buscar: mpEm30.f,
  });
  assertEquals(comCodigo.tipo, "falhou");
  assertEquals(
    (comCodigo as { codigo: string }).codigo,
    "confirmacao_insuficiente",
  );

  // Alternativa B do I-A (laudo #438 rodada 2): o caminho DIRETO — sem
  // pré-veredito, é o que a T4 usa para linha em_processamento — nunca
  // conclui "falhou" por consistência eventual: vira tentar_depois, para o
  // cron poder repetir o POST com a mesma chave (R3).
  const semCodigo = await confirmarPorConsulta({
    buscar: mpEm30.f,
    token: TOKEN,
    linha,
    pedido,
  });
  assertEquals(semCodigo.tipo, "tentar_depois");

  const mpEm50 = fetchDuble([
    post4296,
    {
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: {
        id: 123456789,
        status: "approved",
        transaction_amount_refunded: 50,
        // Ordem de proposito: o refund de OUTRA linha (30) por ULTIMO — o
        // id gravado tem de ser o desta linha (M3), nao o ultimo da lista.
        refunds: [{ id: 888, amount: 20 }, { id: 777, amount: 30 }],
      },
    },
  ]);
  const concluido = await executarEstorno({
    linha,
    pedido,
    token: TOKEN,
    buscar: mpEm50.f,
  });
  assertEquals(concluido.tipo, "concluido");
  assertEquals((concluido as { mp_refund_id: string }).mp_refund_id, "888");

  // I1: a funcao e' exportada e decide SOZINHA — e' o contrato da T4, que a
  // chama direto para linhas em_processamento (concluir SEM novo POST).
  const direto = await confirmarPorConsulta({
    buscar: mpEm50.f,
    token: TOKEN,
    linha,
    pedido,
  });
  assertEquals(direto.tipo, "concluido");

  // Orders: a mesma conta pela soma de refunds[] da order.
  const pedidoCom30 = pedidoOrder({ total: 100, valor_estornado: 30 });
  const postJaRefunded = {
    metodo: "POST",
    trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
    status: 409,
    corpo: erroOrders("order_already_refunded"),
  };
  const orderEm30 = fetchDuble([
    postJaRefunded,
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        status: "refunded",
        transactions: [{ refunds: [{ id: "REEMB1", amount: "30.00" }] }],
      },
    },
  ]);
  const ordersComCodigo = await executarEstorno({
    linha,
    pedido: pedidoCom30,
    token: TOKEN,
    buscar: orderEm30.f,
    consultarTransacaoDaOrder: consultaTransacaoFalsa,
  });
  assertEquals(ordersComCodigo.tipo, "falhou");
  assertEquals(
    (ordersComCodigo as { codigo: string }).codigo,
    "confirmacao_insuficiente",
  );

  // Mesma alternativa B, agora na Orders API: caminho direto -> tentar_depois.
  const ordersSemCodigo = await confirmarPorConsulta({
    buscar: orderEm30.f,
    token: TOKEN,
    linha,
    pedido: pedidoCom30,
  });
  assertEquals(ordersSemCodigo.tipo, "tentar_depois");

  const orderEm50 = fetchDuble([
    postJaRefunded,
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        status: "refunded",
        transactions: [{
          refunds: [{ id: "REEMB1", amount: "30.00" }, {
            id: "REEMB2",
            amount: "20.00",
          }],
        }],
      },
    },
  ]);
  const concluida = await executarEstorno({
    linha,
    pedido: pedidoCom30,
    token: TOKEN,
    buscar: orderEm50.f,
    consultarTransacaoDaOrder: consultaTransacaoFalsa,
  });
  assertEquals(concluida.tipo, "concluido");
  assertEquals((concluida as { mp_refund_id: string }).mp_refund_id, "REEMB2");
});

Deno.test("E22 - 401/403 de credencial vira tentar_depois nas duas APIs, sem jargao de HTTP; forbidden NOMEADO continua falhou (C2/I3)", async () => {
  const p401 = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/payments/123456789/refunds",
      status: 401,
      corpo: { message: "invalid token", error: "unauthorized" },
    },
  ]);
  const payments = await executarEstorno({
    linha: linhaCom(),
    pedido: pedidoPagoCom(),
    token: TOKEN,
    buscar: p401.f,
  });
  assertEquals(payments.tipo, "tentar_depois");
  assertStringIncludes((payments as { motivo: string }).motivo, "autenticar");
  // I3: o lojista nao le numero de HTTP no texto.
  assertEquals(
    (payments as { motivo: string }).motivo.includes("401"),
    false,
  );

  const o403 = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 403,
      corpo: { error: "forbidden" }, // sem codigo NOMEADO: e' a credencial
    },
  ]);
  const orders = await executarEstorno({
    linha: linhaCom(),
    pedido: pedidoOrder(),
    token: TOKEN,
    buscar: o403.f,
    consultarTransacaoDaOrder: consultaTransacaoFalsa,
  });
  assertEquals(orders.tipo, "tentar_depois");
  assertStringIncludes((orders as { motivo: string }).motivo, "autenticar");

  // Payments 403 sem codigo tambem e' credencial.
  assertEquals(
    interpretarResposta(
      403,
      { message: "forbidden" },
      linhaCom(),
      pedidoPagoCom(),
    ).tipo,
    "tentar_depois",
  );

  // O forbidden NOMEADO da Orders e' codigo do PAGAMENTO (permissao sobre a
  // cobranca), nao da credencial: continua falhou definitivo (C2 do laudo).
  assertEquals(
    interpretarResposta(
      403,
      erroOrders("forbidden"),
      linhaCom(),
      pedidoOrder(),
    ).tipo,
    "falhou",
  );
});

Deno.test("E23 - consulta que nao esclarece (valor ausente/ilegivel) vira tentar_depois, nunca falhou (C3)", async () => {
  // Payments: MP disse 4296, o GET volta SEM transaction_amount_refunded.
  const semCampo = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/payments/123456789/refunds",
      status: 404,
      corpo: erroPayments(4296),
    },
    {
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: { id: 123456789, status: "approved" },
    },
  ]);
  assertEquals(
    (await executarEstorno({
      linha: linhaCom(),
      pedido: pedidoPagoCom(),
      token: TOKEN,
      buscar: semCampo.f,
    })).tipo,
    "tentar_depois",
  );

  // Orders: order refunded SEM refunds[] materializados (consistencia
  // eventual do MP logo apos o refund).
  const semRefunds = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 409,
      corpo: erroOrders("order_already_refunded"),
    },
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        status: "refunded",
        transactions: [{}],
      },
    },
  ]);
  assertEquals(
    (await executarEstorno({
      linha: linhaCom(),
      pedido: pedidoOrder(),
      token: TOKEN,
      buscar: semRefunds.f,
      consultarTransacaoDaOrder: consultaTransacaoFalsa,
    })).tipo,
    "tentar_depois",
  );
});

Deno.test("E24 - POST sai com a chave de idempotencia da LINHA e o corpo certo nas duas APIs (I4/I5)", async () => {
  // Payments feliz (total): body vazio e chave = id da linha (I4).
  const payments = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/payments/123456789/refunds",
      status: 201,
      corpo: { id: 111, payment_id: 123456789, amount: 100, status: "approved" },
    },
  ]);
  const linhaPayments = linhaCom();
  await executarEstorno({
    linha: linhaPayments,
    pedido: pedidoPagoCom(),
    token: TOKEN,
    buscar: payments.f,
  });
  assertEquals(payments.chamadas[0].chave, linhaPayments.id);
  assertEquals(JSON.parse(payments.chamadas[0].corpo ?? "null"), {});

  // Orders feliz (total): transactions[0].id == o que
  // consultarTransacaoDaOrder devolveu (I5) e a mesma chave (I4).
  const orders = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 201,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        status: "refunded",
        status_detail: "refunded",
      },
    },
  ]);
  const linhaOrders = linhaCom();
  await executarEstorno({
    linha: linhaOrders,
    pedido: pedidoOrder(),
    token: TOKEN,
    buscar: orders.f,
    consultarTransacaoDaOrder: consultaTransacaoFalsa,
  });
  assertEquals(orders.chamadas[0].chave, linhaOrders.id);
  assertEquals(JSON.parse(orders.chamadas[0].corpo ?? "null"), {
    transactions: [{ id: "PAY01XYZEXEMPLODETRANSA1" }],
  });
});

Deno.test("E25 - 2xx desconhecido vira tentar_depois nas duas APIs (M4)", async () => {
  const payments = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/payments/123456789/refunds",
      status: 200,
      corpo: { id: 111, status: "pendente_de_algo_novo" },
    },
  ]);
  assertEquals(
    (await executarEstorno({
      linha: linhaCom(),
      pedido: pedidoPagoCom(),
      token: TOKEN,
      buscar: payments.f,
    })).tipo,
    "tentar_depois",
  );

  const orders = fetchDuble([
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 201,
      corpo: { id: "ORD01ABCDEFOLUIMWQKDXYZ01", status: "processing" },
    },
  ]);
  assertEquals(
    (await executarEstorno({
      linha: linhaCom(),
      pedido: pedidoOrder(),
      token: TOKEN,
      buscar: orders.f,
      consultarTransacaoDaOrder: consultaTransacaoFalsa,
    })).tipo,
    "tentar_depois",
  );
});

// ---------------------------------------------------------------------------
// E26–E27 — M-A do laudo (PR #438 rodada 2): refundIdDaConsulta desempata
// pelo date_created mais recente e nunca devolve o id do pagamento.
// ---------------------------------------------------------------------------

Deno.test("E26 - refundIdDaConsulta desempata dois refunds do MESMO valor pelo date_created mais RECENTE (M-A)", async () => {
  const linha = linhaCom({ amount: 20 });
  const pedido = pedidoPagoCom({ total: 100, valor_estornado: 0 });
  // O mais recente vem PRIMEIRO na lista de propósito: um desempate por
  // posição (e nao por data) devolveria o id errado aqui.
  const mp = fetchDuble([
    {
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: {
        id: 123456789,
        status: "approved",
        transaction_amount_refunded: 20,
        refunds: [
          { id: 222, amount: 20, date_created: "2026-09-05T00:00:00.000Z" },
          { id: 111, amount: 20, date_created: "2026-09-01T00:00:00.000Z" },
        ],
      },
    },
  ]);
  const concluido = await confirmarPorConsulta({
    buscar: mp.f,
    token: TOKEN,
    linha,
    pedido,
  });
  assertEquals(concluido.tipo, "concluido");
  assertEquals((concluido as { mp_refund_id: string | null }).mp_refund_id, "222");

  // Orders: mesma conta pela soma de refunds[] da order.
  const pedidoOrd = pedidoOrder({ total: 100, valor_estornado: 0 });
  const mpOrders = fetchDuble([
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        status: "refunded",
        transactions: [{
          refunds: [
            {
              id: "REEMB_NOVO",
              amount: "20.00",
              date_created: "2026-09-05T00:00:00.000Z",
            },
            {
              id: "REEMB_VELHO",
              amount: "20.00",
              date_created: "2026-09-01T00:00:00.000Z",
            },
          ],
        }],
      },
    },
  ]);
  const concluidaOrders = await confirmarPorConsulta({
    buscar: mpOrders.f,
    token: TOKEN,
    linha,
    pedido: pedidoOrd,
  });
  assertEquals(concluidaOrders.tipo, "concluido");
  assertEquals(
    (concluidaOrders as { mp_refund_id: string | null }).mp_refund_id,
    "REEMB_NOVO",
  );
});

Deno.test("E27 - sem refunds[] materializado, concluido grava mp_refund_id NULL — nunca o id do pagamento (M-A)", async () => {
  const linha = linhaCom({ amount: 20 });
  const pedido = pedidoPagoCom({ total: 100, valor_estornado: 0 });

  // Payments: transaction_amount_refunded confirma o valor, mas refunds[]
  // ainda não veio (consistência eventual do MP) — SEM o campo.
  const semCampo = fetchDuble([
    {
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: { id: 123456789, status: "approved", transaction_amount_refunded: 20 },
    },
  ]);
  const concluidoSemCampo = await confirmarPorConsulta({
    buscar: semCampo.f,
    token: TOKEN,
    linha,
    pedido,
  });
  assertEquals(concluidoSemCampo.tipo, "concluido");
  assertEquals(
    (concluidoSemCampo as { mp_refund_id: string | null }).mp_refund_id,
    null,
  );

  // Payments: refunds[] presente mas VAZIO — mesmo desfecho, nunca o id do
  // pagamento (123456789) no campo do refund.
  const listaVazia = fetchDuble([
    {
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: {
        id: 123456789,
        status: "approved",
        transaction_amount_refunded: 20,
        refunds: [],
      },
    },
  ]);
  const concluidoListaVazia = await confirmarPorConsulta({
    buscar: listaVazia.f,
    token: TOKEN,
    linha,
    pedido,
  });
  assertEquals(concluidoListaVazia.tipo, "concluido");
  assertEquals(
    (concluidoListaVazia as { mp_refund_id: string | null }).mp_refund_id,
    null,
  );
});

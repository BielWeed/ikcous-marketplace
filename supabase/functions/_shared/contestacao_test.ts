// Lote A (04/10/2026, R1): a leitura da CONTESTAÇÃO (chargeback) — consulta
// do caso (GET /v1/chargebacks/{case_id}) e a decisão pelo caso. Nada aqui
// toca a rede: o fetch é dublê.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  consultarContestacao,
  decisaoDoCaso,
  lerContestacoesDaOrder,
  valorDoCaso,
  criarResolvedorDeVendedor,
  resolverVendedorIdDoMp,
} from "./contestacao.ts";

Deno.test("consultarContestacao: GET em /v1/chargebacks/{case_id}, com o case_id como STRING (sem perder dígitos)", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const r = await consultarContestacao({
    token: "TOKEN_TESTE", vendedorId: "1234567",
    caseId: "234000062890459000",
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "234000062890459000", coverage_applied: null }), { status: 200 });
    },
  });
  assertEquals(r.ok, true);
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].url, "https://api.mercadopago.com/v1/chargebacks/234000062890459000");
  assertEquals(chamadas[0].init?.method, "GET");
  assertEquals((chamadas[0].init?.headers as Record<string, string>).Authorization, "Bearer TOKEN_TESTE");
  assertEquals((chamadas[0].init?.headers as Record<string, string>)["X-Caller-Id"], "1234567");
});

// CONTRATO DO MP (tabela do GET /v1/chargebacks/{id}, 04/10/2026):
// https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/chargebacks/management
// `Authorization` E `X-Caller-Id` (ID do VENDEDOR) são OBRIGATÓRIOS. O dublê
// abaixo está preso a rota, método e headers: a loja dona é a do token T-A e do
// vendedor 111; qualquer outra combinação o MP recusa (403).
function mpDaLojaDona(chamadas: Array<{ url: string; init?: RequestInit }>) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    const h = new Headers(init?.headers);
    const certo = init?.method === "GET" &&
      String(url) === "https://api.mercadopago.com/v1/chargebacks/CASE9" &&
      h.get("Authorization") === "Bearer T-A" &&
      h.get("X-Caller-Id") === "111";
    return certo
      ? new Response(JSON.stringify({ id: "CASE9", coverage_applied: true }), { status: 200 })
      : new Response("{}", { status: 403 });
  };
}

Deno.test("consultarContestacao (contrato): COM Authorization da loja e X-Caller-Id do vendedor vinculado -> lê o caso", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const r = await consultarContestacao({ token: "T-A", caseId: "CASE9", vendedorId: "111", fetchImpl: mpDaLojaDona(chamadas) });
  assertEquals(r.ok, true);
  assertEquals(chamadas.length, 1);
});

Deno.test("consultarContestacao (contrato): SEM seller ID (ausente, nulo, vazio ou fora da forma numérica) -> NENHUMA chamada ao MP, resultado não transitório (conserva)", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const erroReal = console.error;
  console.error = () => {};
  try {
    for (const semId of [undefined, null, "", "abc", "11 1", "../x", "1".repeat(30)]) {
      const r = await consultarContestacao({
        token: "T-A",
        caseId: "CASE9",
        vendedorId: semId as string | null | undefined,
        fetchImpl: mpDaLojaDona(chamadas),
      });
      assertEquals(r.ok, false, String(semId));
      assertEquals((r as { transitorio: boolean }).transitorio, false, String(semId));
    }
  } finally {
    console.error = erroReal;
  }
  assertEquals(chamadas, [], "sem identidade confiável o MP nem é consultado");
});

Deno.test("consultarContestacao (contrato): seller ID DIVERGENTE do vendedor vinculado ao caso, ou Authorization de OUTRA loja -> o MP recusa (403) e nada é lido", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const erroReal = console.error;
  console.error = () => {};
  try {
    const outroVendedor = await consultarContestacao({ token: "T-A", caseId: "CASE9", vendedorId: "222", fetchImpl: mpDaLojaDona(chamadas) });
    const outraLoja = await consultarContestacao({ token: "T-B", caseId: "CASE9", vendedorId: "111", fetchImpl: mpDaLojaDona(chamadas) });
    for (const r of [outroVendedor, outraLoja]) {
      assertEquals(r.ok, false);
      assertEquals((r as { transitorio: boolean }).transitorio, false);
      assertEquals((r as { status: number }).status, 403);
    }
  } finally {
    console.error = erroReal;
  }
  assertEquals(chamadas.length, 2, "as duas foram ao MP e as duas voltaram 403");
});

Deno.test("consultarContestacao: nem o seller ID nem o token vão ao log", async () => {
  const linhas: string[] = [];
  const erroReal = console.error;
  console.error = (...a: unknown[]) => linhas.push(a.map((x) => JSON.stringify(x)).join(" "));
  try {
    await consultarContestacao({ token: "T-SEGREDO", caseId: "CASE9", vendedorId: "99887766", fetchImpl: async () => new Response("{}", { status: 403 }) });
    await consultarContestacao({ token: "T-SEGREDO", caseId: "CASE9", vendedorId: null, fetchImpl: async () => new Response("{}", { status: 200 }) });
  } finally {
    console.error = erroReal;
  }
  const tudo = linhas.join(" ");
  assertEquals(tudo.includes("T-SEGREDO"), false);
  assertEquals(tudo.includes("99887766"), false);
});

function mpUsersMe(chamadas: Array<{ url: string; init?: RequestInit }>, resposta: () => Response | Promise<Response>) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    return await resposta();
  };
}

Deno.test("resolverVendedorIdDoMp: UM GET em /users/me com o Authorization da loja (rota e método fixos, sem corpo) e o id numérico devolvido pelo MP", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const idNumero = await resolverVendedorIdDoMp({
    token: "T-A",
    fetchImpl: mpUsersMe(chamadas, () => new Response(JSON.stringify({ id: 1234567, nickname: "LOJA" }), { status: 200 })),
  });
  const idTexto = await resolverVendedorIdDoMp({
    token: "T-A",
    fetchImpl: mpUsersMe(chamadas, () => new Response(JSON.stringify({ id: "7654321" }), { status: 200 })),
  });
  assertEquals([idNumero, idTexto], ["1234567", "7654321"]);
  assertEquals(chamadas.map((c) => [c.url, c.init?.method, c.init?.body]), [
    ["https://api.mercadopago.com/users/me", "GET", undefined],
    ["https://api.mercadopago.com/users/me", "GET", undefined],
  ]);
  assertEquals(Object.keys(chamadas[0].init?.headers as Record<string, string>), ["Authorization"]);
  assertEquals((chamadas[0].init?.headers as Record<string, string>).Authorization, "Bearer T-A");
});

Deno.test("resolverVendedorIdDoMp: fonte INVÁLIDA (401, 5xx, rede, corpo ilegível, id ausente/zero/negativo/texto/gigante/objeto) -> null, nunca um palpite", async () => {
  const erroReal = console.error;
  console.error = () => {};
  try {
    const respostas: Array<[string, () => Response | Promise<Response>]> = [
      ["401", () => new Response("{}", { status: 401 })],
      ["500", () => new Response("{}", { status: 500 })],
      ["rede", () => Promise.reject(new TypeError("rede caiu"))],
      ["corpo ilegível", () => new Response("<html>", { status: 200 })],
      ["corpo array", () => new Response("[1]", { status: 200 })],
      ["sem id", () => new Response(JSON.stringify({ nickname: "x" }), { status: 200 })],
      ["id zero", () => new Response(JSON.stringify({ id: 0 }), { status: 200 })],
      ["id negativo", () => new Response(JSON.stringify({ id: -5 }), { status: 200 })],
      ["id texto", () => new Response(JSON.stringify({ id: "abc" }), { status: 200 })],
      ["id com espaço", () => new Response(JSON.stringify({ id: "12 3" }), { status: 200 })],
      ["id gigante", () => new Response('{"id": 99999999999999999999999}', { status: 200 })],
      ["id objeto", () => new Response(JSON.stringify({ id: { n: 1 } }), { status: 200 })],
    ];
    for (const [nome, resposta] of respostas) {
      assertEquals(await resolverVendedorIdDoMp({ token: "T-A", fetchImpl: mpUsersMe([], resposta) }), null, nome);
    }
  } finally {
    console.error = erroReal;
  }
});

Deno.test("criarResolvedorDeVendedor: UM /users/me por execução (mesmo com vários casos), lembrado só na memória; falha também é lembrada (não martela o MP)", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const obter = criarResolvedorDeVendedor({
    token: "T-A",
    fetchImpl: mpUsersMe(chamadas, () => new Response(JSON.stringify({ id: 42 }), { status: 200 })),
  });
  assertEquals([await obter(), await obter(), await obter()], ["42", "42", "42"]);
  assertEquals(chamadas.length, 1);

  const falhas: Array<{ url: string; init?: RequestInit }> = [];
  const erroReal = console.error;
  console.error = () => {};
  try {
    const obterFalho = criarResolvedorDeVendedor({ token: "T-A", fetchImpl: mpUsersMe(falhas, () => new Response("{}", { status: 503 })) });
    assertEquals([await obterFalho(), await obterFalho()], [null, null]);
  } finally {
    console.error = erroReal;
  }
  assertEquals(falhas.length, 1);
  // Outra execução = outro resolvedor = outra consulta (token trocado vale na hora).
  const outra = criarResolvedorDeVendedor({ token: "T-B", fetchImpl: mpUsersMe(chamadas, () => new Response(JSON.stringify({ id: 43 }), { status: 200 })) });
  assertEquals(await outra(), "43");
  assertEquals(chamadas.length, 2);
});

Deno.test("resolverVendedorIdDoMp: nem o token nem o id vão ao log", async () => {
  const linhas: string[] = [];
  const erroReal = console.error;
  console.error = (...a: unknown[]) => linhas.push(a.map((x) => JSON.stringify(x)).join(" "));
  try {
    await resolverVendedorIdDoMp({ token: "T-SEGREDO", fetchImpl: mpUsersMe([], () => new Response(JSON.stringify({ id: 99887766 }), { status: 401 })) });
    await resolverVendedorIdDoMp({ token: "T-SEGREDO", fetchImpl: mpUsersMe([], () => Promise.reject(new Error("T-SEGREDO 99887766"))) });
    await resolverVendedorIdDoMp({ token: "T-SEGREDO", fetchImpl: mpUsersMe([], () => new Response(JSON.stringify({ id: "abc99887766" }), { status: 200 })) });
  } finally {
    console.error = erroReal;
  }
  const tudo = linhas.join(" ");
  assertEquals(tudo.includes("T-SEGREDO"), false);
  assertEquals(tudo.includes("99887766"), false);
});

Deno.test("consultarContestacao: case_id com forma estranha NÃO vira URL (nenhuma chamada)", async () => {
  let chamou = false;
  for (const ruim of ["", "../orders/ORD1", "12 34", "a".repeat(80)]) {
    const r = await consultarContestacao({
      token: "T", vendedorId: "1234567",
      caseId: ruim,
      fetchImpl: async () => {
        chamou = true;
        return new Response("{}", { status: 200 });
      },
    });
    assertEquals(r.ok, false, ruim);
    assertEquals((r as { transitorio: boolean }).transitorio, false, ruim);
  }
  assertEquals(chamou, false);
});

Deno.test("consultarContestacao: rede/5xx/429 são TRANSITÓRIOS (o MP reenvia); 404 não é", async () => {
  const comStatus = (status: number) => async () => new Response("{}", { status });
  const falhaDeRede = async () => {
    throw new Error("rede caiu");
  };
  const r500 = await consultarContestacao({ token: "T", vendedorId: "1234567", caseId: "1", fetchImpl: comStatus(500) });
  const r429 = await consultarContestacao({ token: "T", vendedorId: "1234567", caseId: "1", fetchImpl: comStatus(429) });
  const r404 = await consultarContestacao({ token: "T", vendedorId: "1234567", caseId: "1", fetchImpl: comStatus(404) });
  const rRede = await consultarContestacao({ token: "T", vendedorId: "1234567", caseId: "1", fetchImpl: falhaDeRede });
  assertEquals([r500.ok, r429.ok, r404.ok, rRede.ok], [false, false, false, false]);
  assertEquals((r500 as { transitorio: boolean }).transitorio, true);
  assertEquals((r429 as { transitorio: boolean }).transitorio, true);
  assertEquals((rRede as { transitorio: boolean }).transitorio, true);
  assertEquals((r404 as { transitorio: boolean }).transitorio, false);
});

Deno.test("consultarContestacao: o caso devolvido TEM de ser o pedido (id == case_id, string; número só se inteiro seguro) — senão não lê (não transitório)", async () => {
  // Bloqueio 4 da revisão do Lote A: o objeto do GET era aceito sem conferir
  // de QUAL caso ele é. Doc (chargebacks/management): GET /v1/chargebacks/{id}
  // devolve `id` = o case_id, como string ("234000062890459000").
  const consulta = (caseId: string, corpoCru: string) =>
    consultarContestacao({
      token: "T", vendedorId: "1234567",
      caseId,
      fetchImpl: async () => new Response(corpoCru, { status: 200 }),
    });
  const erroReal = console.error;
  console.error = () => {};
  try {
    const outroCaso = await consulta("1234567890", JSON.stringify({ id: "999", coverage_applied: false }));
    const semId = await consulta("1234567890", JSON.stringify({ coverage_applied: false }));
    const idVazio = await consulta("1234567890", JSON.stringify({ id: "", coverage_applied: false }));
    // 234000062890459000 > 2^53: como NÚMERO, o JSON já perdeu dígitos.
    const numeroLongo = await consulta("234000062890459000", '{"id": 234000062890459000, "coverage_applied": false}');
    const numeroQuase = await consulta("234000062890459001", '{"id": 234000062890459001, "coverage_applied": false}');
    for (const [nome, r] of Object.entries({ outroCaso, semId, idVazio, numeroLongo, numeroQuase })) {
      assertEquals(r.ok, false, nome);
      assertEquals((r as { transitorio: boolean }).transitorio, false, nome);
    }

    const mesmoCasoString = await consulta("234000062890459000", JSON.stringify({ id: "234000062890459000", coverage_applied: null }));
    const mesmoCasoNumeroSeguro = await consulta("1234567890", '{"id": 1234567890, "coverage_applied": null}');
    assertEquals(mesmoCasoString.ok, true);
    assertEquals(mesmoCasoNumeroSeguro.ok, true);
  } finally {
    console.error = erroReal;
  }
});

Deno.test("decisaoDoCaso: coverage_applied true = a favor da loja; false = contra; null = em análise; ausente/outro = não sei", () => {
  assertEquals(decisaoDoCaso({ coverage_applied: true }), "a_favor_da_loja");
  assertEquals(decisaoDoCaso({ coverage_applied: false }), "contra_a_loja");
  assertEquals(decisaoDoCaso({ coverage_applied: null }), "em_analise");
  assertEquals(decisaoDoCaso({}), null);
  assertEquals(decisaoDoCaso({ coverage_applied: "true" }), null);
});

Deno.test("valorDoCaso: só valor positivo em BRL; outra moeda, ausente ou não positivo = não sei (null)", () => {
  assertEquals(valorDoCaso({ amount: 37.5, currency: "BRL" }), 37.5);
  assertEquals(valorDoCaso({ amount: "37.50", currency: "BRL" }), 37.5);
  assertEquals(valorDoCaso({ amount: 37.5, currency: "ARS" }), null);
  assertEquals(valorDoCaso({ amount: 37.5 }), null);
  assertEquals(valorDoCaso({ amount: 0, currency: "BRL" }), null);
  assertEquals(valorDoCaso({ amount: null, currency: "BRL" }), null);
});

const PAY = "PAY01J67CQQH5904WDBVZEM4JMEP3";
function order(chargebacks: unknown, payments: unknown = [{ id: PAY, status: "charged_back", status_detail: "in_process" }]) {
  return { id: "ORDTST1", transactions: { payments, chargebacks } };
}

Deno.test("lerContestacoesDaOrder: lê id (CBK), case_id e transaction_id como STRING e o status_detail do PAGAMENTO da transação", () => {
  const r = lerContestacoesDaOrder(order([
    { id: "CBK01", transaction_id: PAY, case_id: "1234567890", status: "in_process" },
  ]));
  assertEquals(r.ok, true);
  const { itens } = r as { itens: Array<Record<string, unknown>> };
  assertEquals(itens, [{
    idContestacao: "CBK01",
    caseId: "1234567890",
    idTransacao: PAY,
    detalheDoPagamento: "in_process",
    statusDoItem: "in_process",
    casosNoPagamento: 1,
  }]);
});

Deno.test("lerContestacoesDaOrder: sem chargebacks[], sem id, sem case_id, case_id numérico inseguro, ou transação fora dos pagamentos -> não lê (motivo)", () => {
  const casos: Array<[string, unknown]> = [
    ["sem lista", order(undefined)],
    ["lista vazia", order([])],
    ["sem id", order([{ transaction_id: PAY, case_id: "1" }])],
    ["sem case_id", order([{ id: "CBK01", transaction_id: PAY }])],
    ["case_id numérico acima do inteiro seguro", order([{ id: "CBK01", transaction_id: PAY, case_id: 234000062890459000 }])],
    ["transação desconhecida", order([{ id: "CBK01", transaction_id: "PAY_OUTRO", case_id: "1" }])],
    ["sem transactions", { id: "ORDTST1" }],
  ];
  for (const [nome, corpo] of casos) {
    const r = lerContestacoesDaOrder(corpo as Record<string, unknown>);
    assertEquals(r.ok, false, nome);
  }
});

Deno.test("lerContestacoesDaOrder: dois casos no MESMO pagamento -> casosNoPagamento 2 (o status do pagamento não decide sozinho)", () => {
  const r = lerContestacoesDaOrder(order([
    { id: "CBK01", transaction_id: PAY, case_id: "1" },
    { id: "CBK02", transaction_id: PAY, case_id: "2" },
  ]));
  assertEquals(r.ok, true);
  const { itens } = r as { itens: Array<{ casosNoPagamento: number }> };
  assertEquals(itens.map((i) => i.casosNoPagamento), [2, 2]);
});

// ── redirecionamento: o Authorization nunca sai da origem do MP ────────────────
// O dublê imita a semântica do fetch: com redirect "manual" devolve o 302 como
// está; SEM isso (padrão do fetch = "follow") faz a 2ª chamada ao Location,
// carregando os headers — é o que um fetch real faria com um host malicioso.
function fetchQueRedireciona(chamadas: Array<{ url: string; autorizacao: string | null; vendedor: string | null; redirect?: string }>) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    chamadas.push({ url: String(url), autorizacao: h.get("Authorization"), vendedor: h.get("X-Caller-Id"), redirect: init?.redirect });
    if (String(url).startsWith("https://api.mercadopago.com/")) {
      const r = new Response(null, { status: 302, headers: { Location: "https://fora.example/captura" } });
      if (init?.redirect === "manual") return r;
      chamadas.push({ url: "https://fora.example/captura", autorizacao: h.get("Authorization"), vendedor: h.get("X-Caller-Id"), redirect: "follow" });
      return new Response(JSON.stringify({ id: 1234567 }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
}

Deno.test("resolverVendedorIdDoMp: 302 para OUTRO host -> fonte inválida (null); o Authorization NÃO sai para o host de fora", async () => {
  const chamadas: Array<{ url: string; autorizacao: string | null; vendedor: string | null; redirect?: string }> = [];
  const erroReal = console.error;
  console.error = () => {};
  try {
    const id = await resolverVendedorIdDoMp({ token: "T-A", fetchImpl: fetchQueRedireciona(chamadas) });
    assertEquals(id, null);
  } finally {
    console.error = erroReal;
  }
  assertEquals(chamadas.map((c) => c.url), ["https://api.mercadopago.com/users/me"]);
  assertEquals(chamadas[0].redirect, "manual");
  assertEquals(chamadas.some((c) => c.url.includes("fora.example")), false, "o Authorization vazou para o host de fora");
});

Deno.test("consultarContestacao: 302 para OUTRO host -> não lê o caso (não transitório); Authorization e X-Caller-Id não saem para o host de fora", async () => {
  const chamadas: Array<{ url: string; autorizacao: string | null; vendedor: string | null; redirect?: string }> = [];
  const erroReal = console.error;
  console.error = () => {};
  try {
    const r = await consultarContestacao({ token: "T-A", caseId: "CASE9", vendedorId: "111", fetchImpl: fetchQueRedireciona(chamadas) });
    assertEquals(r.ok, false);
    assertEquals((r as { transitorio: boolean }).transitorio, false);
    assertEquals((r as { status: number }).status, 302);
  } finally {
    console.error = erroReal;
  }
  assertEquals(chamadas.map((c) => c.url), ["https://api.mercadopago.com/v1/chargebacks/CASE9"]);
  assertEquals(chamadas[0].redirect, "manual");
});

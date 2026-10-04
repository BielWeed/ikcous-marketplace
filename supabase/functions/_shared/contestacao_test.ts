// Lote A (04/10/2026, R1): a leitura da CONTESTAÇÃO (chargeback) — consulta
// do caso (GET /v1/chargebacks/{case_id}) e a decisão pelo caso. Nada aqui
// toca a rede: o fetch é dublê.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  consultarContestacao,
  decisaoDoCaso,
  lerContestacoesDaOrder,
  valorDoCaso,
} from "./contestacao.ts";

Deno.test("consultarContestacao: GET em /v1/chargebacks/{case_id}, com o case_id como STRING (sem perder dígitos)", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const r = await consultarContestacao({
    token: "TOKEN_TESTE",
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
});

Deno.test("consultarContestacao: case_id com forma estranha NÃO vira URL (nenhuma chamada)", async () => {
  let chamou = false;
  for (const ruim of ["", "../orders/ORD1", "12 34", "a".repeat(80)]) {
    const r = await consultarContestacao({
      token: "T",
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
  const r500 = await consultarContestacao({ token: "T", caseId: "1", fetchImpl: comStatus(500) });
  const r429 = await consultarContestacao({ token: "T", caseId: "1", fetchImpl: comStatus(429) });
  const r404 = await consultarContestacao({ token: "T", caseId: "1", fetchImpl: comStatus(404) });
  const rRede = await consultarContestacao({ token: "T", caseId: "1", fetchImpl: falhaDeRede });
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
      token: "T",
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

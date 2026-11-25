// @ts-nocheck
/**
 * Caça por mutação (25/11/2026, segunda rodada) em `contestacao.ts`: as bordas da
 * CONSULTA do caso de contestação (chargeback) e do seller ID da loja. O que
 * sobrevivia às suítes `contestacao_*_test.ts`:
 *
 *   * o tamanho do `case_id` aceito na URL: 64 caracteres valem, 65 não (e a
 *     recusa devolve `status: 0`, `transitorio: false` — nunca outro número);
 *   * a forma do seller ID: só dígitos (o ZERO vale no meio: "1020304050"), no
 *     máximo 20, e o ID que o `users/me` devolve com 20 dígitos passa, com 21 não;
 *   * a resposta do `users/me` que NÃO é sucesso (404, 3xx) vira `null`: fonte
 *     inválida, mesmo com um corpo que traz um id;
 *   * a falha SEM caso ou SEM seller ID não chama o Mercado Pago nem uma vez.
 *
 * (Equivalentes explicados, sem teste: `status >= 300` / `||` no `users/me` — o
 * `fetchComTempo` recria a `Response`, cujo `ok` é derivado do status (200-299),
 * então `!ok` e `status >= 300` sempre concordam e não há resposta com um sem o
 * outro; a checagem `corpo && typeof ... && !Array`
 * do `users/me` cai no mesmo `null` pelo `catch` quando o corpo não é objeto; e o
 * `if (memo === consulta)` do resolvedor nunca vê outra promessa no lugar, porque
 * a memória só é preenchida com ela vazia.)
 *
 * Valores escritos à mão; sem rede (fetch de mentira), sem banco, sem segredo.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { consultarContestacao, resolverVendedorIdDoMp } from "./contestacao.ts";

/** Um fetch de mentira que conta chamadas e devolve o que o teste mandou. */
function fetchDeMentira(resposta: unknown) {
  const chamadas: unknown[] = [];
  const impl = ((url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    return Promise.resolve(resposta);
  }) as unknown as typeof fetch;
  return { impl, chamadas };
}

function jsonDeMentira(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

const VENDEDOR = "1020304050";

// ─── o case_id na URL ────────────────────────────────────────────────────────

Deno.test("consultarContestacao: case_id de 64 caracteres vale (a URL sai); de 65 não (nenhuma chamada, status 0, não transitório)", async () => {
  const id64 = "a".repeat(63) + "9";
  const ok = fetchDeMentira(jsonDeMentira(200, { id: id64, coverage_applied: null }));
  const r64 = await consultarContestacao({ token: "t", caseId: id64, vendedorId: VENDEDOR, fetchImpl: ok.impl });
  assertEquals(r64.ok, true);
  assertEquals(ok.chamadas.length, 1);

  const id65 = "a".repeat(65);
  const nada = fetchDeMentira(jsonDeMentira(200, { id: id65 }));
  const r65 = await consultarContestacao({ token: "t", caseId: id65, vendedorId: VENDEDOR, fetchImpl: nada.impl });
  assertEquals(r65, { ok: false, status: 0, transitorio: false });
  assertEquals(nada.chamadas.length, 0);
});

Deno.test("consultarContestacao: case_id com barra, espaço ou vazio nunca chega à URL — status 0, não transitório, zero chamadas", async () => {
  for (const ruim of ["", "a/b", "a b", "../x", "a?b=1"]) {
    const f = fetchDeMentira(jsonDeMentira(200, { id: ruim }));
    const r = await consultarContestacao({ token: "t", caseId: ruim, vendedorId: VENDEDOR, fetchImpl: f.impl });
    assertEquals(r, { ok: false, status: 0, transitorio: false }, JSON.stringify(ruim));
    assertEquals(f.chamadas.length, 0, JSON.stringify(ruim));
  }
});

// ─── o seller ID na consulta do caso ─────────────────────────────────────────

Deno.test("consultarContestacao: seller ID com zero no meio e de 20 dígitos vale; de 21 dígitos, com letra, vazio ou ausente não chama o MP (status 0, não transitório)", async () => {
  for (const bom of ["1020304050", "00000000000000000001", "12345678901234567890"]) {
    const f = fetchDeMentira(jsonDeMentira(200, { id: "CASO1" }));
    const r = await consultarContestacao({ token: "t", caseId: "CASO1", vendedorId: bom, fetchImpl: f.impl });
    assertEquals(r.ok, true, bom);
    assertEquals(f.chamadas.length, 1, bom);
    assertEquals(f.chamadas[0].init.headers["X-Caller-Id"], bom, bom);
  }
  for (const ruim of ["123456789012345678901", "12a4", "", " 12", null, undefined, 123]) {
    const f = fetchDeMentira(jsonDeMentira(200, { id: "CASO1" }));
    const r = await consultarContestacao({ token: "t", caseId: "CASO1", vendedorId: ruim, fetchImpl: f.impl });
    assertEquals(r, { ok: false, status: 0, transitorio: false }, JSON.stringify(ruim) ?? "undefined");
    assertEquals(f.chamadas.length, 0, JSON.stringify(ruim) ?? "undefined");
  }
});

// ─── o users/me (seller ID) ──────────────────────────────────────────────────

Deno.test("resolverVendedorIdDoMp: id de 20 dígitos e id com zeros no meio são devolvidos; 21 dígitos, só zeros e não-numérico viram null", async () => {
  const casos: Array<[unknown, string | null]> = [
    ["12345678901234567890", "12345678901234567890"],
    ["1020304050", "1020304050"],
    [1020304050, "1020304050"],
    ["123456789012345678901", null],
    ["0", null],
    ["000", null],
    ["12a", null],
    ["", null],
    [-5, null],
    [null, null],
    [{}, null],
  ];
  for (const [id, esperado] of casos) {
    const f = fetchDeMentira(jsonDeMentira(200, { id }));
    const r = await resolverVendedorIdDoMp({ token: "t", fetchImpl: f.impl });
    assertEquals(r, esperado, JSON.stringify(id) ?? "undefined");
  }
});

Deno.test("resolverVendedorIdDoMp: resposta que não é sucesso (404, 301) vira null mesmo com corpo válido; 299-200 devolve o id", async () => {
  const corpo = { id: "1020304050" };
  for (const status of [404, 400, 301, 302, 403]) {
    const f = fetchDeMentira(jsonDeMentira(status, corpo));
    assertEquals(await resolverVendedorIdDoMp({ token: "t", fetchImpl: f.impl }), null, String(status));
  }
  for (const status of [200, 201, 299]) {
    const f = fetchDeMentira(jsonDeMentira(status, corpo));
    assertEquals(await resolverVendedorIdDoMp({ token: "t", fetchImpl: f.impl }), "1020304050", String(status));
  }
});

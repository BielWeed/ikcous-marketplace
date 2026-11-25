// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `mercadopago.ts` (linhas 2101–2447): a
 * ASSINATURA do webhook (é ela que diz "esta notificação veio do Mercado Pago")
 * e a leitura do valor de um pagamento clássico. 15 mutantes sobreviviam a
 * `mercadopago_test.ts` + `mercadopago_assinatura_test.ts`; os que mudavam o
 * comportamento viram os casos abaixo.
 *
 * Em PRODUÇÃO a janela de tolerância do relógio é INFINITA (o webhook passa
 * `Number.POSITIVE_INFINITY`: o MP reenvia sem limite), então quem barra um `ts`
 * que não é número é só a checagem de `ts` finito — e quem barra segredo vazio é
 * só a guarda de entrada. Os dois casos têm HMAC VÁLIDO calculado pelo teste
 * (com a chave que a guarda deveria recusar), porque é isso que um mutante que
 * tira a guarda deixaria passar:
 *
 *   * segredo vazio, assinatura ausente ou `data.id` vazio: nunca válido, mesmo
 *     com um HMAC "correto" para a chave vazia;
 *   * `ts` que não é número finito ("abc", "Infinity"): nunca válido, mesmo com o
 *     HMAC correto sobre aquele manifesto;
 *   * header SEM `ts` (só `v1`): nunca válido;
 *   * a janela de tolerância é inclusiva no limite (idade == tolerância vale;
 *     1 ms a mais não) e `toleranciaSegundos: 0` significa ZERO, não o padrão;
 *   * relógio injetado em ZERO é o relógio em zero, não "agora";
 *   * `consultarPagamento`: só `transaction_amount` NUMÉRICO vira valor; texto,
 *     nulo e ausente viram `undefined` ("não deu para conferir", nunca 0).
 *
 * Fixtures inventadas; o segredo é inventado e nunca é o de nenhuma loja.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { createHmac } from "node:crypto";
import { avaliarAssinatura, consultarPagamento, construirCandidatosManifesto } from "./mercadopago.ts";

const SEGREDO = "segredo-de-teste-da-assinatura";
const DATA_ID = "ORD01TESTE0000000000000001";
const REQUEST_ID = "req-de-teste-1";
const TS = 1_760_000_000;

/** HMAC-SHA256 em hex do PRIMEIRO manifesto candidato, com a chave dada (vazia inclusive). */
function hmacDe(segredo: string, ts: string, dataId = DATA_ID): string {
  const [primeiro] = construirCandidatosManifesto({ dataId, xRequestId: REQUEST_ID, ts });
  return createHmac("sha256", segredo).update(primeiro.manifesto).digest("hex");
}

const cabecalho = (ts: string | null, v1: string) => (ts === null ? `v1=${v1}` : `ts=${ts},v1=${v1}`);

async function avaliar(extra: Record<string, unknown>) {
  return await avaliarAssinatura({
    xSignature: cabecalho(String(TS), hmacDe(SEGREDO, String(TS))),
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: TS * 1000,
    ...extra,
  });
}

Deno.test("controle: a assinatura certa, com o segredo certo e o relógio em dia, é válida", async () => {
  const r = await avaliar({});
  assertEquals(r.valido, true);
  assertEquals(r.candidatoCasou, "corpo-original");
});

Deno.test("segredo vazio nunca valida, mesmo com o HMAC 'correto' para a chave vazia (e nem lança)", async () => {
  for (const segredo of ["", null, undefined]) {
    const r = await avaliar({
      segredo,
      xSignature: cabecalho(String(TS), hmacDe("", String(TS))),
      toleranciaSegundos: Number.POSITIVE_INFINITY,
    });
    assertEquals(r, { valido: false, candidatoCasou: null, candidatos: [] }, String(segredo));
  }
});

Deno.test("assinatura ausente ou data.id vazio nunca validam", async () => {
  for (const xSignature of [null, undefined, ""]) {
    assertEquals((await avaliar({ xSignature })).valido, false, String(xSignature));
  }
  const semId = await avaliar({ dataId: "", xSignature: cabecalho(String(TS), hmacDe(SEGREDO, String(TS), "")) });
  assertEquals(semId.valido, false);
  assertEquals(semId.candidatos, []);
});

Deno.test("ts que não é número finito ('abc', 'Infinity') nunca valida, mesmo com o HMAC correto sobre aquele manifesto e janela infinita (a de produção)", async () => {
  for (const ts of ["abc", "Infinity", "-Infinity", "NaN"]) {
    const r = await avaliar({
      xSignature: cabecalho(ts, hmacDe(SEGREDO, ts)),
      toleranciaSegundos: Number.POSITIVE_INFINITY,
    });
    assertEquals(r.valido, false, ts);
    assertEquals(r.candidatos, [], ts);
  }
});

Deno.test("header SEM ts (só v1) nunca valida, mesmo com o HMAC correto sobre o manifesto de ts vazio e janela infinita", async () => {
  const r = await avaliar({
    xSignature: cabecalho(null, hmacDe(SEGREDO, "")),
    toleranciaSegundos: Number.POSITIVE_INFINITY,
  });
  assertEquals(r.valido, false);
  assertEquals(r.candidatos, []);
});

Deno.test("header SEM v1 (só ts) nunca valida", async () => {
  const r = await avaliar({ xSignature: `ts=${TS}`, toleranciaSegundos: Number.POSITIVE_INFINITY });
  assertEquals(r.valido, false);
  assertEquals(r.candidatos, []);
});

Deno.test("janela de tolerância: idade igual à tolerância vale; 1 ms a mais não; vale para o relógio adiantado e para o atrasado", async () => {
  const limite = (TS + 300) * 1000;
  assertEquals((await avaliar({ agora: limite })).valido, true, "idade == 300 s");
  assertEquals((await avaliar({ agora: limite + 1 })).valido, false, "idade 300,001 s");
  const atras = (TS - 300) * 1000;
  assertEquals((await avaliar({ agora: atras })).valido, true, "ts 300 s no futuro");
  assertEquals((await avaliar({ agora: atras - 1 })).valido, false, "ts 300,001 s no futuro");
});

Deno.test("toleranciaSegundos 0 significa ZERO (não o padrão de 300 s); infinito desliga a janela", async () => {
  assertEquals((await avaliar({ toleranciaSegundos: 0, agora: TS * 1000 })).valido, true);
  assertEquals((await avaliar({ toleranciaSegundos: 0, agora: TS * 1000 + 1 })).valido, false);
  assertEquals((await avaliar({ toleranciaSegundos: Number.POSITIVE_INFINITY, agora: (TS + 10_000_000) * 1000 })).valido, true);
});

Deno.test("relógio injetado em ZERO é o relógio em zero, não 'agora'", async () => {
  const r = await avaliar({ agora: 0, xSignature: cabecalho("0", hmacDe(SEGREDO, "0")) });
  assertEquals(r.valido, true);
});

Deno.test("v1 de outro tamanho ou com um caractere trocado nunca valida", async () => {
  const certo = hmacDe(SEGREDO, String(TS));
  const trocado = certo.slice(0, -1) + (certo.endsWith("0") ? "1" : "0");
  for (const v1 of [trocado, certo.slice(0, -1), `${certo}0`, certo.toUpperCase().replace(/[A-F]/g, "Z")]) {
    assertEquals((await avaliar({ xSignature: cabecalho(String(TS), v1) })).valido, false, v1);
  }
});

// ─── o valor de um pagamento clássico ────────────────────────────────────────

async function pagamento(corpo: Record<string, unknown>) {
  return await consultarPagamento({
    token: "token-de-teste",
    paymentId: "123",
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 })),
  });
}

Deno.test("consultarPagamento: só transaction_amount NUMÉRICO vira valor; texto, nulo e ausente viram undefined (nunca 0)", async () => {
  const ok = await pagamento({ id: 123, status: "approved", transaction_amount: 50.5 });
  assertEquals(ok.ok, true);
  assertEquals(ok.valor, 50.5);
  for (const ruim of ["50.00", null, undefined, {}, true]) {
    const r = await pagamento({ id: 123, status: "approved", transaction_amount: ruim });
    assertEquals(r.ok, true);
    assertEquals(r.valor, undefined, JSON.stringify(ruim));
  }
  const zero = await pagamento({ id: 123, status: "approved", transaction_amount: 0 });
  assertEquals(zero.valor, 0, "zero gravado é zero, não 'sem valor'");
  assert(typeof zero.id === "string");
});

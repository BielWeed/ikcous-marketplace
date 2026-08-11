// @ts-nocheck
/**
 * Testes de `validarAssinatura` — a UNICA autenticacao do webhook do
 * Mercado Pago (Fase 3). A function roda com verify_jwt = false porque o MP
 * nao manda JWT; se esta validacao passar so nos casos felizes, quem
 * descobrir a URL forja um "aprovado" e leva produto de graca.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { validarAssinatura } from "./mercadopago.ts";

const SEGREDO = "segredo-de-teste";
const TS = 1700000000;
const DATA_ID = "12345";
const REQUEST_ID = "abc-123";
// Gerado pelo crypto do Node em 07/08/2026, com o manifesto
// `id:12345;request-id:abc-123;ts:1700000000;`. Se este hex for recalculado
// pela propria funcao, o teste deixa de provar qualquer coisa.
//
// Confirmado contra a documentacao do MP (context7, 09/08/2026): formato do
// header, unidade do `ts` (segundos) e omissao do `request-id` batem com o
// que o plano assumiu. A revisao de 09/08/2026 achou que a doc ERRA no
// casing do `data.id` — ver o comentario de `validarAssinatura` em
// mercadopago.ts e os dois testes de vetor abaixo, que fecham essa lacuna.
const V1_VALIDO =
  "5bad78f1f0f10eb98d20496b6b8330f24a7469884503659db81991a37b30de40";

const agoraOk = (TS + 10) * 1000;

Deno.test("aceita assinatura valida", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok);
});

Deno.test("recusa segredo errado", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: "outro-segredo",
    agora: agoraOk,
  });
  assertEquals(ok, false);
});

Deno.test("recusa corpo adulterado com assinatura antiga", async () => {
  // Mesmo ts, mesmo v1, OUTRO pagamento: e' o ataque que a assinatura existe
  // para barrar — reaproveitar um header legitimo apontando para outro id.
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: "99999",
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assertEquals(ok, false);
});

Deno.test("recusa ts fora da tolerancia", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: (TS + 60 * 60) * 1000,
  });
  assertEquals(ok, false);
});

// Os dois testes abaixo existem porque a prova por mutacao da revisao de
// 09/08/2026 mostrou que a suite NAO pegava nem o casing do dataId nem o ramo
// condicional do request-id — as duas decisoes que o manifesto realmente toma.
// Sem eles, trocar toLowerCase por toUpperCase deixava os 5 testes verdes.
Deno.test("preserva o casing do dataId no manifesto", async () => {
  // Vetor gerado no Node sobre `id:AbC12;request-id:abc-123;ts:1700000000;`.
  //
  // O id e' MISTO de proposito. Um id todo maiusculo ("ABC12") nao serve
  // aqui: `"ABC12".toUpperCase()` e' ele mesmo, entao a mutacao que forca
  // maiusculas passaria despercebida e o teste so provaria metade do que
  // promete. Com "AbC12", QUALQUER normalizacao de caixa — toLowerCase ou
  // toUpperCase — muda o manifesto e derruba o teste. Medido em 09/08/2026,
  // depois de a primeira versao deste teste falhar exatamente por isso.
  const V1_MISTO =
    "eb23df430623adc6ed3593f4a4a5f0b2e275750ee790ab1bae37af4d2f5e9c78";
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_MISTO}`,
    xRequestId: REQUEST_ID,
    dataId: "AbC12",
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok, "id com caixa mista tem de validar com o casing preservado");
});

Deno.test("omite o segmento request-id quando o header nao veio", async () => {
  // Vetor gerado no Node sobre `id:12345;ts:1700000000;` — SEM request-id.
  const V1_SEM_REQUEST_ID =
    "0ada36b4ecda6b0e1d969a628e11b8a70430c3f77bc510fe9ad37fd2a713250c";
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_SEM_REQUEST_ID}`,
    xRequestId: null,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok);
});

Deno.test("recusa header ausente ou malformado", async () => {
  for (const xSignature of [null, "", "v1=semtimestamp", "ts=abc,v1=xyz", "lixo"]) {
    const ok = await validarAssinatura({
      xSignature,
      xRequestId: REQUEST_ID,
      dataId: DATA_ID,
      segredo: SEGREDO,
      agora: agoraOk,
    });
    assertEquals(ok, false, `deveria recusar: ${JSON.stringify(xSignature)}`);
  }
});

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
// Confirmado contra a documentacao do MP (context7, 09/08/2026): o formato
// do manifesto e o algoritmo batem com o assumido pelo plano. A unica
// divergencia encontrada foi que `data.id` alfanumerico entra em minusculas
// no manifesto — sem efeito neste vetor porque "12345" e numerico.
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

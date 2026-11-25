// @ts-nocheck
/**
 * Caça por mutação (25/11/2026, segunda rodada) nas funções PURAS exportadas de
 * `criar-pagamento/index.ts` (cobrança): o que sobrevivia a `index_test.ts` e às
 * outras suítes da pasta:
 *
 *   * a janela do vencimento do PIX (`expiracaoRealinhavel`): 1 milissegundo além do
 *     limite de 35 min NÃO vale (o teto é exato, não "mais ou menos"), e uma duração
 *     que não é de PIX (`PT3S`, vazia) NUNCA vira janela adivinhada;
 *   * a chave de idempotência (`chaveDeIdempotencia`): contador de tentativas que
 *     não é inteiro >= 0 (negativo, fracionado, texto, ausente) vale ZERO — a chave
 *     de antes, nunca uma chave nova que cobraria duas vezes ou um erro que trava o
 *     pagamento; zero e o primeiro inteiro positivo têm a forma certa nos dois meios;
 *   * o desafio 3DS do cartão: a janela é de 40 minutos (a constante e o resultado), um
 *     `expires_at` atual ilegível não impede a extensão (devolve a nova data, nunca
 *     `null`) e o teto absoluto conta da CRIAÇÃO do pedido;
 *   * o id do pedido (`pareceUuid`) aceita zero em qualquer posição;
 *   * as parcelas em texto do cartão: "07" vale 7, "007" (3 dígitos) é recusado.
 *
 * Valores escritos à mão; sem rede, sem banco.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  chaveDeIdempotencia,
  expiracaoParaDesafio3ds,
  expiracaoRealinhavel,
  MINUTOS_DESAFIO_3DS,
  pareceUuid,
  validarCorpoDoCartao,
} from "./index.ts";

const AGORA = new Date("2026-08-06T12:00:00.000Z");

// ─── a janela do vencimento do PIX ───────────────────────────────────────────

Deno.test("expiracaoRealinhavel: o teto é exato — 35 min vale, 35 min e 1 ms não, 35 min e 1 s não", () => {
  assertEquals(expiracaoRealinhavel("2026-08-06T12:35:00.000Z", AGORA, "PT30M")?.toISOString(), "2026-08-06T12:35:00.000Z");
  assertEquals(expiracaoRealinhavel("2026-08-06T12:35:00.001Z", AGORA, "PT30M"), null);
  assertEquals(expiracaoRealinhavel("2026-08-06T12:35:01.000Z", AGORA, "PT30M"), null);
});

Deno.test("expiracaoRealinhavel: o teto acompanha a duração pedida (PT2H = 120 min + 5 de margem = 125 min, exatos)", () => {
  assertEquals(expiracaoRealinhavel("2026-08-06T14:05:00.000Z", AGORA, "PT2H")?.toISOString(), "2026-08-06T14:05:00.000Z");
  assertEquals(expiracaoRealinhavel("2026-08-06T14:05:00.001Z", AGORA, "PT2H"), null);
});

Deno.test("expiracaoRealinhavel: duração que não é de PIX (segundos, vazia, texto) devolve null — nunca uma janela adivinhada", () => {
  for (const ruim of ["PT3S", "", "30", "pt30m", "P1D"]) {
    assertEquals(expiracaoRealinhavel("2026-08-06T12:00:30.000Z", AGORA, ruim), null, JSON.stringify(ruim));
  }
  assertEquals(expiracaoRealinhavel(null, AGORA, "PT30M"), null);
  assertEquals(expiracaoRealinhavel("", AGORA, "PT30M"), null);
});

// ─── a chave de idempotência ─────────────────────────────────────────────────

const ID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

Deno.test("chaveDeIdempotencia: contador que não é inteiro >= 0 vale ZERO (a chave de antes), no PIX e no cartão", async () => {
  for (const ruim of [-1, -0.5, 1.5, NaN, Infinity, "abc", {}, undefined]) {
    assertEquals(await chaveDeIdempotencia({ id: ID, tentativas_de_pagamento: ruim }, "pix"), ID, String(ruim));
    assertEquals(await chaveDeIdempotencia({ id: ID, tentativas_de_pagamento: ruim }, "cartao"), `${ID}:c0`, String(ruim));
  }
});

Deno.test("chaveDeIdempotencia: zero, um e três têm a forma certa (PIX: id puro no zero, id:N depois; cartão: id:cN sempre)", async () => {
  assertEquals(await chaveDeIdempotencia({ id: ID, tentativas_de_pagamento: 0 }, "pix"), ID);
  assertEquals(await chaveDeIdempotencia({ id: ID, tentativas_de_pagamento: 1 }, "pix"), `${ID}:1`);
  assertEquals(await chaveDeIdempotencia({ id: ID, tentativas_de_pagamento: "3" }, "pix"), `${ID}:3`);
  assertEquals(await chaveDeIdempotencia({ id: ID, tentativas_de_pagamento: 0 }, "cartao"), `${ID}:c0`);
  assertEquals(await chaveDeIdempotencia({ id: ID, tentativas_de_pagamento: 1 }, "cartao"), `${ID}:c1`);
  assertEquals(await chaveDeIdempotencia({ id: ID, tentativas_de_pagamento: "3" }, "cartao"), `${ID}:c3`);
});

// ─── parcelas em texto ───────────────────────────────────────────────────────

function corpoCartao(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    token: "ff8080814c11e237014c1ff593b57b4d",
    paymentMethodId: "master",
    paymentTypeId: "credit_card",
    parcelas: 3,
    documento: { type: "CPF", number: "12345678909" },
    ...extra,
  };
}

Deno.test("validarCorpoDoCartao: parcelas em texto de 1 ou 2 dígitos valem ('7', '07', '12'); de 3 dígitos ('007') ou vazio são recusados", () => {
  assertEquals(validarCorpoDoCartao(corpoCartao({ parcelas: "7" })).dados?.parcelas, 7);
  assertEquals(validarCorpoDoCartao(corpoCartao({ parcelas: "07" })).dados?.parcelas, 7);
  assertEquals(validarCorpoDoCartao(corpoCartao({ parcelas: "12" })).dados?.parcelas, 12);
  for (const ruim of ["007", "", "13", "0"]) {
    const r = validarCorpoDoCartao(corpoCartao({ parcelas: ruim }));
    assertEquals(r, { ok: false, erro: "Número de parcelas inválido." }, JSON.stringify(ruim));
  }
});

// ─── o desafio 3DS do cartão ─────────────────────────────────────────────────

Deno.test("expiracaoParaDesafio3ds: a janela é de 40 minutos exatos a partir de agora (pedido criado agora)", () => {
  assertEquals(MINUTOS_DESAFIO_3DS, 40);
  const r = expiracaoParaDesafio3ds(null, AGORA, AGORA.toISOString());
  assertEquals(r?.toISOString(), "2026-08-06T12:40:00.000Z");
});

Deno.test("expiracaoParaDesafio3ds: expires_at atual ilegível ('lixo') não impede a extensão — devolve a nova data, nunca null", () => {
  const r = expiracaoParaDesafio3ds("lixo", AGORA, AGORA.toISOString());
  assertEquals(r?.toISOString(), "2026-08-06T12:40:00.000Z");
});

Deno.test("expiracaoParaDesafio3ds: só estende — expires_at atual além dos 40 minutos fica como está (null); aquém é estendido", () => {
  assertEquals(expiracaoParaDesafio3ds("2026-08-06T12:50:00.000Z", AGORA, AGORA.toISOString()), null);
  assertEquals(expiracaoParaDesafio3ds("2026-08-06T12:40:00.000Z", AGORA, AGORA.toISOString()), null);
  assertEquals(
    expiracaoParaDesafio3ds("2026-08-06T12:30:00.000Z", AGORA, AGORA.toISOString())?.toISOString(),
    "2026-08-06T12:40:00.000Z",
  );
});

Deno.test("expiracaoParaDesafio3ds: o teto absoluto conta da CRIAÇÃO do pedido (criado há 30 min -> só 10 min de extensão)", () => {
  const r = expiracaoParaDesafio3ds("2026-08-06T12:05:00.000Z", AGORA, "2026-08-06T11:30:00.000Z");
  assertEquals(r?.toISOString(), "2026-08-06T12:10:00.000Z");
});

// ─── o id do pedido ──────────────────────────────────────────────────────────

Deno.test("pareceUuid: zero vale em QUALQUER posição de cada grupo; o que não é hexadecimal ou tem o tamanho errado não vale", () => {
  assertEquals(pareceUuid("00000000-0000-4000-8000-000000000000"), true);
  assertEquals(pareceUuid("a0000000-0a00-40a0-80a0-0000000000a0"), true);
  assertEquals(pareceUuid("3F2A1B8C-4D5E-4F60-9A7B-1C2D3E4F5A6B"), true);
  assertEquals(pareceUuid("00000000-0000-4000-8000-00000000000"), false);
  assertEquals(pareceUuid("00000000-0000-4000-8000-0000000000000"), false);
  assertEquals(pareceUuid("0000000g-0000-4000-8000-000000000000"), false);
  assertEquals(pareceUuid(null), false);
});

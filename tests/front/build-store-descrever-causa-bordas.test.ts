// scripts/buildStore.mjs — descreverCausa, as BORDAS numéricas da lavagem.
// tests/front/build-store-causa-do-erro.test.ts prova o caminho comum. Uma caça
// por mutação (plantar `>=` no lugar de `>` e ver se algum teste cai) achou três
// limites sem teste, e cada um deixa vazar ou perder informação do log da Vercel:
//
//   1. o valor de variável sensível com EXATAMENTE 8 caracteres tem de ser
//      lavado (o piso é "8 ou mais"), e o de 7 não — senão palavra curta e
//      comum vira "[oculto]" no meio da mensagem;
//   2. causa de EXATOS 400 caracteres sai inteira, sem reticências;
//   3. causa de 401 sai cortada nos PRIMEIROS 400 (não perde o começo) + "…".
import { describe, expect, it } from "vitest";
// @ts-expect-error Node entry é JavaScript nativo, sem declaração de tipos.
import { descreverCausa } from "../../scripts/buildStore.mjs";

describe("descreverCausa — bordas", () => {
  it("lava o valor sensível de exatos 8 caracteres e deixa o de 7 (piso é 8 ou mais)", () => {
    const env = { SERVICE_TOKEN: "abcd1234", API_KEY: "abcd123" };
    expect(descreverCausa(new Error("falhou com abcd1234 aqui"), env)).toBe(
      "falhou com [oculto] aqui",
    );
    expect(descreverCausa(new Error("falhou com abcd123 aqui"), env)).toBe(
      "falhou com abcd123 aqui",
    );
  });

  it("variável de nome NÃO sensível nunca é lavada, mesmo longa", () => {
    expect(
      descreverCausa(new Error("pasta cache-do-build-12345 cheia"), {
        PASTA_DE_CACHE: "cache-do-build-12345",
      }),
    ).toBe("pasta cache-do-build-12345 cheia");
  });

  it("causa de EXATOS 400 caracteres sai inteira, sem reticências", () => {
    const quatrocentos = `${"a ".repeat(199)}ab`;
    expect(quatrocentos).toHaveLength(400);
    expect(descreverCausa(new Error(quatrocentos), {})).toBe(quatrocentos);
  });

  it("causa de 401 caracteres é cortada nos PRIMEIROS 400 e ganha reticências", () => {
    const quatrocentosEUm = `${"a ".repeat(200)}b`;
    expect(quatrocentosEUm).toHaveLength(401);
    const saida = descreverCausa(new Error(quatrocentosEUm), {});
    expect(saida).toBe(`${"a ".repeat(200)}…`);
    expect(saida.startsWith("a a")).toBe(true);
  });
});

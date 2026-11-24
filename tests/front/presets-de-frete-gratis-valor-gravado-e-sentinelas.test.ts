// Presets do frete gratis — o NUMERO que a tela grava em `free_shipping_min`.
//
// O que protege (buracos achados por mutacao, 24/11/2026):
//  - "desligado" grava 0 (e so ele): outro numero ligaria o frete gratis sozinho.
//  - "acima de valor" com valor negativo grava 0, nunca o negativo: o -1 e a
//    sentinela de "por produto marcado", entao um negativo digitado viraria,
//    em silencio, OUTRA regra.
//  - a sentinela do "por produto" e exatamente -1: o servidor (RPC do pedido e
//    migration) le esse literal; trocar o numero aqui desencontra tela x servidor.
//  - o valor de frete e arredondado para o centavo MAIS PROXIMO (nem para cima,
//    nem para baixo): "49.999" grava 50,00, "10.004" grava 10,00.
import {
  FRETE_GRATIS_POR_PRODUTO,
  FRETE_GRATIS_SEMPRE,
  presetDoConfig,
  valorDeFreteEmCentavos,
  valorDoPreset,
} from "@/lib/presets-de-frete-gratis";
import { describe, expect, it } from "vitest";

describe("valorDoPreset: o que cada escolha grava", () => {
  it("desligado grava exatamente 0, mesmo com um 'acima de' esquecido na tela", () => {
    expect(valorDoPreset("desligado", 0)).toBe(0);
    expect(valorDoPreset("desligado", 150)).toBe(0);
  });

  it("acima de valor com numero negativo grava 0, e nao o negativo (que viraria 'por produto')", () => {
    expect(valorDoPreset("acima_de_valor", -5)).toBe(0);
    expect(valorDoPreset("acima_de_valor", -1)).toBe(0);
    // O resultado, lido de volta, e "desligado" — nunca "por_produto".
    expect(presetDoConfig(valorDoPreset("acima_de_valor", -5))).toBe(
      "desligado",
    );
  });

  it("acima de valor positivo grava o valor como esta", () => {
    expect(valorDoPreset("acima_de_valor", 150)).toBe(150);
    expect(valorDoPreset("acima_de_valor", 49.9)).toBe(49.9);
  });

  it("o que a tela grava volta como o MESMO preset ao ler", () => {
    expect(presetDoConfig(valorDoPreset("sempre", 99))).toBe("sempre");
    expect(presetDoConfig(valorDoPreset("por_produto", 99))).toBe(
      "por_produto",
    );
    expect(presetDoConfig(valorDoPreset("desligado", 99))).toBe("desligado");
    expect(presetDoConfig(valorDoPreset("acima_de_valor", 99))).toBe(
      "acima_de_valor",
    );
  });
});

describe("sentinelas do config (contrato com o servidor)", () => {
  it("'por produto' e -1 e 'sempre' e 0,01 — os literais que o servidor le", () => {
    expect(FRETE_GRATIS_POR_PRODUTO).toBe(-1);
    expect(FRETE_GRATIS_SEMPRE).toBe(0.01);
  });
});

describe("valorDeFreteEmCentavos: arredonda para o centavo mais proximo", () => {
  it("fracao abaixo de meio centavo cai (nao sobe)", () => {
    expect(valorDeFreteEmCentavos(10.004)).toBe(10);
    expect(valorDeFreteEmCentavos(49.991)).toBe(49.99);
  });

  it("fracao acima de meio centavo sobe (nao cai)", () => {
    expect(valorDeFreteEmCentavos(10.006)).toBe(10.01);
    expect(valorDeFreteEmCentavos(49.999)).toBe(50);
  });

  it("valor ja em centavos nao muda", () => {
    expect(valorDeFreteEmCentavos(49.9)).toBe(49.9);
    expect(valorDeFreteEmCentavos(0)).toBe(0);
  });
});

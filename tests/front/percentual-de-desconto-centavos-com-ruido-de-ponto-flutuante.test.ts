// O selo "% OFF" faz a conta em CENTAVOS INTEIROS (`percentual-de-desconto.ts`).
// Em ponto flutuante, vários preços comuns não são exatos quando multiplicados
// por 100: 10,2 * 100 = 1019.9999999999999, 10,05 * 100 = 1004.9999999999999 e
// 8,2 * 100 = 819.9999999999999. Se a conversão para centavos TRUNCASSE (em vez
// de arredondar), o preço sairia 1 centavo menor e o selo anunciaria um
// percentual diferente do que a cliente paga: "-21%" onde o desconto de verdade
// é 22%. Os valores esperados abaixo foram calculados à mão em centavos
// inteiros -- ((De - Por) * 100 / De, meio por cento para cima) --, nunca pela
// própria função.
import { describe, expect, it } from "vitest";

import { percentualDeDesconto } from "@/lib/percentual-de-desconto";

describe("percentualDeDesconto — o ruído do ponto flutuante não mexe no selo", () => {
  it.each([
    // [De, Por, esperado, a conta em centavos]
    [10.2, 8, 22, "(1020 - 800) * 100 / 1020 = 21,57"],
    [10.2, 7.7, 25, "(1020 - 770) * 100 / 1020 = 24,51"],
    [16.15, 13.8, 15, "(1615 - 1380) * 100 / 1615 = 14,55"],
  ])(
    "De %s por %s: o 'De' em centavos exatos dá %s%% (%s)",
    (original, atual, esperado) => {
      expect(percentualDeDesconto(original, atual)).toBe(esperado);
    },
  );

  it.each([
    [10.05, 8.2, 18, "(1005 - 820) * 100 / 1005 = 18,41"],
    [10.05, 9.7, 3, "(1005 - 970) * 100 / 1005 = 3,48"],
    [10.1, 9.45, 6, "(1010 - 945) * 100 / 1010 = 6,44"],
  ])(
    "De %s por %s: o 'Por' em centavos exatos dá %s%% (%s)",
    (original, atual, esperado) => {
      expect(percentualDeDesconto(original, atual)).toBe(esperado);
    },
  );

  it("a conta é a mesma com o preço escrito dos dois jeitos de ponto flutuante", () => {
    // 0,1 + 0,2 = 0.30000000000000004 e 0,3 é 0.3: o mesmo preço de 30 centavos
    // tem de dar o mesmo selo.
    expect(percentualDeDesconto(0.1 + 0.2, 0.15)).toBe(
      percentualDeDesconto(0.3, 0.15),
    );
    expect(percentualDeDesconto(0.3, 0.15)).toBe(50);
  });
});

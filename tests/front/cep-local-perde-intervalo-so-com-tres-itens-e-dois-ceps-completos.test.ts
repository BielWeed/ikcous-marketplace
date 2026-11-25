// Achado por mutação, 25/11/2026: `perdeIntervaloDeCepLocal` só tinha cobertura
// indireta (um teste de tela que digita UMA faixa), e `=== 8` -> `>= 8` passava
// verde. O aviso do painel "com três ou mais itens, os dois primeiros CEPs
// completos deixam de indicar uma faixa" tem que aparecer exatamente quando o
// banco muda de leitura: 3+ itens E os DOIS primeiros são CEPs completos de 8
// dígitos soltos. Aviso a mais assusta a lojista à toa; aviso a menos a deixa
// sem entrega local sem saber por quê.
import { perdeIntervaloDeCepLocal } from "@/lib/cep-local";
import { describe, expect, it } from "vitest";

describe("perdeIntervaloDeCepLocal — quando a faixa dos dois primeiros CEPs se desfaz", () => {
  it("três itens e os dois primeiros são CEPs completos: avisa", () => {
    expect(perdeIntervaloDeCepLocal("01310100, 01310200, 01310300")).toBe(true);
    expect(perdeIntervaloDeCepLocal("01310-100, 01310-200, 01310-300")).toBe(
      true,
    );
  });

  it("só os DOIS primeiros contam: o terceiro pode ser prefixo curto", () => {
    expect(perdeIntervaloDeCepLocal("01310100, 01310200, 013")).toBe(true);
  });

  it("dois itens é a faixa de dois CEPs (formato do placeholder): não avisa", () => {
    expect(perdeIntervaloDeCepLocal("01310100, 01310200")).toBe(false);
    expect(perdeIntervaloDeCepLocal("01310100")).toBe(false);
    expect(perdeIntervaloDeCepLocal("")).toBe(false);
  });

  it("item vazio (vírgula sobrando) não conta como item", () => {
    expect(perdeIntervaloDeCepLocal("01310100, 01310200, ")).toBe(false);
    expect(perdeIntervaloDeCepLocal("01310100,, 01310200,")).toBe(false);
    expect(perdeIntervaloDeCepLocal(",01310100, 01310200, 01310300")).toBe(
      true,
    );
  });

  it("primeiros itens com 9 dígitos, ou com 6 ou 7, não são CEPs completos: não avisa", () => {
    expect(perdeIntervaloDeCepLocal("013101000, 013101001, 01310300")).toBe(
      false,
    );
    expect(perdeIntervaloDeCepLocal("013102, 013103, 01310300")).toBe(false);
    expect(perdeIntervaloDeCepLocal("0131020, 0131030, 01310300")).toBe(false);
  });

  it("um dos dois primeiros incompleto basta para não avisar", () => {
    expect(perdeIntervaloDeCepLocal("01310100, 013, 01310300")).toBe(false);
    expect(perdeIntervaloDeCepLocal("013, 01310200, 01310300")).toBe(false);
  });

  it("intervalo explícito entre os dois primeiros itens não perde nada: não avisa", () => {
    expect(
      perdeIntervaloDeCepLocal("01310100-01310200, 01310300, 01310400"),
    ).toBe(false);
  });
});

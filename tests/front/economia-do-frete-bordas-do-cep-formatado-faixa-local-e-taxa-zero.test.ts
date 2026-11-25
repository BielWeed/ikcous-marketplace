// Bordas da regra "quanto o cliente economizou de frete" que a tabela principal
// (`economia-do-frete-regra-pura.test.ts`) não prendia — caça por mutação,
// 25/11/2026. Cada caso derruba um defeito de uma linha:
//  - CEP FORMATADO e ainda incompleto ("01310-10": 8 caracteres, 7 dígitos) é
//    digitação em curso: nunca vira cotação real (gasta cota e suja o Histórico
//    de Cotações da lojista). O tamanho conta DÍGITOS, não caracteres;
//  - a faixa de CEP local configurada decide "local" mesmo quando o CEP de
//    entrega não começa igual ao da loja;
//  - taxa de entrega local de R$ 0 (entrega própria gratuita) é uma taxa
//    CONFIGURADA: devolve `local` com valor 0, não "zero" como se faltasse.
import { modoDeEconomiaDoFrete } from "@/lib/economia-do-frete";
import { FRETE_GRATIS_SEMPRE } from "@/lib/presets-de-frete-gratis";
import { describe, expect, it } from "vitest";

function base(): Parameters<typeof modoDeEconomiaDoFrete>[0] {
  return {
    freteGratis: true,
    cepDeEntrega: "01310100",
    temUsuario: true,
    originCep: "38500000",
    localCepRange: undefined,
    localDeliveryFee: 12.9,
    freeShippingMin: FRETE_GRATIS_SEMPRE,
  };
}

describe("CEP de entrega formatado", () => {
  it("'01310-10' (7 dígitos) ainda é digitação: zero, nunca cotar", () => {
    expect(
      modoDeEconomiaDoFrete({ ...base(), cepDeEntrega: "01310-10" }),
    ).toEqual({ tipo: "zero" });
  });

  it("'01310-100' (8 dígitos) já é um CEP: logada fora da cidade cota", () => {
    expect(
      modoDeEconomiaDoFrete({ ...base(), cepDeEntrega: "01310-100" }),
    ).toEqual({ tipo: "cotar" });
  });

  it("CEP local formatado completo vale como local", () => {
    expect(
      modoDeEconomiaDoFrete({ ...base(), cepDeEntrega: "38500-123" }),
    ).toEqual({ tipo: "local", valor: 12.9 });
  });
});

describe("faixa de CEP local configurada", () => {
  it("CEP dentro da faixa, com prefixo diferente da loja, é entrega local", () => {
    expect(
      modoDeEconomiaDoFrete({
        ...base(),
        localCepRange: "38600000-38605000",
        cepDeEntrega: "38601000",
      }),
    ).toEqual({ tipo: "local", valor: 12.9 });
  });

  it("CEP fora da faixa continua fora da cidade (logada: cotar)", () => {
    expect(
      modoDeEconomiaDoFrete({
        ...base(),
        localCepRange: "38600000-38605000",
        cepDeEntrega: "38700000",
      }),
    ).toEqual({ tipo: "cotar" });
  });
});

describe("taxa de entrega local", () => {
  it("taxa configurada em R$ 0 devolve local com valor 0", () => {
    expect(
      modoDeEconomiaDoFrete({
        ...base(),
        cepDeEntrega: "38500123",
        localDeliveryFee: 0,
      }),
    ).toEqual({ tipo: "local", valor: 0 });
  });

  it("taxa ausente nunca vira valor chutado: zero", () => {
    expect(
      modoDeEconomiaDoFrete({
        ...base(),
        cepDeEntrega: "38500123",
        localDeliveryFee: undefined,
      }),
    ).toEqual({ tipo: "zero" });
  });
});

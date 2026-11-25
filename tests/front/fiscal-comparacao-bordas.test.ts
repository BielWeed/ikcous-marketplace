// Gestão Fiscal, caça por mutação: a comparação "estimativa do app x guia lançada" na
// virada do ano e no arredondamento do percentual.
//
// O que cada teste protege (em português simples):
//   - os 3 meses mais recentes cruzam a virada de dezembro para janeiro e deixam o mais
//     antigo de fora, seja qual for a ordem em que a lista chegou;
//   - meio por cento arredonda para cima dos dois lados (+0,5% e -0,5% dão "1%"), e
//     menos que isso é "praticamente igual";
//   - estimativa zero com guia lançada vale (é -100%); guia zero não entra;
//   - o percentual é a média dos percentuais de cada mês, e não a razão das somas.
//
// Valores à mão. Ex.: (110 - 100) / 100 = +10%; (120 - 100) / 100 = +20%; média = 20%.
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import {
  type MesParaComparar,
  compararEstimativaComGuia,
} from "@/lib/fiscal/comparacao";

const mes = (
  m: string,
  estimativa: number | null,
  guia: number | null,
): MesParaComparar => ({ mes: m, estimativa, guia });

describe("compararEstimativaComGuia: a janela de 3 meses na virada do ano", () => {
  const LISTA = [
    mes("2026-10", 1_000, 100), // +900%: o mais antigo, tem de ficar de fora
    mes("2026-11", 110, 100), // +10%
    mes("2026-12", 120, 100), // +20%
    mes("2027-01", 130, 100), // +30%
  ];

  it("dezembro e janeiro entram juntos, e o mais antigo (outubro) cai: média de +10, +20 e +30 = 20% acima", () => {
    expect(compararEstimativaComGuia(LISTA)).toEqual({
      percentual: 20,
      sentido: "acima",
      meses: 3,
      frase:
        "Nas 3 últimas guias lançadas, a estimativa do app ficou 20% acima da guia.",
    });
  });

  it("a ordem em que a lista chega não muda nada", () => {
    const embaralhada = [LISTA[2], LISTA[0], LISTA[3], LISTA[1]].filter(
      (m): m is MesParaComparar => m !== undefined,
    );
    expect(compararEstimativaComGuia(embaralhada)).toEqual(
      compararEstimativaComGuia(LISTA),
    );
  });

  it("só dois meses, atravessando o ano: média dos dois", () => {
    // dezembro +50%, janeiro -10%: média +20%
    expect(
      compararEstimativaComGuia([
        mes("2027-01", 90, 100),
        mes("2026-12", 150, 100),
      ]),
    ).toEqual({
      percentual: 20,
      sentido: "acima",
      meses: 2,
      frase:
        "Nas 2 últimas guias lançadas, a estimativa do app ficou 20% acima da guia.",
    });
  });

  it("um mês só: a frase fala da última guia, no singular", () => {
    expect(compararEstimativaComGuia([mes("2026-12", 80, 100)])).toEqual({
      percentual: -20,
      sentido: "abaixo",
      meses: 1,
      frase:
        "Na última guia lançada, a estimativa do app ficou 20% abaixo da guia.",
    });
  });
});

describe("compararEstimativaComGuia: arredondamento do percentual", () => {
  it.each([
    [100.5, 1, "acima"], // +0,5% sobe para 1%
    [99.5, -1, "abaixo"], // -0,5% também vai para 1% (longe do zero)
    [100.49, 0, "igual"], // +0,49% arredonda para 0
    [99.51, 0, "igual"], // -0,49%
    [100.01, 0, "igual"], // um centavo de diferença
    [101.5, 2, "acima"], // +1,5% sobe para 2%
    [98.5, -2, "abaixo"],
  ])(
    "estimativa %f contra guia de 100: %i%%, %s",
    (estimativa, percentual, sentido) => {
      const r = compararEstimativaComGuia([mes("2026-10", estimativa, 100)]);
      expect(r?.percentual).toBe(percentual);
      expect(Object.is(r?.percentual, -0)).toBe(false);
      expect(r?.sentido).toBe(sentido);
    },
  );

  it("'praticamente igual' não fala em porcentagem nem em acima ou abaixo", () => {
    const r = compararEstimativaComGuia([mes("2026-10", 100.01, 100)]);
    expect(r?.frase).toBe(
      "Na última guia lançada, a estimativa do app ficou praticamente igual à guia.",
    );
  });
});

describe("compararEstimativaComGuia: zero, vazio e mês repetido", () => {
  it("estimativa R$ 0 com guia lançada vale: é 100% abaixo", () => {
    const r = compararEstimativaComGuia([mes("2026-10", 0, 100)]);
    expect(r).toEqual({
      percentual: -100,
      sentido: "abaixo",
      meses: 1,
      frase:
        "Na última guia lançada, a estimativa do app ficou 100% abaixo da guia.",
    });
  });

  it("guia R$ 0 ou ausente não entra: sem nenhum mês completo, nada a dizer (null)", () => {
    expect(
      compararEstimativaComGuia([
        mes("2026-10", 100, 0),
        mes("2026-11", 100, null),
        mes("2026-12", null, 100),
      ]),
    ).toBeNull();
  });

  it("lista vazia: null", () => {
    expect(compararEstimativaComGuia([])).toBeNull();
  });

  it("a média é a dos percentuais de cada mês, não a razão das somas", () => {
    // +50% e +10%: média 30%. (Pela razão das somas seria 1.250 / 1.100 = +13,6%.)
    const r = compararEstimativaComGuia([
      mes("2026-10", 150, 100),
      mes("2026-11", 1_100, 1_000),
    ]);
    expect(r?.percentual).toBe(30);
  });

  it("mês repetido sai da conta, mesmo quando os dois valores são iguais", () => {
    const r = compararEstimativaComGuia([
      mes("2026-10", 110, 100),
      mes("2026-10", 110, 100),
      mes("2026-11", 120, 100),
    ]);
    expect(r?.meses).toBe(1);
    expect(r?.percentual).toBe(20);
  });

  it("mês com formato torto (2026-13, 2026-1) não entra", () => {
    const r = compararEstimativaComGuia([
      mes("2026-13", 500, 100),
      mes("2026-1", 500, 100),
      mes("2026-10", 110, 100),
    ]);
    expect(r?.meses).toBe(1);
    expect(r?.percentual).toBe(10);
  });

  it("valor em centavos quebrados é comparado em centavos: 0,1 + 0,2 não suja o resultado", () => {
    // estimativa 0,30 contra guia 0,30: exatamente igual
    const r = compararEstimativaComGuia([mes("2026-10", 0.1 + 0.2, 0.3)]);
    expect(r?.sentido).toBe("igual");
    expect(r?.percentual).toBe(0);
  });
});

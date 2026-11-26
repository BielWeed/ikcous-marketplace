// `compararValores` (ordem dos chips de tamanho, na loja e no painel): a escada
// de tamanhos INTEIRA, posição por posição. Os testes vizinhos provam trechos
// ("P, M, G", "PP antes de P"); uma posição da tabela que andasse para o degrau
// do vizinho só mudaria o desempate pelo texto e passaria despercebida. Aqui a
// lista toda, embaralhada de trás para frente, tem de sair na ordem da tabela:
//
//  - o mesmo degrau empata e o texto desempata (PP e XS; P e S; G e L; ...);
//  - tamanho de letra vem antes de número ("M" antes de "1"), e número fora do
//    padrão de dígito na frente ("-5", ".5") cai no "resto", depois dos números.
import { compararValores } from "@/utils/fileiras-de-variacao";
import { describe, expect, it } from "vitest";

const ordenar = (valores: string[]): string[] =>
  [...valores].sort(compararValores);

describe("compararValores — a escada de tamanhos inteira", () => {
  const NA_ORDEM = [
    "XXS",
    "PP",
    "XS",
    "P",
    "S",
    "M",
    "G",
    "L",
    "GG",
    "XG",
    "XL",
    "EXG",
    "XGG",
    "XXG",
    "XXL",
    "EXGG",
    "XXXG",
    "XXXL",
  ];

  it("a lista toda, de trás para frente, volta na ordem da tabela", () => {
    expect(ordenar([...NA_ORDEM].reverse())).toEqual(NA_ORDEM);
  });

  it("e a mesma lista numa ordem embaralhada fixa", () => {
    const embaralhada = [
      "G",
      "XXXL",
      "PP",
      "XL",
      "S",
      "EXGG",
      "M",
      "XXS",
      "GG",
      "XXG",
      "L",
      "XS",
      "XG",
      "P",
      "XXL",
      "EXG",
      "XXXG",
      "XGG",
    ];
    expect(ordenar(embaralhada)).toEqual(NA_ORDEM);
  });

  it("não depende de caixa nem de acento: 'xxs' vem antes de 'Pp'", () => {
    expect(ordenar(["Pp", "xxs"])).toEqual(["xxs", "Pp"]);
  });
});

describe("compararValores — letra, número e o resto", () => {
  it("tamanho de letra vem antes de número, mesmo número pequeno ('1' depois de 'XXL')", () => {
    expect(ordenar(["1", "XXL"])).toEqual(["XXL", "1"]);
    expect(ordenar(["2", "M"])).toEqual(["M", "2"]);
  });

  it("'Único' fica depois do resto (cores), que fica depois dos números", () => {
    expect(ordenar(["Único", "Azul", "36", "M"])).toEqual([
      "M",
      "36",
      "Azul",
      "Único",
    ]);
  });

  it("'Único' vai para o fim mesmo quando o texto o poria antes de outra cor", () => {
    // Por ordem alfabética "Único" viria antes de "Verde"; só o grupo próprio
    // o põe por último. O mesmo vale para "U" e "Tamanho Único".
    expect(ordenar(["Único", "Verde", "Azul"])).toEqual([
      "Azul",
      "Verde",
      "Único",
    ]);
    expect(ordenar(["U", "Zebra"])).toEqual(["Zebra", "U"]);
    expect(ordenar(["Tamanho Único", "Zebra"])).toEqual([
      "Zebra",
      "Tamanho Único",
    ]);
  });

  it("texto que só PARECE número ('-5', '.5') não entra no grupo dos números", () => {
    expect(ordenar(["-5", "10"])).toEqual(["10", "-5"]);
    expect(ordenar([".5", "10"])).toEqual(["10", ".5"]);
  });
});

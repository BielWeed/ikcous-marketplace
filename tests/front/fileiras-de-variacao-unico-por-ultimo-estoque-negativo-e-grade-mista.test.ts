// Quatro regras das fileiras de variação (o que a cliente vê ao escolher
// tamanho e cor) que os testes de fileiras já existentes não prendiam. Cada uma
// foi achada tirando a regra do código e vendo a suíte inteira continuar verde:
//
//  1. "Único" (e "U", "Tamanho único") vai SEMPRE para o fim. O teste antigo só
//     comparava com números, e o grupo dos números já fica antes de qualquer
//     jeito — a regra podia sumir sem ninguém notar, e "Único" apareceria no
//     meio das cores, em ordem alfabética.
//  2. Estoque NEGATIVO gravado numa linha não desconta das outras: a cor com
//     5 peças numa combinação e -3 em outra continua mostrando 5 (e não "2
//     peças", que a cliente leria como pouca coisa e desistiria).
//  3. Grade com mais de 3 atributos não é desmontada em fileiras: fica como um
//     grupo só, com o nome cru, igual ao que o painel gravou.
//  4. Linha legada (um atributo só) misturada com linhas compostas impede
//     desmontar a grade: senão a linha legada sumiria dentro da fileira da cor.
import type { ProductVariant } from "@/types";
import {
  compararValores,
  fileirasDeVariacao,
  ordenarVariantesDoPainel,
} from "@/utils/fileiras-de-variacao";
import { describe, expect, it } from "vitest";

const linha = (
  id: string,
  name: string,
  value: string,
  stockIncrement = 2,
): ProductVariant => ({
  id,
  productId: "produto",
  name,
  value,
  stockIncrement,
  active: true,
});

describe("'Único' fica sempre depois dos outros valores", () => {
  it.each(["Único", "único", "UNICO", "U", "Tamanho Único"])(
    "'%s' vem depois de um valor de texto que começa com letra mais adiante no alfabeto",
    (unico) => {
      expect(compararValores(unico, "Zinco")).toBeGreaterThan(0);
      expect(compararValores("Zinco", unico)).toBeLessThan(0);
    },
  );

  it("na fileira de Tamanho, 'Único' vem depois do último valor de texto", () => {
    const { fileiras } = fileirasDeVariacao([
      linha("a", "Tamanho", "Único"),
      linha("b", "Tamanho", "Vermelho"),
      linha("c", "Tamanho", "Azul"),
    ]);

    expect(fileiras[0].valores.map((v) => v.valor)).toEqual([
      "Azul",
      "Vermelho",
      "Único",
    ]);
  });
});

describe("estoque negativo gravado numa linha", () => {
  it("não desconta o estoque que a mesma cor tem em outra combinação", () => {
    const { fileiras } = fileirasDeVariacao([
      linha("azul-p", "Cor / Tamanho", "Azul / P", 5),
      linha("azul-m", "Cor / Tamanho", "Azul / M", -3),
    ]);

    const azul = fileiras
      .find((f) => f.nome === "Cor")
      ?.valores.find((v) => v.valor === "Azul");
    expect(azul?.estoque).toBe(5);
    expect(azul?.disponivel).toBe(true);
  });

  it("valor só com estoque negativo aparece com 0, esgotado", () => {
    const { fileiras } = fileirasDeVariacao([
      linha("verde-p", "Cor / Tamanho", "Verde / P", -4),
    ]);

    const verde = fileiras
      .find((f) => f.nome === "Cor")
      ?.valores.find((v) => v.valor === "Verde");
    expect(verde?.estoque).toBe(0);
    expect(verde?.disponivel).toBe(false);
  });
});

describe("limite de atributos da grade", () => {
  it("com 3 atributos a grade é desmontada em 3 fileiras", () => {
    const { fileiras } = fileirasDeVariacao([
      linha("a", "Cor / Tamanho / Estampa", "Azul / P / Lisa"),
    ]);

    expect(fileiras.map((f) => f.nome).sort()).toEqual([
      "Cor",
      "Estampa",
      "Tamanho",
    ]);
  });

  it("com 4 atributos a grade NÃO é desmontada: um grupo só, com o nome cru", () => {
    const { fileiras } = fileirasDeVariacao([
      linha(
        "a",
        "Cor / Tamanho / Estampa / Material",
        "Azul / P / Lisa / Seda",
      ),
    ]);

    expect(fileiras.map((f) => f.nome)).toEqual([
      "Cor / Tamanho / Estampa / Material",
    ]);
    expect(fileiras[0].valores.map((v) => v.valor)).toEqual([
      "Azul / P / Lisa / Seda",
    ]);
  });
});

describe("linha legada junto de linhas compostas", () => {
  it("a grade não é desmontada: a linha de um atributo só continua inteira", () => {
    const { fileiras } = fileirasDeVariacao([
      linha("composta", "Cor / Tamanho", "Azul / P", 2),
      linha("legada", "Cor", "Verde", 3),
    ]);

    expect(fileiras.map((f) => f.nome).sort()).toEqual([
      "Cor",
      "Cor / Tamanho",
    ]);
    const cor = fileiras.find((f) => f.nome === "Cor");
    expect(cor?.valores.map((v) => v.valor)).toEqual(["Verde"]);
    const composta = fileiras.find((f) => f.nome === "Cor / Tamanho");
    expect(composta?.valores.map((v) => v.valor)).toEqual(["Azul / P"]);
  });
});

describe("lista de variações do painel com dois nomes de atributo do mesmo peso", () => {
  it("desempata pelo nome do atributo, não pelo valor que cada um guarda", () => {
    const ordenadas = ordenarVariantesDoPainel([
      linha("material", "Material", "Algodão"),
      linha("estampa", "Estampa", "Zebra"),
    ]);

    expect(ordenadas.map((v) => v.id)).toEqual(["estampa", "material"]);
  });
});

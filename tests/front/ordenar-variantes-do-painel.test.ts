import type { ProductVariant } from "@/types";
// A lista de Variações do painel vinha na ordem em que o banco devolvia (sem
// ORDER BY): a linha vendida ou editada pulava para o fim. O painel passa a
// ordenar com a mesma régua da loja: P-M-G, números, o resto, "Único".
import { ordenarVariantesDoPainel } from "@/utils/fileiras-de-variacao";
import { describe, expect, it } from "vitest";

const variante = (id: string, name: string, value: string): ProductVariant => ({
  id,
  productId: "p-1",
  name,
  value,
  stockIncrement: 1,
  active: true,
});

const valores = (lista: ProductVariant[]) => lista.map((v) => v.value);

describe("ordenarVariantesDoPainel", () => {
  it("tamanhos seguem a escada da loja, não a ordem em que vieram", () => {
    const vindas = [
      variante("a", "Tamanho", "GG"),
      variante("b", "Tamanho", "P"),
      variante("c", "Tamanho", "G"),
      variante("d", "Tamanho", "M"),
    ];
    expect(valores(ordenarVariantesDoPainel(vindas))).toEqual([
      "P",
      "M",
      "G",
      "GG",
    ]);
  });

  it("números por valor (36 antes de 110), 'Único' por último, cores por nome", () => {
    expect(
      valores(
        ordenarVariantesDoPainel([
          variante("a", "Número", "110"),
          variante("b", "Número", "Único"),
          variante("c", "Número", "36"),
        ]),
      ),
    ).toEqual(["36", "110", "Único"]);
    expect(
      valores(
        ordenarVariantesDoPainel([
          variante("a", "Cor", "Vermelho"),
          variante("b", "Cor", "Azul"),
        ]),
      ),
    ).toEqual(["Azul", "Vermelho"]);
  });

  it("grade composta (Tamanho / Cor): ordena por tamanho e depois por cor", () => {
    const vindas = [
      variante("a", "Tamanho / Cor", "M / Azul"),
      variante("b", "Tamanho / Cor", "P / Verde"),
      variante("c", "Tamanho / Cor", "P / Azul"),
      variante("d", "Tamanho / Cor", "G / Azul"),
    ];
    expect(valores(ordenarVariantesDoPainel(vindas))).toEqual([
      "P / Azul",
      "P / Verde",
      "M / Azul",
      "G / Azul",
    ]);
  });

  it("cadastro antigo com Cor e Tamanho em linhas separadas: Tamanho vem antes da Cor, como na loja", () => {
    const vindas = [
      variante("a", "Cor", "Azul"),
      variante("b", "Tamanho", "G"),
      variante("c", "Tamanho", "P"),
    ];
    expect(valores(ordenarVariantesDoPainel(vindas))).toEqual([
      "P",
      "G",
      "Azul",
    ]);
  });

  it("empate total preserva a ordem de chegada (sort estável) e não muda a lista original", () => {
    const vindas = [
      variante("x2", "Cor", "Azul"),
      variante("x1", "Cor", "Azul"),
    ];
    const copia = [...vindas];
    expect(ordenarVariantesDoPainel(vindas).map((v) => v.id)).toEqual([
      "x2",
      "x1",
    ]);
    expect(vindas).toEqual(copia);
  });
});

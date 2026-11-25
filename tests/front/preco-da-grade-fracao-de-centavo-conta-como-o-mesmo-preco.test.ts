// "Igual ao menor" na grade é igualdade em CENTAVOS ARREDONDADOS (o banco
// guarda numeric(10,2)): 49,904 vira 49,90 e segue o produto (Auto); 49,906
// vira 49,91 e continua preço próprio. Se o arredondamento trocar de `round`
// para `ceil`, 49,904 deixaria de seguir o produto, e a linha ficaria com um
// "preço próprio" que na prática é o mesmo — nenhum teste usava fração de
// centavo.
import { describe, expect, it } from "vitest";

import { resolverPrecoDaGrade } from "@/utils/preco-da-grade";

describe("resolverPrecoDaGrade — fração de centavo", () => {
  it("linha com fração de centavo que arredonda para baixo até o menor vira Auto", () => {
    const r = resolverPrecoDaGrade("", ["49.9", "49.904"]);

    expect(r.precoDoProduto).toBe(49.9);
    expect(r.precos).toEqual([undefined, undefined]);
  });

  it("linha cuja fração arredonda para cima, para um centavo acima do menor, mantém o preço próprio", () => {
    const r = resolverPrecoDaGrade("", ["49.9", "49.906"]);

    expect(r.precoDoProduto).toBe(49.9);
    expect(r.precos).toEqual([undefined, 49.906]);
  });

  it("0,29 e 0,2900001 são o mesmo preço em centavos (o 0,29 em ponto flutuante é 28,999...)", () => {
    const r = resolverPrecoDaGrade("", ["0.29", "0.2900001"]);

    expect(r.precoDoProduto).toBe(0.29);
    expect(r.precos).toEqual([undefined, undefined]);
  });
});

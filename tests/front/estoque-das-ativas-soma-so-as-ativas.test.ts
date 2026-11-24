// O estoque que a vitrine e a página do produto mostram para um produto com
// variações é a SOMA do estoque das variações ATIVAS. Sem nenhuma variação
// ativa, o produto vende pelo estoque de base (é assim que o servidor vende) --
// nunca por uma soma que daria 0 e esconderia um produto à venda.
//
// A função não tinha teste próprio. Os limites que ele fixa:
//   - todas desligadas  -> estoque de base (e não 0);
//   - ao menos uma ativa -> soma só das ativas, MESMO que a soma dê 0
//     (variação ativa esgotada não "ressuscita" o estoque de base);
//   - a variação desligada nunca entra na soma;
//   - valor de estoque ilegível (NaN, texto solto) conta 0, não estraga a soma.
import { describe, expect, it } from "vitest";

import { estoqueDasAtivas } from "@/lib/estoque-das-ativas";
import type { ProductVariant } from "@/types";

function variacao(id: string, estoque: number, active = true): ProductVariant {
  return {
    id,
    productId: "p-1",
    name: "Tamanho",
    value: id,
    stockIncrement: estoque,
    active,
  };
}

describe("estoqueDasAtivas", () => {
  it("sem nenhuma variação vale o estoque de base", () => {
    expect(estoqueDasAtivas([], 7)).toBe(7);
  });

  it("com todas as variações desligadas vale o estoque de base, não 0", () => {
    const todasDesligadas = [variacao("p", 3, false), variacao("m", 4, false)];
    expect(estoqueDasAtivas(todasDesligadas, 7)).toBe(7);
  });

  it("com variações ativas vale a soma delas, e o estoque de base é ignorado", () => {
    expect(estoqueDasAtivas([variacao("p", 3), variacao("m", 4)], 99)).toBe(7);
  });

  it("a variação desligada não entra na soma", () => {
    const grade = [variacao("p", 3), variacao("m", 4, false), variacao("g", 5)];
    expect(estoqueDasAtivas(grade, 99)).toBe(8);
  });

  it("variação ativa esgotada mantém 0: não volta ao estoque de base", () => {
    expect(estoqueDasAtivas([variacao("p", 0)], 99)).toBe(0);
    // Uma ativa esgotada e outra desligada com estoque: ainda é 0.
    expect(
      estoqueDasAtivas([variacao("p", 0), variacao("m", 6, false)], 99),
    ).toBe(0);
  });

  it("estoque ilegível de uma variação conta 0 e não estraga a soma das outras", () => {
    const ilegivel = {
      ...variacao("x", 0),
      stockIncrement: Number.NaN,
    };
    const emTexto = {
      ...variacao("y", 0),
      stockIncrement: "2" as unknown as number,
    };
    expect(estoqueDasAtivas([variacao("p", 3), ilegivel], 99)).toBe(3);
    // O banco pode devolver o número como texto: vale o número.
    expect(estoqueDasAtivas([variacao("p", 3), emTexto], 99)).toBe(5);
  });
});

// Caça de mutação "só testes" (catálogo, 25/11/2026). Três mutantes
// sobreviviam à suíte que cita estes módulos:
//
//  - `produtosSemCusto` aceita só número INTEIRO MAIOR QUE ZERO vindo do
//    painel financeiro. Tirar o "inteiro" deixava passar 2,5 produtos; tirar o
//    "maior que zero" deixava passar -3. O aviso "N produtos ficaram fora do
//    lucro" mostraria um número que não existe.
//  - `avisoProdutosSemCusto(0)` fala no plural ("0 produtos ... ficaram"); só
//    o 1 é singular. O limite `<= 1` fazia o zero virar "1 produto".
//  - `foraDaFaixaAutomatica` CONTA os produtos sem foto: dois produtos sem
//    foto são "2 sem foto" na frase da vitrine do painel. Trocar `+= 1` por
//    `= 1` fazia a lojista ler "1 sem foto" com dois produtos de fora.
import { describe, expect, it } from "vitest";

import {
  foraDaFaixaAutomatica,
  fraseDoQueFicouFora,
} from "@/lib/vitrine-do-painel";
import {
  avisoProdutosSemCusto,
  produtosSemCusto,
} from "@/utils/produtos-sem-custo";

describe("produtosSemCusto — só número inteiro maior que zero vira contagem", () => {
  it("inteiro positivo passa como veio", () => {
    expect(produtosSemCusto({ productsWithoutCost: 4 })).toBe(4);
  });

  it.each([
    ["fração (2,5)", 2.5],
    ["negativo (-3)", -3],
    ["zero", 0],
    ["texto numérico ('4')", "4"],
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
    ["nulo", null],
  ])("%s vira 0", (_caso, valor) => {
    expect(produtosSemCusto({ productsWithoutCost: valor })).toBe(0);
  });

  it("resposta sem o campo, nula ou indefinida: 0", () => {
    expect(produtosSemCusto({})).toBe(0);
    expect(produtosSemCusto(null)).toBe(0);
    expect(produtosSemCusto(undefined)).toBe(0);
  });
});

describe("avisoProdutosSemCusto — só o 1 é singular", () => {
  it("1 produto: singular", () => {
    expect(avisoProdutosSemCusto(1)).toBe(
      "1 produto sem custo cadastrado ficou fora do lucro.",
    );
  });

  it("2 produtos: plural", () => {
    expect(avisoProdutosSemCusto(2)).toBe(
      "2 produtos sem custo cadastrado ficaram fora do lucro.",
    );
  });

  it("0 produtos: plural (zero não é 'um')", () => {
    expect(avisoProdutosSemCusto(0)).toBe(
      "0 produtos sem custo cadastrado ficaram fora do lucro.",
    );
  });
});

describe("foraDaFaixaAutomatica — conta cada produto que ficou de fora", () => {
  const produto = (
    id: string,
    parcial: { stock?: number; images?: string[] } = {},
  ) => ({
    id,
    isActive: true,
    isBestseller: false,
    stock: parcial.stock ?? 5,
    price: 10,
    originalPrice: undefined,
    variants: [],
    images: parcial.images ?? ["https://exemplo.test/foto.jpg"],
  });

  it("três produtos sem foto e com estoque: semFoto = 3, esgotados = 0", () => {
    const fora = foraDaFaixaAutomatica("lancamentos", [
      produto("a", { images: [] }),
      produto("b", { images: [""] }),
      produto("c", { images: [] }),
      produto("com-foto"),
    ]);

    expect(fora).toEqual({ esgotados: 0, semFoto: 3 });
  });

  it("esgotado e sem foto são contados cada um no seu balde", () => {
    const fora = foraDaFaixaAutomatica("lancamentos", [
      produto("esgotado-1", { stock: 0 }),
      produto("esgotado-2", { stock: 0 }),
      produto("sem-foto-1", { images: [] }),
      produto("sem-foto-2", { images: [] }),
      produto("sem-foto-3", { images: [] }),
    ]);

    expect(fora).toEqual({ esgotados: 2, semFoto: 3 });
  });

  it("a frase fala o número real: '2 sem foto' e 'Ficaram'", () => {
    expect(fraseDoQueFicouFora({ esgotados: 0, semFoto: 2 })).toBe(
      "Ficaram de fora desta faixa: 2 sem foto",
    );
  });

  it("um único produto de fora usa o singular 'Ficou'; nenhum devolve null", () => {
    expect(fraseDoQueFicouFora({ esgotados: 0, semFoto: 1 })).toBe(
      "Ficou de fora desta faixa: 1 sem foto",
    );
    expect(fraseDoQueFicouFora({ esgotados: 0, semFoto: 0 })).toBeNull();
  });
});

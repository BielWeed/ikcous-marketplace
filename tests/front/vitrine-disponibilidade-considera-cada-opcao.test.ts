// Produto com Cor e Tamanho cadastrados em separado e UMA das opções toda
// zerada (todos os tamanhos sem estoque, mas as cores com): ninguém consegue
// comprar, o botão do cartão já dizia "Esgotado" (`nenhumaOpcaoDisponivel`),
// mas a vitrine ordenava o produto como disponível porque olhava só a soma
// `stock`. `produtoDisponivel` é a leitura única dessa pergunta: a ordenação,
// as faixas e o cartão respondem o mesmo.
import { describe, expect, it } from "vitest";

import { ordenarParaVitrine, produtoDisponivel } from "@/lib/vitrine";
import { destaquesDaVitrine, ofertasDaVitrine } from "@/lib/vitrine-do-painel";
import type { Product } from "@/types";

type Opcao = { name: string; value: string; stockIncrement: number };
const variantes = (...opcoes: Opcao[]) =>
  opcoes.map((o, i) => ({
    id: `v${i}`,
    productId: "p",
    active: true,
    ...o,
  })) as unknown as Product["variants"];

const cor = (value: string, stockIncrement: number): Opcao => ({
  name: "Cor",
  value,
  stockIncrement,
});
const tamanho = (value: string, stockIncrement: number): Opcao => ({
  name: "Tamanho",
  value,
  stockIncrement,
});

function prod(id: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name: id,
    price: 100,
    stock: 5,
    isActive: true,
    isBestseller: false,
    ...extra,
  } as unknown as Product;
}

describe("produtoDisponivel — a pergunta única da vitrine", () => {
  it("sem opções: vale o estoque do produto", () => {
    expect(produtoDisponivel({ stock: 3 })).toBe(true);
    expect(produtoDisponivel({ stock: 0 })).toBe(false);
    expect(produtoDisponivel({ stock: null })).toBe(false);
  });

  it("Cor e Tamanho com estoque nas duas: disponível", () => {
    expect(
      produtoDisponivel({
        stock: 8,
        variants: variantes(cor("Azul", 5), tamanho("P", 3), tamanho("M", 0)),
      }),
    ).toBe(true);
  });

  it("uma das opções toda zerada: indisponível, mesmo com soma positiva", () => {
    expect(
      produtoDisponivel({
        stock: 8,
        variants: variantes(
          cor("Azul", 5),
          cor("Preto", 3),
          tamanho("P", 0),
          tamanho("M", 0),
        ),
      }),
    ).toBe(false);
  });

  it("opção DESLIGADA não conta: só as ativas decidem", () => {
    const desligada = (variantes(tamanho("P", 0)) ?? []).map((v) => ({
      ...v,
      active: false,
    })) as unknown as Product["variants"];
    expect(
      produtoDisponivel({
        stock: 4,
        variants: [...(variantes(cor("Azul", 4)) ?? []), ...(desligada ?? [])],
      }),
    ).toBe(true);
  });
});

describe("ordenação e faixas usam a mesma pergunta", () => {
  const meioEsgotado = prod("meio-esgotado", {
    stock: 8,
    createdTime: 9000,
    isBestseller: true,
    originalPrice: 150,
    variants: variantes(cor("Azul", 5), cor("Preto", 3), tamanho("P", 0)),
  });
  const normal = prod("normal", {
    stock: 2,
    createdTime: 1000,
    isBestseller: true,
    originalPrice: 150,
  });

  it("ordenarParaVitrine põe o meio esgotado depois do disponível", () => {
    expect(ordenarParaVitrine([meioEsgotado, normal]).map((p) => p.id)).toEqual(
      ["normal", "meio-esgotado"],
    );
  });

  it("Ofertas e Destaques também", () => {
    expect(ofertasDaVitrine([meioEsgotado, normal]).map((p) => p.id)).toEqual([
      "normal",
      "meio-esgotado",
    ]);
    expect(destaquesDaVitrine([meioEsgotado, normal]).map((p) => p.id)).toEqual(
      ["normal", "meio-esgotado"],
    );
  });

  it("empate de data: o id decide, qualquer que seja a ordem de chegada", () => {
    const a = prod("a", { createdTime: 100 });
    const b = prod("b", { createdTime: 100 });
    const c = prod("c", { createdTime: 100 });
    expect(ordenarParaVitrine([c, a, b]).map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(ordenarParaVitrine([b, c, a]).map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

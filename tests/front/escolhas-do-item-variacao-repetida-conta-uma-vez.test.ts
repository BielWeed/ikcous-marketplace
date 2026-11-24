// "Repetido não conta duas vezes": a variação que aparece duas vezes na MESMA
// linha do carrinho (`variantId` igual a um dos `outrasVariantIds`) gasta o
// estoque UMA vez, não duas.
//
// Como isso acontece: a linha vem de um carrinho guardado no aparelho ou de uma
// linha de `cart_items` de outro aparelho, e a chave composta pode chegar com
// o mesmo id repetido. A chave da linha já é limpa (`separarChave`), mas o
// desconto de estoque percorre os ids da própria linha.
//
// Se a repetição contasse em dobro, uma linha com 2 unidades "gastava" 4 do
// estoque daquela variação e a cliente via o botão de mais trancado (ou a
// linha ao lado cortada) com estoque de sobra: venda perdida sem erro algum.
//
// Mutação medida (remover o `semRepeticao` de `somarUso`): os 33 testes de
// `escolhas-do-item-ramos-de-dinheiro`, `carrinho-produto-com-duas-escolhas` e
// `carrinho-limite-usa-o-estoque-da-variacao` continuavam verdes.
import { describe, expect, it } from "vitest";

import {
  estoqueDaLinha,
  somarUso,
  usoPorVariante,
} from "@/lib/escolhas-do-item";
import type { CartItem, Product, ProductVariant } from "@/types";

function variacao(id: string, estoque: number): ProductVariant {
  return {
    id,
    productId: "p1",
    name: "Tamanho",
    value: id,
    stockIncrement: estoque,
    active: true,
  };
}

function produto(variants: ProductVariant[]): Product {
  return {
    id: "p1",
    name: "Produto p1",
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 99,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    variants,
  };
}

function linha(
  p: Product,
  quantity: number,
  variantId: string,
  outrasVariantIds?: string[],
): CartItem {
  return {
    product: p,
    quantity,
    variantId,
    ...(outrasVariantIds ? { outrasVariantIds } : {}),
  };
}

describe("variação repetida na mesma linha gasta o estoque uma vez", () => {
  it("usoPorVariante: 'a' + 'a' com 2 unidades usa 2 de 'a', não 4", () => {
    const p = produto([variacao("a", 10)]);
    const uso = usoPorVariante([linha(p, 2, "a", ["a"])]);
    expect(uso.get("a")).toBe(2);
  });

  it("somarUso: a linha 'a' + 'a' soma a quantidade uma só vez", () => {
    const uso = new Map<string, number>();
    somarUso(uso, { variantId: "a", outrasVariantIds: ["a"] }, 3);
    expect(uso.get("a")).toBe(3);
  });

  it("somarUso: com duas variações DIFERENTES cada uma leva a quantidade inteira", () => {
    // Controle do caso acima: o que não se repete continua somando em cada id.
    const uso = new Map<string, number>();
    somarUso(uso, { variantId: "a", outrasVariantIds: ["b"] }, 3);
    expect(uso.get("a")).toBe(3);
    expect(uso.get("b")).toBe(3);
  });

  it("estoqueDaLinha: a linha repetida de 2 unidades deixa 3 (de 5) para a outra linha", () => {
    const p = produto([variacao("a", 5), variacao("b", 50)]);
    const repetida = linha(p, 2, "a", ["a"]);
    // Outra linha do MESMO produto escolhendo 'a' com 'b': o que sobra de 'a'
    // é 5 - 2 = 3. Contando a repetição em dobro seria 1.
    expect(estoqueDaLinha(p, "a", ["b"], [repetida])).toBe(3);
  });
});

describe("estoqueDaLinha: a fronteira do estoque contra o que as outras linhas levam", () => {
  const p = produto([variacao("a", 5), variacao("b", 50)]);

  it("outra linha leva 4 de 5 -> sobra 1 (quantidade + 1 já não cabe)", () => {
    expect(estoqueDaLinha(p, "a", [], [linha(p, 4, "a")])).toBe(1);
  });

  it("outra linha leva os 5 de 5 -> sobra exatamente 0 (esgotado, não 'sobra negativa')", () => {
    expect(estoqueDaLinha(p, "a", [], [linha(p, 5, "a")])).toBe(0);
  });

  it("variação com estoque 0 e nenhuma outra linha -> 0", () => {
    const zerada = produto([variacao("z", 0)]);
    expect(estoqueDaLinha(zerada, "z", [], [])).toBe(0);
  });

  it("linha de OUTRO produto não gasta o estoque desta variação", () => {
    const outro = { ...produto([variacao("a", 5)]), id: "p2" };
    expect(estoqueDaLinha(p, "a", [], [linha(outro, 5, "a")])).toBe(5);
  });
});

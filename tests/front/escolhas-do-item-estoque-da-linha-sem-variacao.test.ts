// Quanto uma linha do carrinho pode levar quando NÃO há variação para olhar:
// vale o estoque do produto, e estoque ausente ou ilegível vale 0 (nunca
// `undefined` nem `NaN`).
//
// Por que importa: o carrinho guardado no aparelho pode ter a cópia de um
// produto sem o campo `stock` (cadastro velho). `undefined` voltando daqui faz
// `Math.min`/`<= 0` do carrinho e do seletor de quantidade se comportarem de
// um jeito que ninguém previu (`undefined <= 0` é falso: a linha parece ter
// estoque infinito e a cliente chega ao pagamento para ser recusada).
//
// Mutação medida (trocar `product.stock || 0` por `product.stock`): todos os
// testes que já existiam continuavam verdes.
import { describe, expect, it } from "vitest";

import { estoqueDaLinha } from "@/lib/escolhas-do-item";
import type { Product } from "@/types";

function produto(extra: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Produto p1",
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 4,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...extra,
  };
}

describe("estoqueDaLinha sem variação", () => {
  it("vale o estoque do produto", () => {
    expect(estoqueDaLinha(produto({ stock: 4 }))).toBe(4);
  });

  it("produto esgotado vale 0", () => {
    expect(estoqueDaLinha(produto({ stock: 0 }))).toBe(0);
  });

  it("cópia velha do produto sem o campo de estoque vale 0, não undefined", () => {
    // O carrinho do aparelho pode trazer produto de antes do campo existir.
    const semEstoque = produto({ stock: undefined as unknown as number });
    expect(estoqueDaLinha(semEstoque)).toBe(0);
  });

  it("estoque ilegível (NaN) vale 0, não NaN", () => {
    expect(estoqueDaLinha(produto({ stock: Number.NaN }))).toBe(0);
  });

  it("variação que não está na lista do produto cai no estoque do produto", () => {
    // Cópia do produto sem a grade carregada: não há variação para olhar.
    expect(estoqueDaLinha(produto({ stock: 4 }), "sumiu")).toBe(4);
  });
});

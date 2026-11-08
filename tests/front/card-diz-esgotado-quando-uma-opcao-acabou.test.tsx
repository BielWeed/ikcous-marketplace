// @vitest-environment jsdom
//
// Produto com Cor e Tamanho cadastrados em separado e UMA das opções toda
// zerada (as cores têm estoque, nenhum tamanho tem): o botão do cartão já dizia
// "Esgotado", mas o selinho de estoque ao lado dizia "Estoque: 8" porque lia só
// a soma do produto. Cartão, botão e selinho têm de dizer a mesma coisa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProductCard } from "@/components/ui/custom/ProductCard";
import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function opcao(
  id: string,
  name: string,
  value: string,
  stockIncrement: number,
): ProductVariant {
  return {
    id,
    productId: "prod-vestido",
    name,
    value,
    stockIncrement,
    active: true,
  };
}

function vestido(variants: ProductVariant[], stock: number): Product {
  return {
    id: "prod-vestido",
    name: "Vestido Verão",
    description: "",
    price: 100,
    images: ["https://example.com/vestido.png"],
    category: "geral",
    stock,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    variants,
  };
}

// Cores com estoque (5 + 3), tamanhos todos zerados: a soma do produto é 8.
const tamanhosZerados = vestido(
  [
    opcao("c1", "Cor", "Azul", 5),
    opcao("c2", "Cor", "Preto", 3),
    opcao("t1", "Tamanho", "P", 0),
    opcao("t2", "Tamanho", "M", 0),
  ],
  8,
);
// Controle: as duas opções têm estoque.
const comEstoqueNasDuas = vestido(
  [
    opcao("c1", "Cor", "Azul", 5),
    opcao("c2", "Cor", "Preto", 3),
    opcao("t1", "Tamanho", "P", 4),
    opcao("t2", "Tamanho", "M", 0),
  ],
  12,
);

describe("ProductCard — selo de estoque, botão e ordenação dizem o mesmo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar(product: Product, layout: "card" | "linha" = "card") {
    await act(async () => {
      raiz.render(
        <ProductCard
          product={product}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating={false}
          layout={layout}
        />,
      );
    });
  }

  const botao = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;

  it("uma opção toda zerada: o selo diz Esgotado e NÃO diz 'Estoque: 8'", async () => {
    await montar(tamanhosZerados);
    expect(botao().textContent).toContain("Esgotado");
    expect(botao().disabled).toBe(true);
    expect(hospedeiro.textContent).not.toContain("Estoque: 8");
    // "Esgotado" aparece no botão E no selo de estoque.
    expect(hospedeiro.textContent?.match(/Esgotado/g)?.length).toBe(2);
  });

  it("controle: com estoque nas duas opções o selo segue mostrando o estoque", async () => {
    await montar(comEstoqueNasDuas);
    expect(botao().textContent).not.toContain("Esgotado");
    expect(hospedeiro.textContent).toContain("Estoque: 12");
    expect(hospedeiro.textContent).not.toContain("Esgotado");
  });

  it("controle: na versão em linha o selo já dizia 'Sem estoque'", async () => {
    await montar(tamanhosZerados, "linha");
    expect(hospedeiro.textContent).toContain("Sem estoque");
    expect(hospedeiro.textContent).not.toContain("Estoque: 8");
  });
});

// @vitest-environment jsdom
//
// B3 acabamento (laudo do Codex em ProductCard.tsx:383 e
// PremiumOffers.tsx:387, aceito pela hub-f em 08/09): o botão de favoritar
// dizia sempre "Adicionar aos favoritos" / "Remover dos favoritos", sem o
// nome do produto -- quem navega por leitor de tela ouve isso 18 vezes na
// grade sem saber de qual produto é cada um. Esta suíte é o assassino de
// mutantes dos 3 primeiros itens do critério de aceite do brief B3:
//   1. função pura devolve o rótulo genérico só quando falta nome;
//   2. ProductCard usa a função no aria-label E no title;
//   3. PremiumOffers usa a função no aria-label.
// A prova de que o desenho do card (achado do B3 anterior) não mudou fica
// em card-do-produto-nao-e-botao-com-botoes-dentro.test.tsx (item 4 do
// critério de aceite) -- este arquivo só prova o RÓTULO.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rotuloDeFavoritar } from "@/lib/rotulo-favoritar";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function stubGlobaisDeLayout() {
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: false,
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-favoritar-a11y",
    name: "Camiseta Azul",
    description: "Descrição de teste",
    price: 100,
    images: ["https://example.com/img.png"],
    category: "geral",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 12,
    ...overrides,
  };
}

describe("rotuloDeFavoritar — função pura", () => {
  it("não favorito: Adicionar <nome> aos favoritos", () => {
    expect(rotuloDeFavoritar("Camiseta Azul", false)).toBe(
      "Adicionar Camiseta Azul aos favoritos",
    );
  });

  it("favorito: Remover <nome> dos favoritos", () => {
    expect(rotuloDeFavoritar("Camiseta Azul", true)).toBe(
      "Remover Camiseta Azul dos favoritos",
    );
  });

  it("nome vazio: cai no rótulo genérico de hoje, sem espaço duplo", () => {
    expect(rotuloDeFavoritar("", false)).toBe("Adicionar aos favoritos");
    expect(rotuloDeFavoritar("", true)).toBe("Remover dos favoritos");
  });

  it("nome indefinido: mesmo rótulo genérico", () => {
    expect(rotuloDeFavoritar(undefined as unknown as string, false)).toBe(
      "Adicionar aos favoritos",
    );
  });
});

describe("ProductCard — o favoritar diz o nome do produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    stubGlobaisDeLayout();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarCard(isFavorite: boolean) {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    const produto = criarProduto();
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={isFavorite}
          onToggleFavorite={vi.fn()}
          onClick={vi.fn()}
          showRating={false}
          priority
        />,
      );
    });
    return produto;
  }

  it("não favorito: aria-label e title citam o nome do produto", async () => {
    await renderizarCard(false);
    const favoritar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Adicionar Camiseta Azul aos favoritos"]',
    );
    expect(favoritar).not.toBeNull();
    expect(favoritar!.title).toBe("Adicionar Camiseta Azul aos favoritos");
  });

  it("favorito: aria-label e title dizem Remover <nome> dos favoritos", async () => {
    await renderizarCard(true);
    const favoritar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Remover Camiseta Azul dos favoritos"]',
    );
    expect(favoritar).not.toBeNull();
    expect(favoritar!.title).toBe("Remover Camiseta Azul dos favoritos");
  });
});

describe("PremiumOffers — o favoritar diz o nome do produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    stubGlobaisDeLayout();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.doUnmock("@/contexts/StoreContext");
  });

  async function renderizarOferta(isFavorite: boolean) {
    vi.doMock("@/contexts/StoreContext", () => ({
      useStore: () => ({ config: { enableReviews: true, freeShippingMin: 0 } }),
    }));
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    const produto = criarProduto({
      id: "prod-oferta-favoritar-a11y",
      name: "Tênis Corrida Pro",
      originalPrice: 200,
      price: 150,
    });
    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produto]}
          favorites={isFavorite ? [produto.id] : []}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onAddToCart={vi.fn()}
          onQuickBuy={vi.fn()}
        />,
      );
    });
    return produto;
  }

  it("não favorito: aria-label cita o nome do produto", async () => {
    await renderizarOferta(false);
    const favoritar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Adicionar Tênis Corrida Pro aos favoritos"]',
    );
    expect(favoritar).not.toBeNull();
  });

  it("favorito: aria-label diz Remover <nome> dos favoritos", async () => {
    await renderizarOferta(true);
    const favoritar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Remover Tênis Corrida Pro dos favoritos"]',
    );
    expect(favoritar).not.toBeNull();
  });
});

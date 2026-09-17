// @vitest-environment jsdom
//
// ProductCard-520: o selo "Frete Grátis" (ProductCard e ProductView) só
// olhava `product.freeShipping`, a marcação do PRÓPRIO produto -- que desde
// a migração de presets de 03/09 só vale DENTRO do preset "por_produto" (ou
// em "sempre", que vale para qualquer produto). Uma loja que roda uma
// campanha marcando produtos e depois DESLIGA o frete grátis (ou troca para
// "acima de valor") sem desmarcar cada produto continuava anunciando
// "Frete Grátis" em produtos que o carrinho ia cobrar de verdade --
// selo-de-frete-gratis-nao-mente.test.tsx provou a parte "por produto";
// este arquivo prova a parte que faltava: o PRESET da loja.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de selo-de-frete-gratis-nao-mente.test.tsx -- o que este
// teste prova é a ÁRVORE renderizada (o selo aparece ou não).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRETE_GRATIS_POR_PRODUTO,
  FRETE_GRATIS_SEMPRE,
} from "@/lib/presets-de-frete-gratis";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-frete-preset",
    name: "Produto de teste",
    description: "Descrição de teste",
    price: 79,
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

describe("ProductCard — o selo do card e da folha seguem o preset da loja, não só a marcação do produto", () => {
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

  async function renderizarCard(
    produto: Product,
    freeShippingPreset?: Parameters<
      typeof import("@/components/ui/custom/ProductCard").ProductCard
    >[0]["freeShippingPreset"],
  ) {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          showRating={false}
          priority
          freeShippingPreset={freeShippingPreset}
        />,
      );
    });
  }

  it("preset por_produto + produto marcado: o selo aparece", async () => {
    const produto = criarProduto({ freeShipping: true });

    await renderizarCard(produto, "por_produto");

    expect(hospedeiro.textContent).toContain("Frete Grátis");
  });

  it("preset por_produto + produto NÃO marcado: o selo não aparece", async () => {
    const produto = criarProduto({ freeShipping: false });

    await renderizarCard(produto, "por_produto");

    expect(hospedeiro.textContent).not.toContain("Frete Grátis");
  });

  it("cenário do ticket: loja DESLIGOU o frete grátis mas o produto ficou marcado de uma campanha antiga -- o selo some", async () => {
    const produto = criarProduto({ freeShipping: true });

    await renderizarCard(produto, "desligado");

    expect(hospedeiro.textContent).not.toContain("Frete Grátis");
  });

  it("loja trocou para 'acima de valor' e não desmarcou o produto -- o selo também some (a promessa por valor é do FreeShippingBlock, não do card)", async () => {
    const produto = criarProduto({ freeShipping: true });

    await renderizarCard(produto, "acima_de_valor");

    expect(hospedeiro.textContent).not.toContain("Frete Grátis");
  });

  it("preset sempre: o selo aparece em QUALQUER produto, mesmo sem a marcação individual", async () => {
    const produto = criarProduto({ freeShipping: false });

    await renderizarCard(produto, "sempre");

    expect(hospedeiro.textContent).toContain("Frete Grátis");
  });

  it("sentinelas de presets-de-frete-gratis.ts continuam sendo as mesmas que CartContext usa (por_produto=-1, sempre=0.01)", () => {
    expect(FRETE_GRATIS_POR_PRODUTO).toBe(-1);
    expect(FRETE_GRATIS_SEMPRE).toBe(0.01);
  });

  it("compatibilidade: sem freeShippingPreset (chamador ainda não repassa -- ProductList/SearchView/FavoritesView/ProductCarousel, fora desta tarefa) o selo preserva o comportamento de hoje", async () => {
    const produto = criarProduto({ freeShipping: true });

    await renderizarCard(produto, undefined);

    expect(hospedeiro.textContent).toContain("Frete Grátis");
  });
});

// ProductView (folha/página do produto): tem a MESMA condição, mas escrita
// direto no componente (não usa o `freeShippingPreset` do ProductCard) --
// mesmo padrão de mocks de product-view-gate-avaliacoes.test.tsx.
class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const getReviewsByProduct = vi.fn();
const subscribeToReviews = vi.fn(() => () => {});

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct,
    markHelpful: vi.fn(),
    subscribeToReviews,
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

let mockFreeShippingMin = 0;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, freeShippingMin: mockFreeShippingMin },
    isLoaded: true,
  }),
}));

describe("ProductView — o selo 'Grátis' do preço também segue o preset da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    getReviewsByProduct.mockClear();
    subscribeToReviews.mockClear();
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
    mockFreeShippingMin = 0;
  });

  async function renderizarProduto(produto: Product) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  it("cenário do ticket: preset desligado + produto marcado de campanha antiga -- a folha não anuncia Grátis", async () => {
    mockFreeShippingMin = 0; // desligado
    const produto = criarProduto({ freeShipping: true });

    await renderizarProduto(produto);

    expect(hospedeiro.textContent).not.toContain("Grátis");
  });

  it("preset por_produto + produto marcado -- a folha anuncia Grátis", async () => {
    mockFreeShippingMin = FRETE_GRATIS_POR_PRODUTO;
    const produto = criarProduto({ freeShipping: true });

    await renderizarProduto(produto);

    expect(hospedeiro.textContent).toContain("Grátis");
  });

  it("preset por_produto + produto NÃO marcado -- a folha não anuncia Grátis", async () => {
    mockFreeShippingMin = FRETE_GRATIS_POR_PRODUTO;
    const produto = criarProduto({ freeShipping: false });

    await renderizarProduto(produto);

    expect(hospedeiro.textContent).not.toContain("Grátis");
  });

  it("preset sempre -- a folha anuncia Grátis mesmo sem a marcação do produto", async () => {
    mockFreeShippingMin = FRETE_GRATIS_SEMPRE;
    const produto = criarProduto({ freeShipping: false });

    await renderizarProduto(produto);

    expect(hospedeiro.textContent).toContain("Grátis");
  });
});

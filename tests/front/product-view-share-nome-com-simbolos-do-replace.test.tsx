// @vitest-environment jsdom
//
// O texto de compartilhar trocava `[nome]` por `product.name` direto num
// `.replace(regex, string)`. Nesse formato o JavaScript lê "$&", "$1", "$$" etc.
// do NOME como padrão de substituição: um produto chamado "Bolo $& 2" saía
// "Bolo [nome] 2" na mensagem. E o nome que continha "[preco]" era trocado de
// novo pela etapa seguinte. Mesmo casco de
// product-view-share-substitui-os-marcadores.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      storeCity: "Sao Paulo",
      storeState: "SP",
      shareText: "[nome] por [preco]",
    },
    isLoaded: true,
  }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão do
// teste vizinho.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produtoComNome(name: string): Product {
  return {
    id: "prod-101",
    name,
    description: "Descricao de teste",
    price: 49.9,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
}

describe("ProductView — share com nome de produto cheio de símbolos do replace", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let textoCopiado: string;

  beforeEach(() => {
    textoCopiado = "";
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (t: string) => {
          textoCopiado = t;
          return Promise.resolve();
        },
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
  });

  async function compartilhar(nome: string) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produtoComNome(nome)}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
    const botaoShare = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Compartilhar"]',
    );
    await act(async () => {
      botaoShare!.click();
      await Promise.resolve();
    });
    return textoCopiado;
  }

  it('nome com "$&" e "$1" sai literal, sem virar padrão de substituição', async () => {
    const texto = await compartilhar("Bolo $& com $1 e $$");
    // O caminho do clipboard cola " - <link>" no fim (sem [link] no modelo).
    expect(texto).toBe(
      `Bolo $& com $1 e $$ por R$ 49,90 - ${globalThis.location.href}`,
    );
  });

  it("nome que contém [preco] não é trocado de novo pela etapa seguinte", async () => {
    const texto = await compartilhar("Kit [preco]");
    expect(texto).toBe(
      `Kit [preco] por R$ 49,90 - ${globalThis.location.href}`,
    );
  });
});

// @vitest-environment jsdom
//
// Loja de cor CLARA (amarelo, rosa claro, dourado): o botão "Adicionar ao
// Carrinho" tinha o texto fixo em branco sobre a cor da loja e ficava quase
// sem texto legível. Agora o botão usa a cor de texto do TEMA
// (`text-primary-foreground`) e o tema calcula essa cor pelo contraste.
//
// O jsdom não processa o CSS do Tailwind, então o teste prende as duas
// metades do contrato separadas: (1) o botão pede o texto do tema, nunca o
// branco fixo; (2) com a cor clara aplicada, a variável do tema que o botão
// usa fica ESCURA. Montagem real reaproveitada de
// product-view-share-nativo-nao-repete-o-link.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aplicarCorDaLoja } from "@/config/branding";
import type { Product } from "@/types";

const getReviewsByProduct = vi.fn();
const subscribeToReviews = vi.fn(() => () => {});

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      storeCity: "Sao Paulo",
      storeState: "SP",
      shareText: "Olha que achei na Loja X!",
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

const produto: Product = {
  id: "prod-101",
  name: "Produto Compartilhavel",
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

describe("ProductView — o botão de comprar é legível em loja de cor clara", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    document.documentElement.style.removeProperty("--primary");
    document.documentElement.style.removeProperty("--primary-foreground");
    vi.unstubAllGlobals();
  });

  async function montar() {
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

  function botoesDeComprar(): HTMLButtonElement[] {
    return Array.from(hospedeiro.querySelectorAll("button")).filter((b) =>
      /Adicionar/.test(b.textContent ?? ""),
    );
  }

  it("amarelo: o texto do botão vem do tema, e o tema entrega texto ESCURO", async () => {
    aplicarCorDaLoja("#ffd400");
    await montar();

    const botoes = botoesDeComprar();
    // Âncora: o botão principal existe (o do rodapé fixo pode ou não estar).
    expect(botoes.length).toBeGreaterThanOrEqual(1);
    for (const botao of botoes) {
      expect(botao.className).toContain("bg-primary");
      expect(botao.className).toContain("text-primary-foreground");
      expect(botao.className).not.toMatch(/(^|\s)text-white(\s|$)/);
    }

    // O texto do tema sobre o amarelo é o escuro (240 5.9% 10%), não branco.
    expect(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--primary-foreground",
      ),
    ).toBe("240 5.9% 10%");
  });

  it("azul escuro: o mesmo botão entrega texto BRANCO", async () => {
    aplicarCorDaLoja("#1e3a8a");
    await montar();

    expect(botoesDeComprar().length).toBeGreaterThanOrEqual(1);
    expect(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--primary-foreground",
      ),
    ).toBe("0 0% 98%");
  });
});

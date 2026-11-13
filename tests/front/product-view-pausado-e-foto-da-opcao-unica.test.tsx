// @vitest-environment jsdom
//
// DEFEITOS DA FICHA DO PRODUTO (caçador, 13/11/2026):
//
// 1) A lojista pausa o produto em outro aparelho com a ficha aberta, e a ficha
//    seguia dizendo "Em estoque" e oferecendo "Adicionar ao carrinho". Agora o
//    produto pausado aparece como indisponível, sem compra, e a ficha relê o
//    catálogo quando a cliente volta a ela (aba/aplicativo em primeiro plano).
// 2) Cor ÚNICA nasce marcada, mas a foto grande ficava na capa: a galeria agora
//    abre na foto da opção, a mesma que o toque na opção levaria.
//
// Harness copiado de product-view-marca-sozinho-a-opcao-unica.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

const h = vi.hoisted(() => ({
  reler: vi.fn<() => Promise<void>>(),
}));

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
    fetchProducts: h.reler,
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
    config: { enableReviews: false },
    isLoaded: true,
  }),
}));

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const variante = (
  id: string,
  value: string,
  extra: Partial<ProductVariant> = {},
): ProductVariant => ({
  id,
  productId: "prod-camisa",
  name: "Cor",
  value,
  stockIncrement: 5,
  active: true,
  ...extra,
});

const produto = (extra: Partial<Product> = {}): Product => ({
  id: "prod-camisa",
  name: "Camisa Boa",
  description: "Descrição de teste",
  price: 50,
  images: ["/capa.png", "/lado.png"],
  category: "roupas",
  stock: 10,
  sold: 3,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 4.5,
  reviewCount: 0,
  ...extra,
});

describe("ProductView — produto pausado e foto da opção única", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.reler.mockReset();
    h.reler.mockResolvedValue(undefined);
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
    vi.unstubAllGlobals();
    // biome-ignore lint/performance/noDelete: tirar o dublê da instância.
    delete (document as { visibilityState?: string }).visibilityState;
  });

  async function montar(p: Product) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={p}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  const botoes = () => [...hospedeiro.querySelectorAll("button")];
  const bolinhas = () => [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>(
      "button[aria-label^='Foto '][aria-label*=' de ']",
    ),
  ];
  const fotoAtiva = () =>
    bolinhas().findIndex((b) => b.getAttribute("aria-current") === "true") + 1;
  const dizerQueAbaEstaComo = (estado: "visible" | "hidden") =>
    act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => estado,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

  it("produto pausado: diz que está indisponível, sem 'Em estoque' e sem compra", async () => {
    await montar(produto({ isActive: false }));

    expect(hospedeiro.textContent).toContain("Produto indisponível no momento");
    expect(hospedeiro.textContent).not.toContain("Em estoque");
    expect(botoes().some((b) => b.textContent?.includes("Adicionar"))).toBe(
      false,
    );
    const semCompra = botoes().find((b) => b.textContent === "Indisponível");
    expect(semCompra?.disabled).toBe(true);
  });

  it("produto ativo segue à venda, sem o aviso de indisponível", async () => {
    await montar(produto());

    expect(hospedeiro.textContent).not.toContain(
      "Produto indisponível no momento",
    );
    expect(hospedeiro.textContent).toContain("Em estoque: 10");
    expect(
      botoes().some((b) => b.textContent?.includes("Adicionar ao Carrinho")),
    ).toBe(true);
  });

  it("a cliente volta à ficha (aba visível): o catálogo é relido; aba escondida não relê", async () => {
    await montar(produto());
    expect(h.reler).not.toHaveBeenCalled();

    await dizerQueAbaEstaComo("hidden");
    expect(h.reler).not.toHaveBeenCalled();

    await dizerQueAbaEstaComo("visible");
    expect(h.reler).toHaveBeenCalledTimes(1);
  });

  it("cor única com foto própria: a galeria já abre nela, não na capa", async () => {
    await montar(
      produto({
        variants: [variante("v-azul", "Azul", { imageUrl: "/azul.png" })],
      }),
    );

    // Faixa: capa, lado e, no fim, a foto da Azul (ela não é do produto).
    expect(bolinhas()).toHaveLength(3);
    expect(fotoAtiva()).toBe(3);
  });

  it("cor única SEM foto própria: a galeria segue na capa", async () => {
    await montar(produto({ variants: [variante("v-azul", "Azul")] }));

    expect(fotoAtiva()).toBe(1);
  });
});

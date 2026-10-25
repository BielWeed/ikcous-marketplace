// @vitest-environment jsdom
//
// Caça 4 (24/10/2026), achado V1 (parte do compartilhar): a página mostra o
// preço da variação escolhida (`currentPrice`), mas o texto de compartilhar
// usava `product.price` -- a cliente escolhia o tamanho G (R$ 90), tocava em
// compartilhar e a amiga recebia "por R$ 80,00". O texto passa a levar o
// MESMO preço que a página mostra.
//
// Montagem copiada de product-view-share-substitui-os-marcadores.test.tsx
// (caminho do clipboard: o jsdom não tem navigator.share).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

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

let shareTextDaLoja = "Olha que achei na Loja X!";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: false,
      storeCity: "Sao Paulo",
      storeState: "SP",
      shareText: shareTextDaLoja,
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const variantes: ProductVariant[] = [
  {
    id: "v-p",
    productId: "prod-share-var",
    name: "Tamanho",
    value: "P",
    stockIncrement: 5,
    active: true,
  },
  {
    id: "v-g",
    productId: "prod-share-var",
    name: "Tamanho",
    value: "G",
    stockIncrement: 5,
    priceOverride: 90,
    active: true,
  },
];

const produto: Product = {
  id: "prod-share-var",
  name: "Camisa Compartilhavel",
  description: "Descricao de teste",
  price: 80,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants: variantes,
};

describe("ProductView — compartilhar leva o preço da variação escolhida", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;
  let textoCopiado: string;

  beforeEach(() => {
    shareTextDaLoja = "Olha que achei na Loja X!";
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
    hospedeiro = document.createElement("main");
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

  async function escolherG() {
    const span = [...hospedeiro.querySelectorAll("button span")].find(
      (el) => el.textContent === "G",
    );
    const botao = span?.closest("button") as HTMLButtonElement;
    expect(botao).toBeTruthy();
    await act(async () => {
      botao.click();
    });
  }

  async function compartilhar() {
    const botaoShare = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Compartilhar"]',
    );
    expect(botaoShare).toBeTruthy();
    await act(async () => {
      botaoShare!.click();
      await Promise.resolve();
    });
    return textoCopiado;
  }

  it("texto padrão (sem marcador): 'por R$ 90,00' depois de escolher G", async () => {
    await montar();
    await escolherG();
    const texto = await compartilhar();
    expect(texto).toContain("Camisa Compartilhavel por R$ 90,00");
    expect(texto).not.toContain("80,00");
  });

  it("texto com [preco]: o marcador vira o preço da variação escolhida", async () => {
    shareTextDaLoja = "Leve: [nome] por [preco]! [link]";
    await montar();
    await escolherG();
    const texto = await compartilhar();
    expect(texto).toContain("R$ 90,00");
    expect(texto).not.toContain("80,00");
  });

  it("sem escolher nada: continua o preço do produto (borda)", async () => {
    await montar();
    const texto = await compartilhar();
    expect(texto).toContain("por R$ 80,00");
  });
});

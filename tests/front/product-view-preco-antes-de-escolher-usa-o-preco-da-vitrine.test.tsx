// @vitest-environment jsdom
//
// Caça (rodada 1, achado b0): antes de a cliente escolher o tamanho/cor, a
// página do produto mostrava o preço BASE (`precoDaEscolha(product, [])`), e
// não o que o card da vitrine anunciou (`precoDeVitrine`). Produto a 50 com
// "De" 70, tamanho P esgotado e G a 90 em estoque: o card dizia R$ 90, a
// página abria com "R$ 50, De R$ 70, 29% OFF" -- um preço que nenhuma opção à
// venda tem -- e o JSON-LD e o texto de compartilhar levavam o mesmo 50.
//
// Depois de escolher, vale `precoDaEscolha` como sempre (o servidor cobra
// por variação). Montagem copiada de
// product-view-share-usa-o-preco-da-variacao.test.tsx.
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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: false,
      storeCity: "Sao Paulo",
      storeState: "SP",
      shareText: "Olha que achei!",
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

function variante(
  valor: string,
  estoque: number,
  precoProprio?: number,
): ProductVariant {
  return {
    id: `v-${valor}`,
    productId: "prod-vitrine",
    name: "Tamanho",
    value: valor,
    stockIncrement: estoque,
    priceOverride: precoProprio,
    active: true,
  };
}

function produtoCom(variants: ProductVariant[]): Product {
  return {
    id: "prod-vitrine",
    name: "Vestido Vitrine",
    description: "Descricao de teste",
    price: 50,
    originalPrice: 70,
    images: [],
    category: "geral",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    variants,
  };
}

// P esgotado (sem preço próprio = 50) e G a 90 com estoque: o card anuncia 90.
const soGTemEstoque = produtoCom([variante("P", 0), variante("G", 5, 90)]);
// P a 50 e G a 60, os dois à venda: o card anuncia "a partir de" 50.
const doisPrecosAVenda = produtoCom([variante("P", 5), variante("G", 5, 60)]);

describe("ProductView — antes de escolher, o preço é o da vitrine", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;
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

  async function montar(product: Product) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={product}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  async function escolher(valor: string) {
    const span = [...hospedeiro.querySelectorAll("button span")].find(
      (el) => el.textContent === valor,
    );
    const botao = span?.closest("button") as HTMLButtonElement;
    expect(botao).toBeTruthy();
    await act(async () => {
      botao.click();
    });
  }

  const precoGrande = () =>
    [...hospedeiro.querySelectorAll("span[class*='text-[30px]']")].find((el) =>
      el.textContent?.trim().startsWith("R$"),
    )?.textContent;

  const precoDoJsonLd = () => {
    const script = document.getElementById("product-structured-data");
    return JSON.parse(script?.textContent ?? "{}").offers?.price;
  };

  async function compartilhar() {
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Compartilhar"]',
    );
    expect(botao).toBeTruthy();
    await act(async () => {
      botao!.click();
      await Promise.resolve();
    });
    return textoCopiado;
  }

  it("só G tem estoque: a página abre em R$ 90, sem 'De' nem '% OFF' que o card não mostra", async () => {
    await montar(soGTemEstoque);

    expect(precoGrande()?.trim()).toBe("R$ 90,00");
    expect(hospedeiro.textContent).not.toMatch(/De:\s*R\$/);
    expect(hospedeiro.textContent).not.toMatch(/% OFF/);
  });

  it("só G tem estoque: o JSON-LD e o texto de compartilhar levam 90, não o preço base", async () => {
    await montar(soGTemEstoque);

    expect(precoDoJsonLd()).toBe(90);
    expect(await compartilhar()).toContain("por R$ 90,00");
  });

  it("depois de escolher G, o preço é o da escolha (como sempre) e segue sem desconto", async () => {
    await montar(soGTemEstoque);
    await escolher("G");

    expect(precoGrande()?.trim()).toBe("R$ 90,00");
    expect(hospedeiro.textContent).not.toMatch(/% OFF/);
    expect(precoDoJsonLd()).toBe(90);
  });

  it("dois preços à venda: antes de escolher, 'A partir de' 50 com o desconto real; ao escolher G vira 60 sem 'a partir de'", async () => {
    await montar(doisPrecosAVenda);

    expect(precoGrande()?.trim()).toBe("R$ 50,00");
    expect(hospedeiro.textContent).toContain("A partir de");
    expect(hospedeiro.textContent).toMatch(/De:\s*R\$\s?70,00/);
    expect(hospedeiro.textContent).toContain("29% OFF");
    expect(precoDoJsonLd()).toBe(50);

    await escolher("G");

    expect(precoGrande()?.trim()).toBe("R$ 60,00");
    expect(hospedeiro.textContent).not.toContain("A partir de");
    expect(hospedeiro.textContent).toContain("14% OFF");
    expect(precoDoJsonLd()).toBe(60);
  });
});

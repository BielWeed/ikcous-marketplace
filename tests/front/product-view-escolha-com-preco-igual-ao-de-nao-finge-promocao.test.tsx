// @vitest-environment jsdom
//
// Fronteira do "De:" riscado na PÁGINA do produto depois que a cliente escolhe
// uma opção: produto a R$ 50 com "De" R$ 70, tamanho P a R$ 50 e tamanho G com
// preço próprio de R$ 70 -- igual ao "De". Ao marcar o G ela paga R$ 70, então
// não existe desconto: nada de "De: R$ 70,00" riscado ao lado de "R$ 70,00" nem
// selo. A guarda é `originalExibido > precoExibido` (estritamente maior); com
// `>=` a página riscaria o mesmo valor que cobra. Escolhendo o P o desconto
// de verdade (29%) volta. Montagem copiada de
// product-view-preco-antes-de-escolher-usa-o-preco-da-vitrine.test.tsx.
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
    productId: "prod-igual-ao-de-pagina",
    name: "Tamanho",
    value: valor,
    stockIncrement: estoque,
    priceOverride: precoProprio,
    active: true,
  };
}

const produto: Product = {
  id: "prod-igual-ao-de-pagina",
  name: "Vestido Fronteira",
  description: "Descricao de teste",
  price: 50,
  originalPrice: 70,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants: [variante("P", 5), variante("G", 5, 70)],
};

describe("ProductView — escolha cujo preço é igual ao 'De' não finge promoção", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;

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

  it("antes de escolher: a partir de R$ 50, com o 'De: R$ 70,00' e 29% OFF", async () => {
    await montar();

    expect(precoGrande()?.trim()).toBe("R$ 50,00");
    expect(hospedeiro.textContent).toMatch(/De:\s*R\$\s*70,00/);
    expect(hospedeiro.textContent).toContain("29% OFF");
  });

  it("marca o G (R$ 70, igual ao 'De'): só o preço, sem 'De:' nem '% OFF'", async () => {
    await montar();
    await escolher("G");

    expect(precoGrande()?.trim()).toBe("R$ 70,00");
    expect(hospedeiro.textContent).not.toMatch(/De:\s*R\$/);
    expect(hospedeiro.textContent).not.toMatch(/% OFF/);
    expect(hospedeiro.querySelector(".line-through")).toBeNull();
  });

  it("marca o P (R$ 50): o desconto de verdade volta", async () => {
    await montar();
    await escolher("P");

    expect(precoGrande()?.trim()).toBe("R$ 50,00");
    expect(hospedeiro.textContent).toMatch(/De:\s*R\$\s*70,00/);
    expect(hospedeiro.textContent).toContain("29% OFF");
  });
});

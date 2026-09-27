// @vitest-environment jsdom
//
// Segunda decisão do Gabriel (27/09/2026): o selo "X% OFF" também vira
// verde -- mesmo raciocínio do preço "Por:" (preco-promocional-verde.test.tsx):
// vermelho passa "negativo", e desconto não é negativo. Estilo pareado com o
// selo "Economize R$…", que já é verde. O indicador de estoque baixo
// ("Apenas N restam!") continua vermelho de propósito -- é alerta, não
// desconto -- e não é tocado aqui.
//
// Cobre os quatro lugares que dão para renderizar sem abrir a folha de
// opções do card (ProductCard, ProductView, PhoneSimulator nos dois modos).
// O selo dentro da FOLHA de opções do ProductCard usa a MESMA constante
// compartilhada (CLASSE_SELO_DESCONTO) e o MESMO padrão de classe do selo do
// card -- não tem teste dedicado aqui (abrir a folha exige variante ativa +
// interação, fora do escopo deste arquivo), mas a implementação é o mesmo
// find-and-replace comprovado no card.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductCard } from "@/components/ui/custom/ProductCard";
import type { Product } from "@/types";

// Mocks do describe de ProductView (mesmo padrão de
// product-view-estoque-contraste-aa.test.tsx) -- no nível do módulo porque
// `vi.mock` é hoisted para lá de qualquer forma; ProductCard e PhoneSimulator
// não usam nenhum destes módulos, então os mocks são inofensivos pros outros
// dois describes deste arquivo.
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
    config: { enableReviews: true },
    isLoaded: true,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoEmPromocao: Product = {
  id: "prod-selo-verde-1",
  name: "Produto Em Promoção",
  description: "",
  price: 12.9,
  originalPrice: 24.9,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
};

function encontraSeloDeDesconto(raiz: ParentNode): Element | undefined {
  // `el.children.length === 0` é o que garante achar o próprio selo (o
  // `<span>`/`<div>` folha, só com texto dentro: "{discount}% OFF"), não um
  // ancestral que embrulha o selo e -- quando é o único badge visível na
  // fixture -- também termina com "% OFF" no textContent agregado.
  return Array.from(raiz.querySelectorAll("span, div")).find(
    (el) =>
      el.children.length === 0 && el.textContent?.trim().endsWith("% OFF"),
  );
}

describe("ProductCard — selo 'X% OFF' usa verde, não vermelho/rosa", () => {
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

  it("card da vitrine: o selo troca border/bg/text rosa por verde", async () => {
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produtoEmPromocao}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating={false}
        />,
      );
    });

    const selo = encontraSeloDeDesconto(hospedeiro);
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("bg-emerald-50")).toBe(true);
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("border-emerald-200")).toBe(true);
    expect(selo?.classList.contains("bg-rose-50")).toBe(false);
    expect(selo?.classList.contains("text-rose-700")).toBe(false);
  });
});

describe("ProductView — selo 'X% OFF' usa verde, não vermelho/rosa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

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
    vi.unstubAllGlobals();
  });

  it("página do produto: o selo troca border/bg/text rosa por verde", async () => {
    const { ProductView } = await import("@/views/customer/ProductView");

    await act(async () => {
      raiz.render(
        <ProductView
          product={produtoEmPromocao}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    const selo = encontraSeloDeDesconto(hospedeiro);
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("bg-emerald-50")).toBe(true);
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("bg-rose-50")).toBe(false);
  });
});

describe("PhoneSimulator — selo 'X% OFF' usa verde, não vermelho/rosa (os dois modos)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  const formDataComPromocao = {
    name: "Produto de teste",
    description: "Descricao de teste",
    price: "12.9",
    costPrice: "5",
    originalPrice: "24.9",
    stock: "10",
    category: "geral",
    images: [] as string[],
    freeShipping: false,
    isBestseller: false,
    isActive: true,
    variants: [],
  };

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
    vi.unstubAllGlobals();
  });

  it("modo 'página': o selo troca border/bg/text rosa por verde", async () => {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );

    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={formDataComPromocao}
          previewMode="page"
          setPreviewMode={() => {}}
          previewImgIndex={0}
          setPreviewImgIndex={() => {}}
          previewSelectedVariants={{}}
          setPreviewSelectedVariants={() => {}}
          activeDetailTab="description"
          setActiveDetailTab={() => {}}
        />,
      );
    });

    const selo = encontraSeloDeDesconto(document.body);
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("bg-emerald-50")).toBe(true);
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("bg-rose-50")).toBe(false);
  });

  it("modo 'cartão': o selo troca border/bg/text rosa por verde", async () => {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );

    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={formDataComPromocao}
          previewMode="card"
          setPreviewMode={() => {}}
          previewImgIndex={0}
          setPreviewImgIndex={() => {}}
          previewSelectedVariants={{}}
          setPreviewSelectedVariants={() => {}}
          activeDetailTab="description"
          setActiveDetailTab={() => {}}
        />,
      );
    });

    const selo = encontraSeloDeDesconto(document.body);
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("bg-emerald-50")).toBe(true);
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("bg-rose-50")).toBe(false);
  });
});

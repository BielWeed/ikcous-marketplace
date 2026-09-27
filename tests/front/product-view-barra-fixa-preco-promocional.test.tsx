// @vitest-environment jsdom
//
// Pedido do Gabriel (27/09/2026): a barra de compra fixa/dockada (aparece ao
// rolar a página do produto, ProductView.tsx ~1517) mostrava o preço SEMPRE
// em `text-rose-600`, com ou sem promoção -- ao contrário do bloco de preço
// principal da mesma página (que já reage a `originalPrice`). Mesmo
// princípio do dono: vermelho é "negativo", não é o estado normal de um
// preço. Agora a barra dockada segue a MESMA regra do bloco principal
// (ProductView.tsx:976): com promoção, verde (contraste AA); sem promoção,
// o neutro que a própria página já usa no preço sem desconto (`text-zinc-900`,
// ProductView.tsx:991).
//
// Modelo estrutural copiado de product-view-estoque-contraste-aa.test.tsx
// (mesmos dublês e stubs de jsdom) -- este arquivo precisa, além disso, de
// um <main> real no documento: o efeito que liga `scrolled` (a barra dockada
// só existe com `scrolled=true`) só se inscreve com
// `document.querySelector("main")` encontrando alguma coisa. Rendering
// direto num host <main> resolve sem precisar simular scroll de verdade --
// `getBoundingClientRect()` no jsdom já devolve zero, e o efeito chama
// `handleScrollSpy()` uma vez no mount.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

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

// jsdom não implementa IntersectionObserver -- o efeito de recomendações do
// ProductView cria um a cada montagem.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoEmPromocao: Product = {
  id: "prod-barra-fixa-promo",
  name: "Produto Em Promoção",
  description: "Descrição de teste",
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

const produtoSemPromocao: Product = {
  ...produtoEmPromocao,
  id: "prod-barra-fixa-sem-promo",
  originalPrice: undefined,
};

function encontraPrecoDaBarraFixa(): Element | undefined {
  // A barra dockada renderiza num `<p>`, via createPortal em document.body --
  // é o ÚNICO "R$" do componente que usa `<p>` (os outros dois blocos de
  // preço, com e sem desconto, usam `<span>`; ver ProductView.tsx:976-994).
  return Array.from(document.querySelectorAll("p")).find((el) =>
    el.textContent?.trim().startsWith("R$"),
  );
}

describe("ProductView — barra de compra fixa segue a mesma regra de cor do preço principal", () => {
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
    // <main> real: é dele que o efeito de scroll-spy precisa para se
    // inscrever e ligar `scrolled` (ver comentário no topo do arquivo).
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

  it("com promoção: o preço da barra fixa usa a mesma classe verde do bloco principal", async () => {
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

    const preco = encontraPrecoDaBarraFixa();
    expect(preco).not.toBeUndefined();
    expect(preco?.classList.contains("text-emerald-700")).toBe(true);
    expect(preco?.classList.contains("text-rose-600")).toBe(false);
  });

  it("sem promoção: o preço da barra fixa vira neutro (text-zinc-900), não vermelho", async () => {
    const { ProductView } = await import("@/views/customer/ProductView");

    await act(async () => {
      raiz.render(
        <ProductView
          product={produtoSemPromocao}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    const preco = encontraPrecoDaBarraFixa();
    expect(preco).not.toBeUndefined();
    expect(preco?.classList.contains("text-zinc-900")).toBe(true);
    expect(preco?.classList.contains("text-rose-600")).toBe(false);
    expect(preco?.classList.contains("text-emerald-700")).toBe(false);
  });
});

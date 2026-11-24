// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { PREFIXO_DE_RECOMENDACOES } from "@/lib/copias-por-produto";
import type { Product } from "@/types";
import { ProductView } from "@/views/customer/ProductView";

const azul: Product = {
  id: "caneca-azul",
  name: "Caneca Azul",
  description: "Descrição de teste",
  price: 100,
  images: ["https://example.com/caneca.jpg"],
  category: "canecas",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-08T00:00:00.000Z",
};
const verde = { ...azul, id: "caneca-verde", name: "Caneca Verde" };
const amarela = { ...azul, id: "caneca-amarela", name: "Caneca Amarela" };

const fetchProducts = vi.fn();
const fetchRecommendations = vi.fn(async (_id: string) => [amarela]);

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    products: [azul, amarela],
    loadingProducts: false,
    catalogoErro: false,
    catalogoDaRedeAplicado: true,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchProducts,
    fetchRecommendations,
  }),
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ reviews: [], loading: false }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { product: Product }) => <p>{product.name}</p>,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("busca uma substituta ao rolar quando a única sugestão guardada saiu do catálogo", async () => {
  const chave = PREFIXO_DE_RECOMENDACOES + azul.id;
  localStorage.setItem(chave, JSON.stringify([verde]));
  const hospedeiro = document.createElement("main");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  const alvos = new Map<Element, (isIntersecting: boolean) => void>();

  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private alvo?: Element;

      constructor(
        private readonly notificar: IntersectionObserverCallback,
        private readonly opcoes?: IntersectionObserverInit,
      ) {}

      observe(target: Element) {
        if (this.opcoes?.rootMargin !== "300px") return;
        this.alvo = target;
        alvos.set(target, (isIntersecting) => {
          this.notificar(
            [{ target, isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        });
      }

      disconnect() {
        if (this.alvo) alvos.delete(this.alvo);
      }
    },
  );
  vi.stubGlobal("CSS", { escape: (valor: string) => valor });
  const rolar = async (isIntersecting: boolean) => {
    await act(async () => {
      for (const [alvo, notificar] of alvos) {
        if (hospedeiro.contains(alvo)) notificar(isIntersecting);
      }
    });
  };

  try {
    await act(async () => {
      raiz.render(
        <ProductView
          product={azul}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    await rolar(false);
    expect(fetchRecommendations).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toContain("Você também pode gostar");
    expect(hospedeiro.textContent).not.toContain(verde.name);

    await rolar(true);
    await rolar(true);
    expect(fetchRecommendations).toHaveBeenCalledTimes(1);
    expect(fetchRecommendations).toHaveBeenCalledWith(azul.id);
    expect(hospedeiro.textContent).toContain(amarela.name);
    expect(hospedeiro.textContent).not.toContain(verde.name);
  } finally {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    localStorage.removeItem(chave);
    vi.unstubAllGlobals();
  }
});

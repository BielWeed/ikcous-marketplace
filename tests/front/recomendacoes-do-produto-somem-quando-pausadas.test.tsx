// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { Product } from "@/types";

const produto: Product = {
  id: "produto-da-ficha",
  name: "Produto da ficha",
  description: "Descrição de teste",
  price: 100,
  images: ["https://example.com/produto.jpg"],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-08T00:00:00.000Z",
};
const recomendado: Product = {
  ...produto,
  id: "recomendado",
  name: "Produto recomendado",
};

let catalogo: {
  products: Product[];
  loadingProducts: boolean;
  catalogoErro: boolean;
  catalogoDaRedeAplicado: boolean;
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, ...catalogo }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchProducts: vi.fn(),
    fetchRecommendations: vi.fn(),
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
vi.mock("@/hooks/useRecomendacoesDeProduto", () => ({
  useRecomendacoesDeProduto: () => ({
    recomendacoes: [recomendado],
    carregando: false,
    consultado: true,
    recarregar: vi.fn(),
  }),
}));
vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { product: Product }) => <p>{product.name}</p>,
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("remove a recomendação guardada só quando o catálogo confirma que o item saiu", async () => {
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  vi.stubGlobal("IntersectionObserver", ObserverStub);
  vi.stubGlobal("CSS", { escape: (valor: string) => valor });
  try {
    const { ProductView } = await import("@/views/customer/ProductView");
    const desenhar = async (estado: typeof catalogo) => {
      catalogo = estado;
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
      return hospedeiro.textContent;
    };
    const semRecomendado = {
      products: [produto],
      loadingProducts: false,
      catalogoErro: false,
      catalogoDaRedeAplicado: true,
    };
    expect(
      await desenhar({ ...semRecomendado, products: [produto, recomendado] }),
    ).toContain(recomendado.name);
    expect(
      await desenhar({ ...semRecomendado, loadingProducts: true }),
    ).toContain(recomendado.name);
    expect(await desenhar({ ...semRecomendado, catalogoErro: true })).toContain(
      recomendado.name,
    );
    expect(
      await desenhar({ ...semRecomendado, catalogoDaRedeAplicado: false }),
    ).toContain(recomendado.name);
    expect(await desenhar(semRecomendado)).not.toContain(recomendado.name);
  } finally {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  }
});

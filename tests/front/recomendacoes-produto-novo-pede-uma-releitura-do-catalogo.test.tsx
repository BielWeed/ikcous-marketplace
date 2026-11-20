// @vitest-environment jsdom

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Product } from "@/types";
import { ProductView } from "@/views/customer/ProductView";

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

const fetchProducts = vi.fn();
let resposta: Product[];
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
    fetchProducts,
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
    recomendacoes: resposta,
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

let raiz: Root;
let hospedeiro: HTMLElement;

beforeEach(() => {
  fetchProducts.mockClear();
  resposta = [recomendado];
  catalogo = {
    products: [produto],
    loadingProducts: false,
    catalogoErro: false,
    catalogoDaRedeAplicado: true,
  };
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  vi.stubGlobal("IntersectionObserver", ObserverStub);
  vi.stubGlobal("CSS", { escape: (valor: string) => valor });
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function desenhar() {
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
}

it("relê o catálogo uma vez e mostra a recomendação quando o produto chega ativo", async () => {
  expect(await desenhar()).not.toContain(recomendado.name);
  expect(fetchProducts).toHaveBeenCalledTimes(1);

  catalogo = { ...catalogo, products: [produto, recomendado] };
  expect(await desenhar()).toContain(recomendado.name);
  expect(fetchProducts).toHaveBeenCalledTimes(1);
});

it("mantém o produto pausado oculto sem repetir a releitura para a mesma resposta", async () => {
  const pausado = { ...recomendado, isActive: false };
  catalogo = { ...catalogo, products: [produto, pausado] };
  expect(await desenhar()).not.toContain(recomendado.name);
  expect(fetchProducts).toHaveBeenCalledTimes(1);

  catalogo = { ...catalogo, catalogoErro: true };
  expect(await desenhar()).not.toContain(recomendado.name);
  catalogo = { ...catalogo, catalogoErro: false, products: [produto, pausado] };
  expect(await desenhar()).not.toContain(recomendado.name);
  expect(fetchProducts).toHaveBeenCalledTimes(1);

  resposta = [recomendado];
  expect(await desenhar()).not.toContain(recomendado.name);
  expect(fetchProducts).toHaveBeenCalledTimes(2);
});

it("não relê se toda a recomendação já estiver ativa no catálogo", async () => {
  catalogo = { ...catalogo, products: [produto, recomendado] };
  expect(await desenhar()).toContain(recomendado.name);
  expect(fetchProducts).not.toHaveBeenCalled();
});

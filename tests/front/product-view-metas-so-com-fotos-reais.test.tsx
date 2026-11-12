// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
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
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const marcador = "https://placehold.co/600x600?text=Sem+Imagem";
const foto = "https://catalogo.fixture.invalid/foto.jpg";
const outraFoto = "https://catalogo.fixture.invalid/outra.jpg";
const produto: Product = {
  id: "produto-fotos-fixture",
  name: "Produto de teste",
  description: "Descrição de teste",
  price: 100,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-11-11T00:00:00.000Z",
};

describe("ProductView — metadados só anunciam fotos reais", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let headAnterior: string;

  beforeEach(() => {
    headAnterior = document.head.innerHTML;
    document.head.innerHTML = "";
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (valor: string) => valor });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.head.innerHTML = headAnterior;
    vi.unstubAllGlobals();
  });

  async function renderizar(images: string[]) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={{ ...produto, images }}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
    const script = document.getElementById("product-structured-data");
    expect(script).not.toBeNull();
    return JSON.parse(script?.textContent ?? "{}");
  }

  it("omite image, og:image e twitter:image quando só há marcador", async () => {
    const schema = await renderizar([marcador]);
    expect(schema).not.toHaveProperty("image");
    expect(document.querySelector('meta[property="og:image"]')).toBeNull();
    expect(document.querySelector('meta[name="twitter:image"]')).toBeNull();
  });

  it("preserva as fotos reais e usa a primeira nas prévias", async () => {
    const schema = await renderizar([foto, outraFoto]);
    expect(schema.image).toEqual([foto, outraFoto]);
    expect(
      document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute("content"),
    ).toBe(foto);
    expect(
      document
        .querySelector('meta[name="twitter:image"]')
        ?.getAttribute("content"),
    ).toBe(foto);
  });

  it("ignora o marcador antes da primeira foto real no array misto", async () => {
    const schema = await renderizar([marcador, foto, outraFoto]);
    expect(schema.image).toEqual([foto, outraFoto]);
    expect(
      document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute("content"),
    ).toBe(foto);
    expect(
      document
        .querySelector('meta[name="twitter:image"]')
        ?.getAttribute("content"),
    ).toBe(foto);
  });
});

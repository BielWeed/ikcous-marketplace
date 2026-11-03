// @vitest-environment jsdom
//
// Caça (rodada 1, achado b3): os dados que a Home entrega ao Google
// anunciavam uma busca por endereço ("/?search=termo"), mas nada no app lê
// esse parâmetro -- quem chegava por ali caía na Home sem busca. A promessa
// falsa (`potentialAction` / SearchAction) sai; o resto do JSON-LD fica.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const metaRecebido = vi.hoisted(() => ({
  chamadas: [] as Array<{ jsonLd?: unknown; jsonLdId?: string }>,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [],
    loading: false,
    getBannersByPosition: () => [],
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));

vi.mock("@/hooks/useDocumentMeta", () => ({
  useDocumentMeta: (opcoes: { jsonLd?: unknown; jsonLdId?: string }) => {
    metaRecebido.chamadas.push(opcoes);
    return {};
  },
}));

vi.mock("@/components/ui/custom/BannerCarousel", () => ({
  BannerCarousel: () => null,
}));
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/components/ui/custom/FreeShippingBlock", () => ({
  FreeShippingBlock: () => null,
}));
vi.mock("@/components/ui/custom/InfoBlockCarousel", () => ({
  InfoBlockCarousel: () => null,
}));
vi.mock("@/components/ui/custom/PremiumOffers", () => ({
  PremiumOffers: () => null,
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));
vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("HomeView — dados para o Google", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    metaRecebido.chamadas = [];
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

  it("não promete busca por endereço (?search=), mas segue dizendo nome e endereço da loja", async () => {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={[]}
          favorites={[]}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onNavigate={vi.fn()}
          searchQuery=""
          selectedCategory="Todas"
          onCategoryChange={vi.fn()}
          sortBy="default"
          onSortByChange={vi.fn()}
        />,
      );
    });

    const comJsonLd = metaRecebido.chamadas.find(
      (c) => c.jsonLdId === "home-structured-data",
    );
    expect(comJsonLd).toBeTruthy();
    const jsonLd = comJsonLd?.jsonLd as Record<string, unknown>;
    expect(jsonLd["@type"]).toBe("WebSite");
    expect(jsonLd.url).toBe(globalThis.location.origin);
    expect(jsonLd).not.toHaveProperty("potentialAction");
    expect(JSON.stringify(jsonLd)).not.toContain("search_term_string");
  });
});

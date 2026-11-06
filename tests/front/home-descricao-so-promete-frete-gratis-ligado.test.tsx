// @vitest-environment jsdom
//
// Caça de 03/11/2026 (achado e7): a descrição da Home (og:description e
// twitter:description, a prévia de link no WhatsApp) dizia "com frete grátis
// em <cidade>" para toda loja de entrega local com cidade preenchida, mesmo
// com o frete grátis DESLIGADO (mínimo 0) ou só "por produto" (-1). A frase
// só pode existir com o frete grátis ligado (`freeShippingMin > 0`), a mesma
// régua do cartão de frete grátis da própria Home.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreConfig } from "@/types";

let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-teste" } }),
}));
// O carrossel (embla) precisa de matchMedia, que o jsdom não tem.
vi.mock("@/components/ui/custom/InfoBlockCarousel", () => ({
  InfoBlockCarousel: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("HomeView — a descrição só promete frete grátis quando ele está ligado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = {};
    vi.stubGlobal("CSS", { escape: (v: string) => v });
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

  async function renderizarHome() {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={[]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          searchQuery=""
          selectedCategory="Todas"
          onCategoryChange={() => {}}
          sortBy="default"
          onSortByChange={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const descricoes = () => ({
    og: document.head
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content"),
    twitter: document.head
      .querySelector('meta[name="twitter:description"]')
      ?.getAttribute("content"),
  });

  it.each([
    ["desligado", 0],
    ["por produto", -1],
  ])(
    "entrega local com cidade e frete grátis %s: não promete frete grátis",
    async (_nome, freeShippingMin) => {
      mockConfig = {
        shippingCoverage: "local",
        storeCity: "Monte Carmelo",
        storeState: "MG",
        freeShippingMin,
      };
      await renderizarHome();

      const { og, twitter } = descricoes();
      expect(og).not.toContain("frete grátis");
      expect(twitter).not.toContain("frete grátis");
      expect(og).toContain("Descubra produtos exclusivos.");
      expect(twitter).toContain("Descubra produtos exclusivos.");
    },
  );

  it("Só retiro (sem entrega própria) com cobertura local e frete grátis salvo: não promete frete grátis", async () => {
    mockConfig = {
      shippingCoverage: "local",
      localDeliveryEnabled: false,
      enabledShippingMethods: ["store-pickup"],
      storeCity: "Monte Carmelo",
      storeState: "MG",
      freeShippingMin: 50,
    };
    await renderizarHome();

    const { og, twitter } = descricoes();
    expect(og).not.toContain("frete grátis");
    expect(twitter).not.toContain("frete grátis");
    expect(og).toContain("Descubra produtos exclusivos.");
  });

  it("controle: entrega local com cidade e frete grátis ligado continua prometendo na cidade", async () => {
    mockConfig = {
      shippingCoverage: "local",
      storeCity: "Monte Carmelo",
      storeState: "MG",
      freeShippingMin: 50,
    };
    await renderizarHome();

    const { og, twitter } = descricoes();
    expect(og).toContain("frete grátis em Monte Carmelo");
    expect(twitter).toContain("frete grátis em Monte Carmelo");
  });
});

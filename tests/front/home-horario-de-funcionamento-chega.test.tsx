// @vitest-environment jsdom
//
// Item 6 do laudo "o que falta" (29/08, degrau 2 — promete o que não
// cumpre): o painel promete "Informa aos clientes no PWA" para o Horário de
// Funcionamento, mas o dado (config.businessHours, coluna business_hours de
// store_config) nunca era exibido em lugar nenhum do lado do cliente — grep
// zero de consumidores.
//
// O conserto: bloco discreto no fim da vitrine (HomeView), só quando a
// lojista preencheu. Este teste monta a HomeView de verdade (createRoot +
// act, filhos pesados dublados como fragments — o que se mede é a promessa,
// não os carrosséis).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configAtual: Record<string, unknown> = {};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configAtual }),
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
  useDocumentMeta: () => ({}),
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
  ProductList: () => <div data-testid="product-list" />,
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// testes irmãos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("HomeView — o Horário de Funcionamento chega ao cliente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    configAtual = {};
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar() {
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
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("lojista preencheu o horário: o cliente lê na vitrine", async () => {
    configAtual = { businessHours: "Seg a Sáb, 8h às 18h" };
    await montar();

    expect(hospedeiro.textContent).toContain("Horário de atendimento");
    expect(hospedeiro.textContent).toContain("Seg a Sáb, 8h às 18h");
  });

  it("lojista NÃO preencheu: nenhum bloco de horário vazio na tela", async () => {
    configAtual = { businessHours: "" };
    await montar();

    expect(hospedeiro.textContent).not.toContain("Horário de atendimento");
  });
});

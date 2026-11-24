// @vitest-environment jsdom
//
// Borda do bloco "Horário de atendimento" do fim da vitrine: horário gravado
// só com espaços ou quebras de linha (a lojista apagou o texto mas sobrou
// um espaço) NÃO pode virar um cartão com o rótulo e nada embaixo — régua da
// casa: sem valor, sem rótulo. O teste vizinho
// (`home-horario-de-funcionamento-chega`) só prova o campo vazio (""), e uma
// mutação que tirava o `trim()` da condição passava sem ninguém notar.
// Mesmo harness do vizinho: HomeView de verdade, filhos pesados dublados.
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("HomeView — horário só com espaços não vira bloco vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it.each([
    ["só espaços", "     "],
    ["quebras de linha e tabulação", "\n \t\n"],
    ["nulo", null],
  ])(
    "horário %s: sem o rótulo 'Horário de atendimento'",
    async (_nome, valor) => {
      configAtual = { businessHours: valor };
      await montar();
      expect(hospedeiro.textContent).not.toContain("Horário de atendimento");
    },
  );

  it("horário preenchido com espaços em volta: o bloco existe e mostra o texto", async () => {
    configAtual = { businessHours: "  Seg a Sex, 9h às 17h \n" };
    await montar();
    expect(hospedeiro.textContent).toContain("Horário de atendimento");
    expect(hospedeiro.textContent).toContain("Seg a Sex, 9h às 17h");
  });

  it("sem horário, os links das políticas continuam no fim da vitrine", async () => {
    configAtual = { businessHours: "   " };
    await montar();
    expect(
      hospedeiro.querySelector('[data-testid="rodape-das-politicas"]'),
    ).not.toBeNull();
  });
});

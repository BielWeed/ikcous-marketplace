// @vitest-environment jsdom
//
// Defeito medido: numa loja, a cliente não achava Termos de uso, Política de
// Privacidade nem Trocas e devoluções em lugar nenhum. O rodapé da vitrine
// (fim da Home) agora traz os três links, SEMPRE — não dependem de a lojista
// ter preenchido horário ou contato. Harness herdado do teste do horário.
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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("HomeView — a cliente acha as políticas da loja no rodapé", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

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
          onNavigate={onNavigate}
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

  it("os três links existem, com texto claro e alvo de toque de 44px", async () => {
    await montar();
    const nav = hospedeiro.querySelector('nav[aria-label="Políticas da loja"]');
    expect(nav).not.toBeNull();
    const botoes = [...(nav?.querySelectorAll("button") ?? [])];
    expect(botoes.map((b) => b.textContent)).toEqual([
      "Termos de uso",
      "Política de Privacidade",
      "Trocas e devoluções",
    ]);
    for (const b of botoes) expect(b.className).toContain("min-h-11");
  });

  it("aparecem mesmo sem horário nem contato cadastrados", async () => {
    configAtual = {};
    await montar();
    expect(hospedeiro.textContent).not.toContain("Horário de atendimento");
    expect(hospedeiro.textContent).toContain("Termos de uso");
  });

  it("cada link leva à própria página", async () => {
    await montar();
    const botoes = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>(
        'nav[aria-label="Políticas da loja"] button',
      ),
    ];
    for (const b of botoes) act(() => b.click());
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual([
      "terms",
      "privacy",
      "returns-policy",
    ]);
  });
});

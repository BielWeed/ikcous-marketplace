// @vitest-environment jsdom
//
// O seletor "Quantos produtos mostrar" do painel oferece até 10. O corte de
// carga das faixas automáticas tinha um 6 fixo que travava a vitrine abaixo
// do que a lojista escolheu (ela via 10 na prévia e a cliente via 6). A
// constante nova só era vigiada por uma varredura de texto: nada provava, na
// loja desenhada, que 10 escolhidos viram 10 na tela. Doze produtos
// elegíveis em cada faixa, máximo 10: a loja mostra os 10 mais novos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";
import { HomeView } from "@/views/customer/HomeView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const configDaLoja = vi.hoisted(() => ({
  homeSections: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja, isLoaded: true }),
}));
vi.mock("@/lib/supabase", () => {
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.single = () => Promise.resolve({ data: null, error: null });
  return {
    supabase: {
      from: () => consulta,
      rpc: () => Promise.resolve({ data: false, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
    },
  };
});
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "roupas", name: "Roupas", isActive: true }],
    isLoading: false,
  }),
}));
// Os dois componentes de faixa viram dublês que só expõem o título e a ordem
// dos produtos recebidos: o que está em dúvida é QUAIS produtos a Home escolhe.
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: ({
    title,
    products,
  }: {
    readonly title: string;
    readonly products: readonly Product[];
  }) => (
    <section data-faixa={title}>
      {products.map((p) => (
        <i key={p.id} data-na-faixa={p.id} />
      ))}
    </section>
  ),
}));
vi.mock("@/components/ui/custom/PremiumOffers", () => ({
  PremiumOffers: ({
    title,
    products,
  }: {
    readonly title: string;
    readonly products: readonly Product[];
  }) => (
    <section data-faixa={title}>
      {products.map((p) => (
        <i key={p.id} data-na-faixa={p.id} />
      ))}
    </section>
  ),
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: () => null,
}));

const produto = (id: string, extras: Partial<Product> = {}): Product => ({
  id,
  name: `Produto ${id}`,
  description: "",
  price: 100,
  images: ["https://cdn.exemplo/foto.jpg"],
  category: "Roupas",
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-08T00:00:00.000Z",
  ...extras,
});

describe("HomeView — a faixa mostra tantos produtos quanto a lojista escolheu", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (valor: string) => valor });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const naFaixa = (titulo: string) =>
    Array.from(
      hospedeiro.querySelectorAll(`[data-faixa="${titulo}"] [data-na-faixa]`),
    ).map((el) => el.getAttribute("data-na-faixa"));

  it("com máximo 10 e 12 produtos elegíveis, Lançamentos, Ofertas e Destaques mostram os 10 mais novos", async () => {
    configDaLoja.homeSections = [
      {
        id: "new_arrivals",
        title: "Últimos Lançamentos",
        active: true,
        maxItems: 10,
      },
      {
        id: "offers",
        title: "Ofertas Imperdíveis",
        active: true,
        maxItems: 10,
      },
      {
        id: "bestsellers",
        title: "Destaques em Alta",
        active: true,
        maxItems: 10,
      },
    ];
    // p01 é o mais velho e p12 o mais novo: ficam de fora os 2 mais velhos.
    const produtos = Array.from({ length: 12 }, (_, i) =>
      produto(`p${String(i + 1).padStart(2, "0")}`, {
        createdTime: (i + 1) * 1000,
        isBestseller: true,
        originalPrice: 150,
      }),
    );
    await act(async () => {
      raiz.render(
        <HomeView
          products={produtos}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          selectedCategory="Todas"
          searchQuery=""
          sortBy="default"
          onCategoryChange={() => {}}
          onSortByChange={() => {}}
        />,
      );
    });
    const dez = [
      "p12",
      "p11",
      "p10",
      "p09",
      "p08",
      "p07",
      "p06",
      "p05",
      "p04",
      "p03",
    ];
    expect(naFaixa("Últimos Lançamentos")).toEqual(dez);
    expect(naFaixa("Ofertas Imperdíveis")).toEqual(dez);
    expect(naFaixa("Destaques em Alta")).toEqual(dez);
  });
});

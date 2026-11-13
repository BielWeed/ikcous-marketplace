// @vitest-environment jsdom
//
// A Home entrega à faixa de Ofertas os produtos na ordem da lojista quando a
// seção tem lista de ids (escolha à mão), e precisa AVISAR a faixa para ela não
// reordenar por desconto. Seção automática não avisa: segue maior desconto.
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

const estado = vi.hoisted(() => ({
  homeSections: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { homeSections: estado.homeSections },
    isLoaded: true,
  }),
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
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));
vi.mock("@/components/ui/custom/PremiumOffers", () => ({
  PremiumOffers: ({
    title,
    products,
    ordemDaLojista,
  }: {
    readonly title: string;
    readonly products: readonly Product[];
    readonly ordemDaLojista?: boolean;
  }) => (
    <section data-faixa={title} data-da-lojista={String(!!ordemDaLojista)}>
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

describe("HomeView — ofertas escolhidas à mão mantêm a ordem da lojista", () => {
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

  const render = async () => {
    await act(async () => {
      raiz.render(
        <HomeView
          products={[
            produto("A", { originalPrice: 110 }),
            produto("B", { originalPrice: 200 }),
          ]}
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
  };

  const faixa = () => hospedeiro.querySelector("[data-faixa='Ofertas']");

  it("seção com ids escolhidos: a faixa recebe os produtos na ordem da lojista e é avisada", async () => {
    estado.homeSections = [
      {
        id: "offers",
        title: "Ofertas",
        active: true,
        productIds: ["A", "B"],
      },
    ];
    await render();
    expect(faixa()?.getAttribute("data-da-lojista")).toBe("true");
    expect(
      Array.from(faixa()?.querySelectorAll("[data-na-faixa]") ?? []).map((el) =>
        el.getAttribute("data-na-faixa"),
      ),
    ).toEqual(["A", "B"]);
  });

  it("seção automática (sem ids): a faixa NÃO é avisada", async () => {
    estado.homeSections = [{ id: "offers", title: "Ofertas", active: true }];
    await render();
    expect(faixa()?.getAttribute("data-da-lojista")).toBe("false");
  });

  it("seção com lista de ids vazia conta como automática", async () => {
    estado.homeSections = [
      { id: "offers", title: "Ofertas", active: true, productIds: [] },
    ];
    await render();
    expect(faixa()?.getAttribute("data-da-lojista")).toBe("false");
  });
});

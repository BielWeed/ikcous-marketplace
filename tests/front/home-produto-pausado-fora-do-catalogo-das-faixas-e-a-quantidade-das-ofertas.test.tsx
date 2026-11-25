// @vitest-environment jsdom
//
// Caça por mutação na Home da cliente: dois pontos que nenhum teste vizinho
// prendia.
//   - o produto PAUSADO pela lojista não aparece em lugar nenhum da Home: nem
//     no Catálogo, nem na contagem lida pelo leitor de tela, nem nas três
//     faixas automáticas (as regras das faixas recebem só "produtos à venda" e
//     confiam que a Home já tirou os pausados), nem na faixa escolhida à mão;
//   - a memória da última visita guarda quantas ofertas a faixa mostrou. Loja
//     que não tem a vitrine "Ofertas" na lista usa o legado: no máximo 6.
//
// Monta a HomeView de verdade; só os filhos pesados viram marcas que expõem os
// ids dos produtos que recebem.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerMemoriaDaHome } from "@/hooks/useMemoriaDaHome";
import type { Product } from "@/types";
import { HomeView } from "@/views/customer/HomeView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cenario = vi.hoisted(() => ({
  config: { freeShippingMin: 0 } as Record<string, unknown>,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: cenario.config,
    isLoaded: true,
    catalogoErro: false,
    fetchProducts: vi.fn(async () => {}),
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
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/hooks/useDocumentMeta", () => ({ useDocumentMeta: () => ({}) }));
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/components/ui/custom/FreeShippingBlock", () => ({
  FreeShippingBlock: () => null,
}));
const idsDe = (products: Product[]) => products.map((p) => p.id).join(",");
vi.mock("@/components/ui/custom/PremiumOffers", () => ({
  PremiumOffers: ({
    title,
    products,
  }: {
    title: string;
    products: Product[];
  }) => (
    <div data-testid="vitrine" data-titulo={title} data-ids={idsDe(products)} />
  ),
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: ({
    title,
    products,
  }: {
    title: string;
    products: Product[];
  }) => (
    <div data-testid="vitrine" data-titulo={title} data-ids={idsDe(products)} />
  ),
}));
vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: ({ products }: { products: Product[] }) => (
    <div data-testid="grade" data-ids={idsDe(products)} />
  ),
}));

const produto = (id: string, extras: Partial<Product> = {}): Product =>
  ({
    id,
    name: `Produto ${id}`,
    description: "",
    price: 50,
    images: ["https://cdn.exemplo/foto.jpg"],
    category: "Roupas",
    stock: 5,
    isActive: true,
    isBestseller: false,
    createdTime: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  }) as unknown as Product;

describe("HomeView — produto pausado e quantidade de ofertas", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;
  let dados: Map<string, string>;

  beforeEach(() => {
    cenario.config = { freeShippingMin: 0 };
    dados = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: (k: string, v: string) => dados.set(k, v),
      removeItem: (k: string) => dados.delete(k),
    });
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    hospedeiro = document.createElement("main");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function montaHome(products: Product[]) {
    act(() =>
      raiz.render(
        <HomeView
          products={products}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          searchQuery=""
          selectedCategory="Todas"
          onCategoryChange={() => {}}
          sortBy="default"
          onSortByChange={() => {}}
          isLoading={false}
        />,
      ),
    );
  }
  const ids = (seletor: string) =>
    Array.from(hospedeiro.querySelectorAll(seletor), (el) =>
      el.getAttribute("data-ids"),
    );
  const contagem = () =>
    hospedeiro
      .querySelector('[data-testid="resultado-categoria"]')
      ?.textContent?.replace(/\s+/g, " ")
      .trim();

  // O pausado é o MAIS NOVO, destaque e oferta: se a Home não o tirasse, ele
  // abriria todas as listas.
  const pausado = produto("pausado", {
    isActive: false,
    isBestseller: true,
    originalPrice: 100,
    createdTime: 9,
  });
  const oferta = produto("oferta", {
    isBestseller: true,
    originalPrice: 100,
    createdTime: 3,
  });
  const comum = produto("comum", { createdTime: 2 });

  it("o Catálogo não lista o pausado e a contagem não o conta", () => {
    montaHome([pausado, oferta, comum]);
    expect(ids('[data-testid="grade"]')).toEqual(["oferta,comum"]);
    expect(contagem()).toBe("Todas · 2 produtos");
  });

  it("as três faixas automáticas não mostram o pausado", () => {
    montaHome([pausado, oferta, comum]);
    expect(
      Array.from(
        hospedeiro.querySelectorAll('[data-testid="vitrine"]'),
        (v) => [v.getAttribute("data-titulo"), v.getAttribute("data-ids")],
      ),
    ).toEqual([
      ["Últimos Lançamentos", "oferta,comum"],
      ["Ofertas Imperdíveis", "oferta"],
      ["Destaques em Alta", "oferta"],
    ]);
  });

  it("a faixa escolhida à mão também não mostra o pausado, nem o conta na memória", () => {
    cenario.config = {
      freeShippingMin: 0,
      homeSections: [
        {
          id: "curada",
          title: "Seleção da lojista",
          active: true,
          productIds: ["pausado", "comum", "oferta"],
        },
      ],
    };
    montaHome([pausado, oferta, comum]);
    expect(ids('[data-testid="vitrine"]')).toEqual(["comum,oferta"]);
    expect(lerMemoriaDaHome()?.vitrines?.curada?.qtd).toBe(2);
  });

  describe("memória da última visita: quantas ofertas a faixa mostrou", () => {
    const ofertas = (quantas: number) =>
      Array.from({ length: quantas }, (_, i) =>
        produto(`o${i}`, { originalPrice: 100, createdTime: 100 - i }),
      );
    // Sem a vitrine "offers" na lista da lojista: vale o campo legado.
    const semVitrineDeOfertas = {
      freeShippingMin: 0,
      homeSections: [
        { id: "new_arrivals", title: "Últimos Lançamentos", active: true },
      ],
    };

    it("com 8 ofertas e sem a vitrine 'Ofertas' na lista, o legado guarda no máximo 6", () => {
      cenario.config = semVitrineDeOfertas;
      montaHome(ofertas(8));
      expect(lerMemoriaDaHome()?.qtdOfertas).toBe(6);
    });

    it("com 4 ofertas, guarda 4 (o teto não inventa ofertas)", () => {
      cenario.config = semVitrineDeOfertas;
      montaHome(ofertas(4));
      expect(lerMemoriaDaHome()?.qtdOfertas).toBe(4);
    });

    it("com a vitrine 'Ofertas' na lista vale a quantidade que ela mostra, não o legado", () => {
      cenario.config = {
        freeShippingMin: 0,
        homeSections: [
          { id: "offers", title: "Ofertas", active: true, maxItems: 8 },
        ],
      };
      montaHome(ofertas(9));
      expect(lerMemoriaDaHome()?.qtdOfertas).toBe(8);
    });
  });
});

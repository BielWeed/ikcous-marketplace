// @vitest-environment jsdom
//
// Bordas da Home que os testes de cada assunto deixavam passar:
//   - "N produtos" lido pelo leitor de tela: zero é plural ("0 produtos") e a
//     categoria com um só produto é singular;
//   - sem vitrines configuradas (lista vazia, não ausente) a Home não inventa
//     as três vitrines de fábrica; ausente, mostra as três;
//   - catálogo que falhou com UM produto guardado no aparelho e a categoria
//     escolhida sem nenhum: diz "não conseguimos atualizar" (a loja tem
//     produto, só não deu para conferir), e não "carregar os produtos".
//
// Monta a HomeView de verdade; só os filhos pesados viram marcas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";
import { HomeView } from "@/views/customer/HomeView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cenario = vi.hoisted(() => ({
  config: { freeShippingMin: 0 } as Record<string, unknown>,
  catalogoErro: false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: cenario.config,
    isLoaded: true,
    catalogoErro: cenario.catalogoErro,
    fetchProducts: vi.fn(async () => {}),
  }),
}));
// A Home importa o bloco de frete grátis, que importa o cliente Supabase:
// mesmo isolamento de rede dos outros testes da Home.
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
    categories: [
      { id: "c1", name: "Roupas", isActive: true },
      { id: "c2", name: "Calçados", isActive: true },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useDocumentMeta", () => ({ useDocumentMeta: () => ({}) }));
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/components/ui/custom/PremiumOffers", () => ({
  PremiumOffers: ({ title }: { title: string }) => (
    <div data-testid="vitrine">{title}</div>
  ),
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: ({ title }: { title: string }) => (
    <div data-testid="vitrine">{title}</div>
  ),
}));
vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: ({
    products,
    isLoading,
  }: {
    products: Product[];
    isLoading: boolean;
  }) => (
    <div
      data-testid="grade"
      data-total={products.length}
      data-carregando={String(isLoading)}
    />
  ),
}));

const produto = (id: string, category: string): Product =>
  ({
    id,
    name: `Produto ${id}`,
    description: "",
    price: 10,
    images: ["https://cdn.exemplo/foto.jpg"],
    category,
    stock: 5,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as Product;

describe("HomeView — bordas das vitrines e do catálogo vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;

  beforeEach(() => {
    cenario.config = { freeShippingMin: 0 };
    cenario.catalogoErro = false;
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

  function montaHome(
    products: Product[],
    selectedCategory = "Todas",
    isLoading = false,
    extras: Partial<Parameters<typeof HomeView>[0]> = {},
  ) {
    act(() =>
      raiz.render(
        <HomeView
          {...extras}
          isLoading={isLoading}
          products={products}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          searchQuery=""
          selectedCategory={selectedCategory}
          onCategoryChange={() => {}}
          sortBy="default"
          onSortByChange={() => {}}
        />,
      ),
    );
  }
  const contagem = () =>
    hospedeiro
      .querySelector('[data-testid="resultado-categoria"]')
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
  const vitrines = () =>
    Array.from(hospedeiro.querySelectorAll('[data-testid="vitrine"]'), (v) =>
      v.textContent?.trim(),
    );

  describe("enquanto carrega", () => {
    it("a grade do Catálogo é avisada de que carrega (esqueletos no lugar dos produtos)", () => {
      montaHome([produto("a", "Roupas")], "Todas", true);
      expect(
        hospedeiro
          .querySelector('[data-testid="grade"]')
          ?.getAttribute("data-carregando"),
      ).toBe("true");
      expect(contagem()).toBe("Todas · Carregando produtos…");
    });

    it("carregando sem nenhum produto ainda: esqueletos, nunca 'nenhum produto'", () => {
      montaHome([], "Todas", true);
      expect(hospedeiro.querySelector('[data-testid="grade"]')).not.toBeNull();
      expect(hospedeiro.textContent).not.toContain("Nenhum produto");
    });

    it("terminou de carregar: a grade para de mostrar esqueletos", () => {
      montaHome([produto("a", "Roupas")], "Todas", false);
      expect(
        hospedeiro
          .querySelector('[data-testid="grade"]')
          ?.getAttribute("data-carregando"),
      ).toBe("false");
    });
  });

  describe("contagem lida pelo leitor de tela", () => {
    it("zero produtos na categoria: '0 produtos' (plural)", () => {
      montaHome([produto("a", "Roupas")], "Calçados");
      expect(contagem()).toBe("Calçados · 0 produtos");
    });

    it("um produto na categoria: '1 produto' (singular)", () => {
      montaHome([produto("a", "Roupas"), produto("b", "Calçados")], "Calçados");
      expect(contagem()).toBe("Calçados · 1 produto");
    });

    it("dois produtos: '2 produtos'", () => {
      montaHome([produto("a", "Roupas"), produto("b", "Roupas")], "Roupas");
      expect(contagem()).toBe("Roupas · 2 produtos");
    });
  });

  describe("vitrines configuradas", () => {
    it("sem configuração (ausente), a Home mostra as três vitrines de fábrica", () => {
      cenario.config = {
        freeShippingMin: 0,
      };
      montaHome([
        {
          ...produto("a", "Roupas"),
          isBestseller: true,
          originalPrice: 20,
        } as Product,
      ]);
      expect(vitrines()).toEqual([
        "Últimos Lançamentos",
        "Ofertas Imperdíveis",
        "Destaques em Alta",
      ]);
    });

    it("lista de vitrines vazia (a lojista não tem nenhuma): nenhuma vitrine, só o Catálogo", () => {
      cenario.config = { freeShippingMin: 0, homeSections: [] };
      montaHome([
        {
          ...produto("a", "Roupas"),
          isBestseller: true,
          originalPrice: 20,
        } as Product,
      ]);
      expect(vitrines()).toEqual([]);
      expect(hospedeiro.querySelector('[data-testid="grade"]')).not.toBeNull();
    });
  });

  describe("cabeçalho que encosta na barra de filtros", () => {
    // O marcador (div h-0 antes da barra de filtros) é comparado ao topo do
    // <main> que rola: encostou ou passou = "acoplado".
    let topoDoMarcador = 300;
    beforeEach(() => {
      topoDoMarcador = 300;
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        const top = this.tagName === "MAIN" ? 100 : topoDoMarcador;
        return { top } as DOMRect;
      });
    });
    afterEach(() => vi.restoreAllMocks());

    const rolar = (topo: number) => {
      topoDoMarcador = topo;
      act(() => {
        hospedeiro.dispatchEvent(new Event("scroll"));
      });
    };

    it("avisa só quando MUDA: encostou (borda exata incluída), repetiu, soltou", () => {
      const avisos: boolean[] = [];
      montaHome([produto("a", "Roupas")], "Todas", false, {
        onHeaderDockChange: (acoplado) => avisos.push(acoplado),
      });
      // Marcador abaixo do topo do <main>: nada a avisar na montagem.
      expect(avisos).toEqual([]);
      rolar(100);
      expect(avisos).toEqual([true]);
      rolar(100);
      rolar(40);
      expect(avisos).toEqual([true]);
      rolar(101);
      expect(avisos).toEqual([true, false]);
    });

    it("já montada encostada: avisa logo na montagem", () => {
      topoDoMarcador = 100;
      const avisos: boolean[] = [];
      montaHome([produto("a", "Roupas")], "Todas", false, {
        onHeaderDockChange: (acoplado) => avisos.push(acoplado),
      });
      expect(avisos).toEqual([true]);
    });
  });

  describe("catálogo que falhou com produto guardado no aparelho", () => {
    it("UM produto guardado e a categoria sem nenhum: 'não conseguimos atualizar'", () => {
      cenario.catalogoErro = true;
      montaHome([produto("a", "Roupas")], "Calçados");
      const aviso = hospedeiro.querySelector('[role="alert"]');
      expect(aviso?.textContent).toContain(
        "Não conseguimos atualizar a loja agora",
      );
      expect(aviso?.textContent).not.toContain("carregar os produtos");
    });

    it("nenhum produto guardado: 'não conseguimos carregar os produtos'", () => {
      cenario.catalogoErro = true;
      montaHome([], "Todas");
      const aviso = hospedeiro.querySelector('[role="alert"]');
      expect(aviso?.textContent).toContain(
        "Não conseguimos carregar os produtos",
      );
    });
  });
});

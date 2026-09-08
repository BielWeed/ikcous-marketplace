// @vitest-environment jsdom
// HomeView e ProductList reais: o catálogo ao vivo não deve apagar páginas
// já carregadas. Os cards só expõem os produtos que a grade decidiu mostrar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductList } from "@/components/ui/custom/ProductList";
import type { Product, SortOption } from "@/types";
import { HomeView } from "@/views/customer/HomeView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mesmo stub local dos testes da Home, com disparo controlado e desconexão
// efetiva para exercitar também a remontagem do sentinela quando a lista cresce.
class IntersectionObserverStub {
  static ativos = new Set<IntersectionObserverStub>();
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe() {
    IntersectionObserverStub.ativos.add(this);
  }
  unobserve() {
    this.disconnect();
  }
  disconnect() {
    IntersectionObserverStub.ativos.delete(this);
  }
  intersectar() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true }),
}));

// FreeShippingBlock importa o cliente Supabase mesmo sem banners na Home.
// Mesmo isolamento de rede de produto-pausado-nao-aparece-na-vitrine.
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
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { readonly product: Product }) => (
    <article data-produto={product.id} data-estoque={product.stock}>
      {product.name}
    </article>
  ),
}));

const criarProdutos = (quantidade = 40): Product[] =>
  Array.from({ length: quantidade }, (_, indice) => ({
    id: `produto-${indice + 1}`,
    name: `Produto ${indice + 1}`,
    description: "Produto de teste",
    price: indice + 1,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-09-08T00:00:00.000Z",
  }));

interface Filtros {
  selectedCategory: string;
  searchQuery: string;
  sortBy: SortOption;
}

describe("vitrine mantém as páginas carregadas quando o catálogo muda", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    IntersectionObserverStub.ativos.clear();
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

  const produtosVisiveis = () => hospedeiro.querySelectorAll("[data-produto]");

  const montarHome = async (
    products: Product[],
    filtros: Partial<Filtros> = {},
  ) => {
    await act(async () => {
      raiz.render(
        <HomeView
          products={products}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          selectedCategory="Todas"
          searchQuery=""
          sortBy="default"
          onCategoryChange={() => {}}
          onSortByChange={() => {}}
          {...filtros}
        />,
      );
    });
  };

  const montarLista = async (products: Product[], resetKey?: string) => {
    await act(async () => {
      raiz.render(
        <ProductList
          products={products}
          resetKey={resetKey}
          isLoading={false}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      );
    });
  };

  const carregarMais = () => {
    const observadores = Array.from(IntersectionObserverStub.ativos);
    expect(observadores).toHaveLength(1);
    act(() => {
      for (const observador of observadores) observador.intersectar();
    });
  };

  const carregarTresPaginas = () => {
    expect(produtosVisiveis()).toHaveLength(12);
    carregarMais();
    expect(produtosVisiveis()).toHaveLength(24);
    carregarMais();
    expect(produtosVisiveis()).toHaveLength(36);
  };

  it.each(["mesmo conteúdo", "estoque alterado"])(
    "preserva 36 produtos ao receber array novo com %s e o mesmo filtro",
    async (mudanca) => {
      const produtos = criarProdutos();
      await montarHome(produtos);
      carregarTresPaginas();

      const atualizados = produtos.map((produto) => ({
        ...produto,
        stock:
          mudanca === "estoque alterado" && produto.id === "produto-1"
            ? 9
            : produto.stock,
      }));
      await montarHome(atualizados);

      expect(produtosVisiveis()).toHaveLength(36);
      expect(
        hospedeiro
          .querySelector('[data-produto="produto-1"]')
          ?.getAttribute("data-estoque"),
      ).toBe(mudanca === "estoque alterado" ? "9" : "10");
    },
  );

  it.each<{ nome: string; filtros: Partial<Filtros> }>([
    { nome: "categoria", filtros: { selectedCategory: "geral" } },
    { nome: "busca", filtros: { searchQuery: "Produto" } },
    { nome: "ordenação", filtros: { sortBy: "price-desc" } },
  ])("volta para 12 quando muda $nome", async ({ filtros }) => {
    const produtos = criarProdutos();
    await montarHome(produtos);
    carregarTresPaginas();

    await montarHome(produtos, filtros);

    expect(produtosVisiveis()).toHaveLength(12);
    carregarMais();
    expect(produtosVisiveis()).toHaveLength(24);
  });

  it("mostra os 30 restantes após pausas e volta a carregar quando entram novos", async () => {
    const produtos = criarProdutos();
    await montarHome(produtos);
    carregarTresPaginas();

    await montarHome(
      produtos.map((produto, indice) => ({
        ...produto,
        isActive: indice < 30,
      })),
    );
    expect(produtosVisiveis()).toHaveLength(30);
    expect(hospedeiro.querySelector('[data-produto="produto-31"]')).toBeNull();
    expect(IntersectionObserverStub.ativos.size).toBe(0);

    await montarHome(criarProdutos(50));
    expect(produtosVisiveis()).toHaveLength(36);
    carregarMais();
    expect(produtosVisiveis()).toHaveLength(48);
    carregarMais();
    expect(produtosVisiveis()).toHaveLength(50);
    expect(IntersectionObserverStub.ativos.size).toBe(0);
  });

  it("sem resetKey mantém o reset antigo por identidade de products", async () => {
    const produtos = criarProdutos();
    await montarLista(produtos);
    carregarTresPaginas();
    await montarLista([...produtos]);
    expect(produtosVisiveis()).toHaveLength(12);
  });

  it("chave vazia é válida e a lista vazia pode receber produtos novamente", async () => {
    await montarLista(criarProdutos(), "");
    carregarTresPaginas();
    await montarLista([], "");
    expect(produtosVisiveis()).toHaveLength(0);
    expect(IntersectionObserverStub.ativos.size).toBe(0);

    await montarLista(criarProdutos(), "");
    expect(produtosVisiveis()).toHaveLength(36);
    carregarMais();
    expect(produtosVisiveis()).toHaveLength(40);
  });
});

// @vitest-environment jsdom
// "Mais Vendidos" saiu da ordenação da cliente: a coluna `sold` nunca é
// atualizada por pedido nenhum (vale 0 em toda loja), então a opção ordenava
// tudo empatado e dizia à cliente que a lista era dos mais vendidos sem ser.
// HomeView real: a opção não aparece, as outras ordenam como antes, e um valor
// guardado do tempo da opção antiga cai em Relevância sem esvaziar a vitrine.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORDENACOES_DA_HOME, ordenacaoValida } from "@/lib/ordenacao-da-home";
import type { Product, SortOption } from "@/types";
import { HomeView } from "@/views/customer/HomeView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true }),
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
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { readonly product: Product }) => (
    <article data-produto={product.id}>{product.name}</article>
  ),
}));

const produto = (
  id: string,
  price: number,
  stock: number,
  sold: number,
): Product => ({
  id,
  name: `Produto ${id}`,
  description: "Produto de teste",
  price,
  images: [],
  category: "geral",
  stock,
  sold,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-08T00:00:00.000Z",
});

// A ordem da loja é p1, p2, p3, p4. p2 está sem estoque (vai para o fim em
// toda ordenação). O `sold` diferente de zero faz a ordenação antiga por
// "vendidos" dar p3, p4, p1 — diferente da padrão — para o teste enxergar.
const PRODUTOS = [
  produto("p1", 30, 5, 1),
  produto("p2", 10, 0, 50),
  produto("p3", 20, 5, 9),
  produto("p4", 40, 5, 5),
];

describe("ordenação da vitrine sem Mais Vendidos", () => {
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

  const montar = async (
    sortBy: SortOption | string,
    aoMudar: (ordem: SortOption) => void = () => {},
  ) => {
    await act(async () => {
      raiz.render(
        <HomeView
          products={PRODUTOS}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          selectedCategory="Todas"
          searchQuery=""
          sortBy={sortBy as SortOption}
          onCategoryChange={() => {}}
          onSortByChange={aoMudar}
        />,
      );
    });
  };

  const ordemNaTela = () =>
    Array.from(hospedeiro.querySelectorAll("[data-produto]")).map((card) =>
      card.getAttribute("data-produto"),
    );

  const abrirMenu = async () => {
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Filtrar e Ordenar"]',
    );
    expect(botao).not.toBeNull();
    await act(async () => {
      botao?.click();
    });
  };

  const opcoes = () =>
    Array.from(hospedeiro.querySelectorAll('[role="option"]'));

  it("o menu oferece só Relevância, Menor Preço e Maior Preço", async () => {
    await montar("default");
    await abrirMenu();

    expect(opcoes().map((opcao) => opcao.textContent?.trim())).toEqual([
      "Relevância",
      "Menor Preço",
      "Maior Preço",
    ]);
    expect(hospedeiro.textContent).not.toMatch(/mais vendidos?/i);
  });

  it("tocar numa opção devolve o valor dela, e nenhuma é 'sold'", async () => {
    const escolhas: SortOption[] = [];
    await montar("default", (ordem) => escolhas.push(ordem));

    for (const rotulo of ["Relevância", "Menor Preço", "Maior Preço"]) {
      await abrirMenu();
      const opcao = opcoes().find((o) => o.textContent?.trim() === rotulo);
      expect(opcao).toBeDefined();
      await act(async () => {
        (opcao as HTMLElement).click();
      });
    }

    expect(escolhas).toEqual(["default", "price-asc", "price-desc"]);
  });

  it.each<{ ordem: SortOption; esperado: string[] }>([
    // estoque primeiro (p2 no fim), depois a regra de cada ordenação
    { ordem: "default", esperado: ["p1", "p3", "p4", "p2"] },
    { ordem: "price-asc", esperado: ["p3", "p1", "p4", "p2"] },
    { ordem: "price-desc", esperado: ["p4", "p1", "p3", "p2"] },
  ])("$ordem ordena como antes", async ({ ordem, esperado }) => {
    await montar(ordem);
    expect(ordemNaTela()).toEqual(esperado);
  });

  it("valor antigo 'sold' cai em Relevância: mesma ordem, vitrine cheia", async () => {
    await montar("sold");

    expect(ordemNaTela()).toEqual(["p1", "p3", "p4", "p2"]);
    await abrirMenu();
    const marcadas = opcoes().filter(
      (opcao) => opcao.getAttribute("aria-selected") === "true",
    );
    expect(marcadas.map((opcao) => opcao.textContent?.trim())).toEqual([
      "Relevância",
    ]);
  });

  it("valor desconhecido também cai em Relevância", async () => {
    await montar("qualquer-coisa");
    expect(ordemNaTela()).toEqual(["p1", "p3", "p4", "p2"]);
  });
});

describe("ordenacaoValida", () => {
  it("mantém as ordenações de hoje", () => {
    for (const ordem of ORDENACOES_DA_HOME) {
      expect(ordenacaoValida(ordem)).toBe(ordem);
    }
    expect([...ORDENACOES_DA_HOME]).toEqual([
      "default",
      "price-asc",
      "price-desc",
    ]);
  });

  it.each(["sold", "", "PRICE-ASC", undefined, null, 3])(
    "manda %j para o padrão",
    (valor) => {
      expect(ordenacaoValida(valor)).toBe("default");
    },
  );
});

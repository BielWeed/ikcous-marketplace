// @vitest-environment jsdom
//
// As faixas "Ofertas Imperdíveis" e "Destaques em Alta" da vitrine escolhiam os
// produtos pela POSIÇÃO na lista, e a posição muda depois do cache e da
// sincronização (produto novo chega pelo Realtime no fim da lista). Resultado:
// a faixa ficava com os mesmos 6 de antes e o produto recém-cadastrado, que é o
// mais novo, podia nunca entrar. A escolha agora é pelo critério da casa
// (`ordenarParaVitrine`): com estoque primeiro, mais novo primeiro, e o id
// decide quando as datas empatam — a mesma lista dá a mesma faixa em qualquer
// ordem de chegada.
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
  images: [],
  category: "Roupas",
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-08T00:00:00.000Z",
  ...extras,
});

describe("HomeView — Ofertas e Destaques não dependem da posição na lista", () => {
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

  const render = async (produtos: Product[]) => {
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
  };

  const naFaixa = (titulo: string) =>
    Array.from(
      hospedeiro.querySelectorAll(`[data-faixa="${titulo}"] [data-na-faixa]`),
    ).map((el) => el.getAttribute("data-na-faixa"));

  // Oito produtos; a faixa mostra seis (maxItems padrão). O mais novo
  // ("h", createdTime 8000) chega POR ÚLTIMO, como num Realtime.
  const oito = (extras: Partial<Product>) =>
    ["a", "b", "c", "d", "e", "f", "g", "h"].map((id, i) =>
      produto(id, { createdTime: (i + 1) * 1000, ...extras }),
    );

  it("Destaques: o produto mais novo entra mesmo chegando no fim da lista", async () => {
    await render(oito({ isBestseller: true }));
    expect(naFaixa("Destaques em Alta")).toEqual([
      "h",
      "g",
      "f",
      "e",
      "d",
      "c",
    ]);
  });

  it("Ofertas: o produto mais novo entra mesmo chegando no fim da lista", async () => {
    await render(oito({ originalPrice: 150 }));
    expect(naFaixa("Ofertas Imperdíveis")).toEqual([
      "h",
      "g",
      "f",
      "e",
      "d",
      "c",
    ]);
  });

  it("a mesma lista, em ordem invertida, dá exatamente a mesma faixa", async () => {
    const lista = oito({ isBestseller: true, originalPrice: 150 });
    await render(lista);
    const destaques = naFaixa("Destaques em Alta");
    const ofertas = naFaixa("Ofertas Imperdíveis");
    await render([...lista].reverse());
    expect(naFaixa("Destaques em Alta")).toEqual(destaques);
    expect(naFaixa("Ofertas Imperdíveis")).toEqual(ofertas);
  });

  it("datas iguais: o id decide, não a ordem de chegada", async () => {
    const lista = ["c", "a", "b"].map((id) =>
      produto(id, { createdTime: 100, isBestseller: true, originalPrice: 150 }),
    );
    await render(lista);
    expect(naFaixa("Destaques em Alta")).toEqual(["a", "b", "c"]);
    expect(naFaixa("Ofertas Imperdíveis")).toEqual(["a", "b", "c"]);
  });

  it("esgotado continua indo para o fim da faixa, mesmo sendo o mais novo", async () => {
    await render([
      produto("velho", { createdTime: 1000, isBestseller: true }),
      produto("esgotado-novo", {
        createdTime: 9000,
        isBestseller: true,
        stock: 0,
      }),
      produto("novo", { createdTime: 5000, isBestseller: true }),
    ]);
    expect(naFaixa("Destaques em Alta")).toEqual([
      "novo",
      "velho",
      "esgotado-novo",
    ]);
  });
});

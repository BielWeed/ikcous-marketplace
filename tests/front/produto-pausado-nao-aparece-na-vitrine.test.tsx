// @vitest-environment jsdom
//
// A lojista pausa um produto no painel ("Pausar Produto", grava `ativo =
// false` no banco). O produto deveria sair da prateleira -- e continuava lá,
// com preço e estoque, dando para clicar e pôr no carrinho, porque nenhuma
// das listas montadas em `HomeView.tsx` filtrava por `isActive`.
//
// O precedente que decide o comportamento esperado está na MESMA tela:
// `SearchBar.tsx` (linhas 119 e 173) já filtra `p.isActive` -- ou seja, hoje
// procurar um produto pausado esconde, e rolar a prateleira mostra. Este
// teste prende a prateleira concordando com a busca.
//
// POR QUE MOCAR ProductList/ProductCarousel/CategoryFilter EM VEZ DE RENDER
// DE VERDADE: o que está em dúvida é QUAL LISTA de produtos o HomeView
// calcula e repassa para essas telas, não como cada uma delas desenha um
// card. Renderizar as de verdade puxaria embla-carousel, LazyImage e
// framer-motion (ver premium-offers-gate-avaliacoes.test.tsx) sem provar
// nada a mais sobre o defeito. Os dublês só expõem, por `data-testid`, os
// ids dos produtos que cada lista recebeu.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, View } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão de
// checkout-view-flag-off.test.tsx e premium-offers-gate-avaliacoes.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// A faixa de ofertas usa embla-carousel, que pede `ResizeObserver` e
// `matchMedia` -- nenhum dos dois existe no jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const matchMediaStub = (consulta: string) => ({
  matches: false,
  media: consulta,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

// `config` e reatribuivel para que UM caso possa montar as secoes que a
// lojista configura por id -- o unico ramo da vitrine que resolve produto
// por `productIds`, e que com `config` fixo em `{}` nunca chega a rodar.
let configDaLoja: Record<string, unknown> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja }),
}));

// `FreeShippingBlock` (importado no topo de HomeView.tsx, ainda que nunca
// renderizado neste teste, porque não há banner) puxa `useAuth`, que puxa o
// cliente real do Supabase -- e criar o cliente de verdade em jsdom quebra
// (`Web Worker is not supported`). Mesmo dublê de
// produto-a-produto-nao-carrega-lixo-do-anterior.test.tsx.
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
  useBanners: () => ({
    getBannersByPosition: () => [],
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));

vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));

// A prateleira principal ("Catálogo").
vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: ({
    products,
  }: {
    readonly products: ReadonlyArray<{ id: string }>;
  }) => (
    <div data-testid="vitrine-principal">
      {products.map((p) => (
        <span key={p.id} data-testid="produto-vitrine">
          {p.id}
        </span>
      ))}
    </div>
  ),
}));

// As faixas configuráveis ("Últimos Lançamentos", "Destaques em Alta"...).
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: ({
    title,
    products,
  }: {
    readonly title: string;
    readonly products: ReadonlyArray<{ id: string }>;
  }) => (
    <div data-testid={`carrossel-${title}`}>
      {products.map((p) => (
        <span key={p.id} data-testid="produto-carrossel">
          {p.id}
        </span>
      ))}
    </div>
  ),
}));

const criarProduto = (
  overrides: Partial<Product> & { id: string },
): Product => ({
  name: overrides.id,
  description: "produto de teste",
  price: 100,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("produto pausado não aparece na vitrine (HomeView)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // jsdom não implementa `CSS.escape` -- useDocumentMeta usa para montar o
    // seletor do <script> de JSON-LD (mesmo dublê de product-view-gate-avaliacoes
    // e identidade-da-loja-nas-telas).
    configDaLoja = {};
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    // O jsdom tambem nao tem `IntersectionObserver`, e a faixa de OFERTAS
    // (`PremiumOffers`) e desenhada por componente de verdade, nao dublado --
    // o `LazyImage` dentro dela quebra sem isto. Vai AQUI e nao no topo do
    // arquivo porque o `afterEach` chama `vi.unstubAllGlobals()`: stub posto
    // uma vez so morre depois do primeiro caso.
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", matchMediaStub);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const montar = async (products: Product[]) => {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={products}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={(_view: View) => {}}
          searchQuery=""
          selectedCategory="Todas"
          onCategoryChange={() => {}}
          sortBy="default"
          onSortByChange={() => {}}
        />,
      );
    });
  };

  it("a lojista pausa um produto e ele some da prateleira, o outro continua à venda", async () => {
    const ativo = criarProduto({ id: "produto-ativo-1", isActive: true });
    const pausado = criarProduto({ id: "produto-pausado-1", isActive: false });

    await montar([ativo, pausado]);

    const idsNaVitrine = Array.from(
      hospedeiro.querySelectorAll('[data-testid="produto-vitrine"]'),
    ).map((el) => el.textContent);

    expect(idsNaVitrine).toContain("produto-ativo-1");
    expect(idsNaVitrine).not.toContain("produto-pausado-1");
  });

  it("controle negativo: dois produtos ativos aparecem os dois na prateleira", async () => {
    const ativo1 = criarProduto({ id: "produto-ativo-a", isActive: true });
    const ativo2 = criarProduto({ id: "produto-ativo-b", isActive: true });

    await montar([ativo1, ativo2]);

    const idsNaVitrine = Array.from(
      hospedeiro.querySelectorAll('[data-testid="produto-vitrine"]'),
    ).map((el) => el.textContent);

    expect(idsNaVitrine).toContain("produto-ativo-a");
    expect(idsNaVitrine).toContain("produto-ativo-b");
    expect(idsNaVitrine).toHaveLength(2);
  });

  it("um produto pausado marcado como destaque não aparece na faixa de Destaques em Alta", async () => {
    const bestsellerAtivo = criarProduto({
      id: "bestseller-ativo",
      isActive: true,
      isBestseller: true,
    });
    const bestsellerPausado = criarProduto({
      id: "bestseller-pausado",
      isActive: false,
      isBestseller: true,
    });

    await montar([bestsellerAtivo, bestsellerPausado]);

    const carrossel = hospedeiro.querySelector(
      '[data-testid="carrossel-Destaques em Alta"]',
    );
    expect(carrossel).not.toBeNull();

    const idsNoCarrossel = Array.from(
      carrossel?.querySelectorAll('[data-testid="produto-carrossel"]') ?? [],
    ).map((el) => el.textContent);

    expect(idsNoCarrossel).toContain("bestseller-ativo");
    expect(idsNoCarrossel).not.toContain("bestseller-pausado");
  });

  // As tres asserções acima cobrem DUAS das cinco listas que a vitrine monta
  // (a prateleira principal e os destaques). As outras tres -- novidades,
  // ofertas e as secoes que a lojista configura por id -- ficariam sem
  // guarda, e o padrao deste defeito e justamente ESQUECER uma lista.
  //
  // Este caso fecha novidades e ofertas de uma vez, sem um teste por lista:
  // o produto
  // pausado se qualifica para todas elas (e destaque, esta em oferta e e o
  // mais recente), e a asserção e que o id dele nao aparece em lugar NENHUM
  // da tela -- inclusive nas faixas desenhadas por componentes que este
  // arquivo nao dubla, como o `PremiumOffers` das ofertas.
  //
  // O que ele NAO cobre, e por isso existe o caso seguinte: a secao que a
  // lojista monta escolhendo produtos por id. Com `config` vazio a vitrine
  // cai nas tres secoes padrao, e aquele ramo nunca roda.
  it("o produto pausado nao aparece em lugar nenhum da vitrine, em nenhuma das faixas", async () => {
    const aVenda = criarProduto({
      id: "produto-a-venda",
      isActive: true,
      isBestseller: true,
      originalPrice: 200,
      createdTime: 1,
    });
    const pausado = criarProduto({
      id: "produto-pausado-em-tudo",
      isActive: false,
      isBestseller: true,
      originalPrice: 200,
      createdTime: 2,
    });

    await montar([aVenda, pausado]);

    // O `criarProduto` usa o id como nome, entao procurar o id no texto da
    // tela pega tanto quem desenha o id quanto quem desenha o nome.
    const telaInteira = hospedeiro.textContent ?? "";
    expect(telaInteira).toContain("produto-a-venda");
    expect(telaInteira).not.toContain("produto-pausado-em-tudo");
  });

  // O ramo que o caso acima nao alcanca: a lojista monta uma vitrine escolhendo
  // produtos por id (AdminCarouselsView). Se ela escolher um produto e pausar
  // ele depois, ele nao pode voltar a aparecer -- e sem este caso, reverter
  // aquela unica linha para `products.map(...)` deixaria a suite inteira verde.
  it("produto pausado escolhido a mao para uma vitrine tambem nao aparece", async () => {
    configDaLoja = {
      homeSections: [
        {
          id: "curadoria",
          title: "Escolhidos pela Loja",
          active: true,
          productIds: ["escolhido-a-venda", "escolhido-pausado"],
        },
      ],
    };

    const aVenda = criarProduto({ id: "escolhido-a-venda", isActive: true });
    const pausado = criarProduto({ id: "escolhido-pausado", isActive: false });

    await montar([aVenda, pausado]);

    const carrossel = hospedeiro.querySelector(
      '[data-testid="carrossel-Escolhidos pela Loja"]',
    );
    expect(
      carrossel,
      "a vitrine configurada por id nem chegou a ser renderizada -- o caso nao montou",
    ).not.toBeNull();

    const ids = Array.from(
      carrossel?.querySelectorAll('[data-testid="produto-carrossel"]') ?? [],
    ).map((el) => el.textContent);

    expect(ids).toContain("escolhido-a-venda");
    expect(ids).not.toContain("escolhido-pausado");
  });
});

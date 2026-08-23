// @vitest-environment jsdom
//
// O selo "Frete Grátis" do ProductCard aparecia em TODO produto da loja
// (inclusive um de R$ 29) porque a condição olhava
// `isEligibleForFreeShipping` -- que os chamadores calculavam como
// `config.freeShippingMin > 0`, ou seja, "a loja TEM alguma regra de frete
// grátis", nunca "este produto específico se qualifica". Como o padrão da
// loja já é `freeShippingMin: 350` (StoreContext.tsx), o selo acendia em
// tudo desde a primeira visita, sem ninguém configurar nada -- e a cliente
// só descobria que ia pagar frete no cálculo de entrega.
//
// O conserto: o selo passa a refletir só `product.freeShipping`, o campo do
// próprio produto -- verdade independente de carrinho, login ou subtotal. A
// promessa POR VALOR de compra não sumiu da loja: ela mora no
// `FreeShippingBlock` da Home, que compara contra o carrinho de verdade.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de product-card-gate-avaliacoes.test.tsx -- o que este
// teste prova é a ÁRVORE renderizada (o selo aparece ou não), não uma
// asserção sobre props internas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, StoreConfig } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock mutável: cada teste ajusta `mockConfig` antes de renderizar. O
// componente lê `config` em tempo de render (não no import), então mudar a
// variável entre testes funciona mesmo com o módulo já carregado. Mesmo
// padrão de identidade-da-loja-nas-telas.test.tsx. `vi.mock` é hoisted pelo
// Vitest para o topo do arquivo.
let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-teste" } }),
}));

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-frete",
    name: "Produto de teste",
    description: "Descrição de teste",
    price: 29,
    images: ["https://example.com/img.png"],
    category: "geral",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 12,
    ...overrides,
  };
}

describe("ProductList — via a config real da loja, o selo do card afirma só o que o produto garante", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // freeShippingMin: 350 é o padrão de StoreContext.tsx. `enableReviews:
    // false` evita montar o StarRating, irrelevante para este teste.
    mockConfig = { freeShippingMin: 350, enableReviews: false };
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

  async function renderizarLista(produto: Product) {
    const { ProductList } = await import("@/components/ui/custom/ProductList");
    await act(async () => {
      raiz.render(
        <ProductList
          products={[produto]}
          isLoading={false}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      );
    });
  }

  it("produto de R$ 29 sem frete grátis não mostra o selo, mesmo com a loja tendo mínimo configurado", async () => {
    // A loja tem `freeShippingMin: 350`, mas este produto de R$ 29 não tem
    // `freeShipping`. Antes do conserto, o `ProductList` passava
    // `isEligibleForFreeShipping={config.freeShippingMin > 0}` -- `true`
    // independente do produto -- e o card não tinha como saber que aquele
    // produto específico não se qualificava.
    const produto = criarProduto({ price: 29, freeShipping: false });

    await renderizarLista(produto);

    expect(hospedeiro.textContent).not.toContain("Frete Grátis");
  });

  it("controle negativo: produto com freeShipping=true mostra o selo", async () => {
    // Sem este caso, um conserto que simplesmente apagasse o selo inteiro
    // (em vez de corrigir a condição) passaria no caso acima sem provar
    // nada -- é o controle negativo da mesma rodada.
    const produto = criarProduto({ price: 29, freeShipping: true });

    await renderizarLista(produto);

    expect(hospedeiro.textContent).toContain("Frete Grátis");
  });
});

// `HeroOfferCard`, dentro do `PremiumOffers`, tem a PROPRIA copia da condicao
// do selo -- ele nao passa pelo `ProductCard`. A revisao mediu que nenhum teste
// do repositorio olhava o selo dele: reintroduzir ali `config.freeShippingMin > 0`
// (o `PremiumOffers` ja le `config` por outro motivo) traria o defeito de volta
// nesta faixa da Home sem nenhum vermelho aparecer.
//
// Os tres stubs sao os que o embla-carousel e o LazyImage pedem e o jsdom nao
// tem -- mesmo conjunto de premium-offers-gate-avaliacoes.test.tsx, e vao no
// `beforeEach` porque este arquivo desfaz stubs entre os casos.
class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("HeroOfferCard — a faixa de ofertas tem a propria copia da condicao", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = { freeShippingMin: 350, enableReviews: false };
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
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

  async function renderizarOfertas(produto: Product) {
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produto]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      );
    });
  }

  it("produto em oferta sem frete gratis nao mostra o selo na faixa de ofertas", async () => {
    const produto = criarProduto({
      price: 29,
      originalPrice: 59,
      freeShipping: false,
    });

    await renderizarOfertas(produto);

    expect(hospedeiro.textContent).not.toContain("Frete Grátis");
  });

  it("controle negativo: na mesma faixa, produto com frete gratis mostra o selo", async () => {
    const produto = criarProduto({
      price: 29,
      originalPrice: 59,
      freeShipping: true,
    });

    await renderizarOfertas(produto);

    expect(hospedeiro.textContent).toContain("Frete Grátis");
  });
});

describe("FreeShippingBlock — a promessa por valor de compra continua na loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = { freeShippingMin: 350 };
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

  it("com freeShippingMin configurado, o bloco continua anunciando a regra por valor", async () => {
    const { FreeShippingBlock } = await import(
      "@/components/ui/custom/FreeShippingBlock"
    );
    await act(async () => {
      raiz.render(<FreeShippingBlock onNavigate={() => {}} />);
    });

    expect(hospedeiro.textContent).toContain("Frete");
    expect(hospedeiro.textContent).toContain("Grátis");
  });
});

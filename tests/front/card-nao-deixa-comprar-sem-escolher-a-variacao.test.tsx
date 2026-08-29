// @vitest-environment jsdom
//
// A tela do produto (ProductView.tsx) já recusa "adicionar ao carrinho" sem
// escolher a variação obrigatória (Tamanho, Cor...). O card da vitrine
// (home, listagem, carrossel, busca, favoritos) não tinha essa checagem: o
// botão de ação chamava `onAddToCart(product, e)` direto, sem `variantId` --
// e o pedido nascia no banco com `variant_id = NULL`, cobrando o preço do
// produto (ignorando qualquer `price_override` de variação) e decrementando
// só `produtos.estoque`, nunca `product_variants.stock_increment`. A
// lojista recebia pedido de camiseta sem tamanho nenhum, e o estoque dela
// voltava a mentir na primeira edição do produto.
//
// O conserto: com variação ATIVA, o botão do card não adiciona -- ele leva
// para a tela do produto, que é onde a escolha é obrigatória. `HeroOfferCard`
// (dentro de `PremiumOffers`, faixa de ofertas da Home) tem a PRÓPRIA cópia
// da lógica de adicionar/comprar -- não passa pelo `ProductCard` -- e tinha o
// mesmo defeito nos dois botões dela ("Adicionar" e "Comprar").
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de selo-de-frete-gratis-nao-mente.test.tsx -- o que este
// arquivo prova é a árvore reagindo ao CLIQUE real do botão, não uma chamada
// direta de função interna.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant, StoreConfig } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock mutável: cada teste ajusta `mockConfig` antes de renderizar. Mesmo
// padrão de selo-de-frete-gratis-nao-mente.test.tsx.
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

function criarVariantes(ativas: boolean): ProductVariant[] {
  return [
    {
      id: "var-p",
      productId: "prod-camiseta",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: ativas,
    },
    {
      id: "var-m",
      productId: "prod-camiseta",
      name: "Tamanho",
      value: "M",
      stockIncrement: 5,
      active: ativas,
    },
  ];
}

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-camiseta",
    name: "Camiseta",
    description: "Descrição de teste",
    price: 50,
    images: ["https://example.com/img.png"],
    category: "roupas",
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

/**
 * O botão de favoritar (coração) vem ANTES do botão de ação na árvore, tanto
 * em ProductCard.tsx quanto em HeroOfferCard -- pegar pelo índice em vez de
 * localizar por texto, porque o TEXTO do botão de ação é justamente o que
 * este arquivo está testando.
 */
function botaoDeAcao(hospedeiro: HTMLElement): HTMLButtonElement {
  const botoes = hospedeiro.querySelectorAll("button");
  return botoes[1] as HTMLButtonElement;
}

describe("ProductCard (via ProductList) -- não deixa comprar sem escolher a variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  async function renderizarLista(
    produto: Product,
    onAddToCart: (product: Product) => void,
    onProductClick: (productId: string) => void,
  ) {
    const { ProductList } = await import("@/components/ui/custom/ProductList");
    await act(async () => {
      raiz.render(
        <ProductList
          products={[produto]}
          isLoading={false}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={onProductClick}
          onAddToCart={onAddToCart}
        />,
      );
    });
  }

  it("produto com variação ativa: tocar no botão abre a tela do produto, não adiciona ao carrinho", async () => {
    const onAddToCart = vi.fn();
    const onProductClick = vi.fn();
    const produto = criarProduto({ variants: criarVariantes(true) });

    await renderizarLista(produto, onAddToCart, onProductClick);

    await act(async () => {
      botaoDeAcao(hospedeiro).click();
    });

    expect(onAddToCart).not.toHaveBeenCalled();
    expect(onProductClick).toHaveBeenCalledWith(produto.id);
  });

  it("controle negativo: produto sem variação, tocar no botão adiciona ao carrinho normalmente", async () => {
    const onAddToCart = vi.fn();
    const onProductClick = vi.fn();
    const produto = criarProduto();

    await renderizarLista(produto, onAddToCart, onProductClick);

    await act(async () => {
      botaoDeAcao(hospedeiro).click();
    });

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart.mock.calls[0][0]).toEqual(produto);
    expect(onProductClick).not.toHaveBeenCalled();
  });

  it("o rótulo diz o que o toque faz: com variação ativa, o botão convida a escolher", async () => {
    const produto = criarProduto({ variants: criarVariantes(true) });

    await renderizarLista(produto, vi.fn(), vi.fn());

    expect(botaoDeAcao(hospedeiro).textContent).toContain("Escolher opções");
  });

  it("o rótulo diz o que o toque faz: sem variação, o botão continua dizendo Carrinho", async () => {
    const produto = criarProduto();

    await renderizarLista(produto, vi.fn(), vi.fn());

    expect(botaoDeAcao(hospedeiro).textContent).toContain("Carrinho");
    expect(botaoDeAcao(hospedeiro).textContent).not.toContain(
      "Escolher opções",
    );
  });

  it("variação inativa não conta: produto com todas as variações desativadas se comporta como sem variação", async () => {
    const onAddToCart = vi.fn();
    const onProductClick = vi.fn();
    const produto = criarProduto({ variants: criarVariantes(false) });

    await renderizarLista(produto, onAddToCart, onProductClick);

    await act(async () => {
      botaoDeAcao(hospedeiro).click();
    });

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onProductClick).not.toHaveBeenCalled();
  });
});

// `HeroOfferCard`, dentro do `PremiumOffers` (faixa "Super Descontos" da
// Home), tem a PRÓPRIA cópia da lógica de adicionar/comprar -- não passa
// pelo `ProductCard`. Ela tem DOIS botões que pulavam a escolha de
// variação: "Adicionar" (chama `onAddToCart`) e "Comprar" (chama
// `onQuickBuy`, que no App.tsx real vai direto para o checkout).
//
// Os três stubs são os que o embla-carousel e o LazyImage pedem e o jsdom
// não tem -- mesmo conjunto de selo-de-frete-gratis-nao-mente.test.tsx.
class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("HeroOfferCard (via PremiumOffers) -- os dois botões respeitam a variação", () => {
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

  async function renderizarOfertas(
    produto: Product,
    onAddToCart: (product: Product) => void,
    onQuickBuy: (product: Product) => void,
    onProductClick: (productId: string) => void,
  ) {
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produto]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={onProductClick}
          onAddToCart={onAddToCart}
          onQuickBuy={onQuickBuy}
        />,
      );
    });
  }

  function botoes(hospedeiroEl: HTMLElement) {
    const todos = hospedeiroEl.querySelectorAll("button");
    // [0] favoritar, [1] "Adicionar", [2] "Comprar" -- mesma ordem do JSX.
    return {
      adicionar: todos[1] as HTMLButtonElement,
      comprar: todos[2] as HTMLButtonElement,
    };
  }

  it("produto com variação ativa: 'Adicionar' abre a tela do produto, não adiciona ao carrinho", async () => {
    const onAddToCart = vi.fn();
    const onQuickBuy = vi.fn();
    const onProductClick = vi.fn();
    const produto = criarProduto({ variants: criarVariantes(true) });

    await renderizarOfertas(produto, onAddToCart, onQuickBuy, onProductClick);

    await act(async () => {
      botoes(hospedeiro).adicionar.click();
    });

    expect(onAddToCart).not.toHaveBeenCalled();
    expect(onProductClick).toHaveBeenCalledWith(produto.id);
  });

  it("produto com variação ativa: 'Comprar' abre a tela do produto, não vai direto para o checkout", async () => {
    const onAddToCart = vi.fn();
    const onQuickBuy = vi.fn();
    const onProductClick = vi.fn();
    const produto = criarProduto({ variants: criarVariantes(true) });

    await renderizarOfertas(produto, onAddToCart, onQuickBuy, onProductClick);

    await act(async () => {
      botoes(hospedeiro).comprar.click();
    });

    expect(onQuickBuy).not.toHaveBeenCalled();
    expect(onProductClick).toHaveBeenCalledWith(produto.id);
  });

  it("controle negativo: sem variação, 'Adicionar' e 'Comprar' continuam funcionando direto", async () => {
    const onAddToCart = vi.fn();
    const onQuickBuy = vi.fn();
    const onProductClick = vi.fn();
    const produto = criarProduto();

    await renderizarOfertas(produto, onAddToCart, onQuickBuy, onProductClick);

    await act(async () => {
      botoes(hospedeiro).adicionar.click();
    });
    expect(onAddToCart).toHaveBeenCalledTimes(1);

    await act(async () => {
      botoes(hospedeiro).comprar.click();
    });
    expect(onQuickBuy).toHaveBeenCalledTimes(1);

    expect(onProductClick).not.toHaveBeenCalled();
  });
  // Achado da revisao: sem este caso, trocar a guarda por
  // `variants?.length > 0` (que IGNORA o `active`) sobrevive aos 8 casos.
  // O gemeo dele existe para o `ProductCard` desde o comeco; a faixa de
  // ofertas tem copia PROPRIA da condicao e estava sem essa cobertura.
  it("variacao inativa nao conta: os dois botoes voltam a funcionar direto", async () => {
    const onAddToCart = vi.fn();
    const onQuickBuy = vi.fn();
    const onProductClick = vi.fn();
    const produto = criarProduto({ variants: criarVariantes(false) });

    await renderizarOfertas(produto, onAddToCart, onQuickBuy, onProductClick);

    await act(async () => {
      botoes(hospedeiro).adicionar.click();
    });
    expect(onAddToCart).toHaveBeenCalledTimes(1);

    await act(async () => {
      botoes(hospedeiro).comprar.click();
    });
    expect(onQuickBuy).toHaveBeenCalledTimes(1);

    expect(onProductClick).not.toHaveBeenCalled();
  });
});

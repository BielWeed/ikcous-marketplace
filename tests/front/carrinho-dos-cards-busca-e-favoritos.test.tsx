// @vitest-environment jsdom
//
// DEFEITO (caçada de 14/10/2026, venda perdida): na Busca e nos Favoritos o
// botão "Carrinho" de um produto SEM tamanho/cor mostrava "Salvando…" e depois
// "Salvo!" verde, com a bolinha voando até o carrinho — e NADA entrava no
// carrinho. Causa: SearchView e FavoritesView não passavam `onAddToCart` (nem
// `onAddToCartWithVariants`) ao ProductCard, e o card confirmava "Salvo!" mesmo
// sem ninguém para chamar (a chamada ficava atrás de `if (onAddToCart)`).
//
// Aqui o ProductCard é o REAL; as duas telas são as REAIS, com os ganchos de
// dados simulados. O que a prova exige:
//   1. Busca e Favoritos entregam o produto ao carrinho (grade, "Trending" do
//      estado vazio, e "Mais Amados" dos favoritos vazios);
//   2. produto com variação abre a folha de opções (IGUAL à Home) e a
//      quantidade escolhida chega junto;
//   3. defesa no card: sem ninguém para adicionar, o botão NÃO confirma em
//      falso — vira "Ver produto" e abre a página do produto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

const estado = vi.hoisted(() => ({
  produtos: [] as unknown[],
  filtrados: [] as unknown[],
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false },
    products: estado.produtos,
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    toggleFavorite: vi.fn(),
    isFavorite: () => false,
    loading: false,
    erro: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.produtos }),
}));

vi.mock("@/hooks/useSearch", () => ({
  useSearch: () => ({
    query: "",
    setQuery: vi.fn(),
    category: "Todas",
    setCategory: vi.fn(),
    minPrice: "",
    setMinPrice: vi.fn(),
    maxPrice: "",
    setMaxPrice: vi.fn(),
    sort: "newest",
    setSort: vi.fn(),
    filteredProducts: estado.filtrados,
    totalResults: estado.filtrados.length,
  }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: vi.fn(),
    prefetchImage: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function criarProduto(extra: Partial<Product> = {}): Product {
  return {
    id: "p-camiseta",
    name: "Camiseta Lisa",
    description: "x",
    price: 50,
    images: ["https://example.com/a.png"],
    category: "roupas",
    stock: 20,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 5,
    reviewCount: 0,
    variants: [],
    ...extra,
  };
}

function variantes(): ProductVariant[] {
  return [
    {
      id: "v-m",
      productId: "p-vestido",
      name: "Tamanho",
      value: "M",
      stockIncrement: 10,
      active: true,
    },
    {
      id: "v-g",
      productId: "p-vestido",
      name: "Tamanho",
      value: "G",
      stockIncrement: 10,
      active: true,
    },
  ];
}

const simples = criarProduto();
const comVariacao = criarProduto({
  id: "p-vestido",
  name: "Vestido Midi",
  variants: variantes(),
});

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
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
  estado.produtos = [];
  estado.filtrados = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => {
    raiz.unmount();
  });
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const botaoDoCard = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    '[data-testid="product-card-action"]',
  )!;

async function tocar(el: Element | null | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/** Folha de opções do card: escolhe "M", sobe a quantidade para 3 e adiciona. */
async function escolherMQuantidade3EAdicionar() {
  await tocar(botaoDoCard());
  const chipM = Array.from(document.body.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === "M" && b.getAttribute("aria-pressed") !== null,
  );
  await tocar(chipM);
  const mais = document.body.querySelector(
    '[data-testid="product-card-options-sheet"] button[aria-label="Aumentar quantidade"]',
  );
  await tocar(mais);
  await tocar(mais);
  await tocar(
    document.body.querySelector('[data-testid="product-card-options-add"]'),
  );
}

/** A função de carrinho do App, como as telas a recebem. */
type Carrinho = (
  product: Product,
  quantity?: number,
  variantId?: string,
  variantNames?: string,
) => void;

describe("SearchView — o botão Carrinho do card realmente adiciona", () => {
  async function montar(
    props: { onAddToCart?: ReturnType<typeof vi.fn<Carrinho>> } = {},
  ) {
    const { SearchView } = await import("@/views/customer/SearchView");
    const onNavigate = vi.fn();
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={onNavigate}
          onBack={vi.fn()}
          onAddToCart={props.onAddToCart}
        />,
      );
    });
    return { onNavigate };
  }

  it("resultado da busca: produto sem variação entra no carrinho (só o produto, sem o clique no lugar da quantidade)", async () => {
    estado.produtos = [simples];
    estado.filtrados = [simples];
    const onAddToCart = vi.fn<Carrinho>();
    await montar({ onAddToCart });

    await tocar(botaoDoCard());

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    // Só o produto: o `quantity` do carrinho é opcional (padrão 1). Se o
    // clique do mouse vazasse para cá, viraria "quantidade" = objeto.
    expect(onAddToCart.mock.calls[0]).toEqual([simples]);
  });

  it("'Trending' do estado vazio: produto sem variação também entra no carrinho", async () => {
    estado.produtos = [simples];
    estado.filtrados = [];
    const onAddToCart = vi.fn<Carrinho>();
    await montar({ onAddToCart });

    expect(hospedeiro.textContent).toContain("Ué, nenhum resultado?");
    await tocar(botaoDoCard());

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart.mock.calls[0]).toEqual([simples]);
  });

  it("produto com variação: o botão abre a folha de opções (igual à Home) e a quantidade escolhida chega ao carrinho", async () => {
    estado.produtos = [comVariacao];
    estado.filtrados = [comVariacao];
    const onAddToCart = vi.fn<Carrinho>();
    const { onNavigate } = await montar({ onAddToCart });

    expect(botaoDoCard().textContent).toContain("Escolher opções");
    await escolherMQuantidade3EAdicionar();

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart).toHaveBeenCalledWith(
      comVariacao,
      3,
      "v-m",
      "Tamanho: M",
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("sem ninguém para adicionar, o card NÃO confirma em falso: vira 'Ver produto' e abre a página", async () => {
    vi.useFakeTimers();
    estado.produtos = [simples];
    estado.filtrados = [simples];
    const { onNavigate } = await montar();

    expect(botaoDoCard().textContent).toContain("Ver produto");
    await tocar(botaoDoCard());
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(hospedeiro.textContent).not.toContain("Salvo!");
    expect(hospedeiro.textContent).not.toContain("Salvando");
    expect(onNavigate).toHaveBeenCalledWith("product-detail", "p-camiseta");
  });
});

describe("FavoritesView — o botão Carrinho do card realmente adiciona", () => {
  async function montar(
    favoritos: Product[],
    props: { onAddToCart?: ReturnType<typeof vi.fn<Carrinho>> } = {},
  ) {
    const { FavoritesView } = await import("@/views/customer/FavoritesView");
    const onProductClick = vi.fn();
    await act(async () => {
      raiz.render(
        <FavoritesView
          favorites={favoritos}
          onToggleFavorite={vi.fn()}
          onProductClick={onProductClick}
          onNavigate={vi.fn()}
          onAddToCart={props.onAddToCart}
        />,
      );
    });
    return { onProductClick };
  }

  it("lista de favoritos: produto sem variação entra no carrinho (só o produto)", async () => {
    estado.produtos = [simples];
    const onAddToCart = vi.fn<Carrinho>();
    await montar([simples], { onAddToCart });

    await tocar(botaoDoCard());

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart.mock.calls[0]).toEqual([simples]);
  });

  it("'Mais Amados da Loja' (favoritos vazios): produto sem variação entra no carrinho", async () => {
    estado.produtos = [simples];
    const onAddToCart = vi.fn<Carrinho>();
    await montar([], { onAddToCart });

    expect(hospedeiro.textContent).toContain("Mais Amados da Loja");
    await tocar(botaoDoCard());

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart.mock.calls[0]).toEqual([simples]);
  });

  it("produto com variação: abre a folha de opções (igual à Home) e a quantidade escolhida chega ao carrinho", async () => {
    estado.produtos = [comVariacao];
    const onAddToCart = vi.fn<Carrinho>();
    const { onProductClick } = await montar([comVariacao], { onAddToCart });

    expect(botaoDoCard().textContent).toContain("Escolher opções");
    await escolherMQuantidade3EAdicionar();

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart).toHaveBeenCalledWith(
      comVariacao,
      3,
      "v-m",
      "Tamanho: M",
    );
    expect(onProductClick).not.toHaveBeenCalled();
  });

  it("sem ninguém para adicionar, o card NÃO confirma em falso: vira 'Ver produto' e abre a página", async () => {
    vi.useFakeTimers();
    estado.produtos = [simples];
    const { onProductClick } = await montar([simples]);

    expect(botaoDoCard().textContent).toContain("Ver produto");
    await tocar(botaoDoCard());
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(hospedeiro.textContent).not.toContain("Salvo!");
    expect(onProductClick).toHaveBeenCalledWith("p-camiseta");
  });
});

describe("ProductCard — defesa: sem como adicionar, não confirma em falso", () => {
  it("sem onAddToCart: o botão diz 'Ver produto', abre a página e nunca mostra 'Salvo!'", async () => {
    vi.useFakeTimers();
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    const onClick = vi.fn();
    await act(async () => {
      raiz.render(
        <ProductCard
          product={simples}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={onClick}
          showRating={false}
        />,
      );
    });

    expect(botaoDoCard().textContent).toContain("Ver produto");
    expect(botaoDoCard().getAttribute("aria-label")).toBe(
      "Ver produto Camiseta Lisa",
    );
    await tocar(botaoDoCard());
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(botaoDoCard().textContent).not.toContain("Salvo!");
    expect(onClick).toHaveBeenCalledWith("p-camiseta");
  });

  it("com onAddToCart (caminho de sempre): continua 'Carrinho' e chama quem adiciona", async () => {
    vi.useFakeTimers();
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    const onAddToCart = vi.fn();
    const onClick = vi.fn();
    await act(async () => {
      raiz.render(
        <ProductCard
          product={simples}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={onClick}
          onAddToCart={onAddToCart}
          showRating={false}
        />,
      );
    });

    expect(botaoDoCard().textContent).toContain("Carrinho");
    await tocar(botaoDoCard());
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(botaoDoCard().textContent).toContain("Salvo!");
    expect(onClick).not.toHaveBeenCalled();
  });
});

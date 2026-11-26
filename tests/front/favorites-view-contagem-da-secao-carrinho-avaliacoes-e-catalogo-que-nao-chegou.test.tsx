// @vitest-environment jsdom
//
// Caça por mutação nos Favoritos da cliente: quatro pontos que os testes
// vizinhos deixavam passar.
//   - o número ao lado do título de cada categoria é o TOTAL dela, mesmo quando
//     só os 3 primeiros cartões aparecem ("5 produtos" com 3 à vista);
//   - o botão de adicionar ao carrinho só existe nos cartões quando a tela
//     recebe a função do carrinho (sem ela o cartão vira "Ver produto"), e a
//     estrela de avaliação segue a configuração da loja -- na lista e nas
//     sugestões de "nenhum favorito";
//   - "catálogo que não chegou" só vale quando não há favorito E não há produto:
//     lista vazia com o catálogo da loja em mãos continua dizendo "você ainda não
//     tem favoritos" (e mostra sugestões), mesmo que a releitura do catálogo
//     tenha falhado ou esteja rodando; favoritos na mão nunca viram esqueleto;
//   - contador de "ainda sendo salvos" ausente é zero, não um.
import type { Product } from "@/types";
import { FavoritesView } from "@/views/customer/FavoritesView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loja = vi.hoisted(() => ({
  config: { enableReviews: false } as Record<string, unknown>,
  products: [] as unknown[],
  loadingProducts: false,
  catalogoErro: false,
  favoritos: {} as Record<string, unknown>,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: loja.config,
    products: loja.products,
    loadingProducts: loja.loadingProducts,
    catalogoErro: loja.catalogoErro,
    fetchProducts: vi.fn(async () => {}),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    erro: null,
    refresh: vi.fn(),
    retentarPendentes: vi.fn(async () => {}),
    limparIndisponiveis: vi.fn(async () => {}),
    ...loja.favoritos,
  }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn(), prefetchImage: vi.fn() }),
}));
// O cartão vira uma marca que expõe só o que esta prova lê.
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({
    product,
    onAddToCart,
    onAddToCartWithVariants,
    showRating,
  }: {
    product: { id: string };
    onAddToCart?: unknown;
    onAddToCartWithVariants?: unknown;
    showRating?: boolean;
  }) => (
    <div
      data-testid="cartao"
      data-id={product.id}
      data-carrinho={String(typeof onAddToCart === "function")}
      data-carrinho-com-opcoes={String(
        typeof onAddToCartWithVariants === "function",
      )}
      data-avaliacao={String(showRating)}
    />
  ),
}));

function produto(
  id: string,
  category: string,
  extra: Record<string, unknown> = {},
): Product {
  return {
    id,
    name: `Produto ${id}`,
    price: 10,
    category,
    description: "",
    images: [],
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-10-20T12:00:00Z",
    variants: [],
    ...extra,
  } as unknown as Product;
}

let raiz: Root;
let container: HTMLDivElement;

// @ts-expect-error flag interna do React usada pela suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  loja.config = { enableReviews: false };
  loja.products = [];
  loja.loadingProducts = false;
  loja.catalogoErro = false;
  loja.favoritos = {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});
afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function montar(favoritos: Product[], comCarrinho = true) {
  act(() =>
    raiz.render(
      <FavoritesView
        favorites={favoritos}
        onToggleFavorite={vi.fn()}
        onProductClick={vi.fn()}
        onNavigate={vi.fn()}
        isActive
        onAddToCart={comCarrinho ? vi.fn() : undefined}
      />,
    ),
  );
}
const texto = () => container.textContent?.replace(/\s+/g, " ");
const cartoes = () =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-testid="cartao"]'));

describe("Favoritos — o número da categoria é o total dela", () => {
  const cinco = ["a", "b", "c", "d", "e"].map((id) => produto(id, "Casa"));

  it("com 5 favoritos na categoria só 3 cartões aparecem, mas o título diz '5 produtos'", () => {
    montar(cinco);
    expect(cartoes()).toHaveLength(3);
    const secao = container.querySelector("section");
    expect(secao?.querySelector("h2")?.nextElementSibling?.textContent).toBe(
      "5 produtos",
    );
    expect(texto()).toContain("Ver todos (5)");
  });

  it("depois de 'Ver todos' os 5 aparecem e o número continua 5", () => {
    montar(cinco);
    const ver = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Ver todos"),
    );
    act(() => {
      ver?.click();
    });
    expect(cartoes()).toHaveLength(5);
    expect(
      container.querySelector("section h2")?.nextElementSibling?.textContent,
    ).toBe("5 produtos");
    expect(texto()).toContain("Mostrar menos");
  });
});

describe("Favoritos — carrinho e avaliações dos cartões", () => {
  it("lista: com a função do carrinho os cartões recebem os dois caminhos de adicionar", () => {
    montar([produto("a", "Casa")], true);
    expect(cartoes().map((c) => c.dataset.carrinho)).toEqual(["true"]);
    expect(cartoes().map((c) => c.dataset.carrinhoComOpcoes)).toEqual(["true"]);
  });

  it("lista: sem a função do carrinho os cartões ficam sem como adicionar", () => {
    montar([produto("a", "Casa")], false);
    expect(cartoes().map((c) => c.dataset.carrinho)).toEqual(["false"]);
    expect(cartoes().map((c) => c.dataset.carrinhoComOpcoes)).toEqual([
      "false",
    ]);
  });

  it("sugestões de 'nenhum favorito': mesma regra do carrinho", () => {
    loja.products = [produto("s1", "Casa")];
    montar([], false);
    expect(cartoes().map((c) => c.dataset.id)).toEqual(["s1"]);
    expect(cartoes().map((c) => c.dataset.carrinho)).toEqual(["false"]);
    expect(cartoes().map((c) => c.dataset.carrinhoComOpcoes)).toEqual([
      "false",
    ]);

    montar([], true);
    expect(cartoes().map((c) => c.dataset.carrinho)).toEqual(["true"]);
    expect(cartoes().map((c) => c.dataset.carrinhoComOpcoes)).toEqual(["true"]);
  });

  it.each([true, false])(
    "estrela de avaliação segue enableReviews=%s, na lista e nas sugestões",
    (ligada) => {
      loja.config = { enableReviews: ligada };
      montar([produto("a", "Casa")]);
      expect(cartoes().map((c) => c.dataset.avaliacao)).toEqual([
        String(ligada),
      ]);

      loja.products = [produto("s1", "Casa")];
      montar([]);
      expect(cartoes().map((c) => c.dataset.avaliacao)).toEqual([
        String(ligada),
      ]);
    },
  );
});

describe("Favoritos — catálogo que não chegou só vale sem favorito e sem produto", () => {
  it("lista vazia com produtos da loja e a releitura falhou: continua 'ainda não tem favoritos'", () => {
    loja.products = [produto("s1", "Casa")];
    loja.catalogoErro = true;
    montar([]);
    expect(texto()).toContain("Você ainda não tem favoritos");
    expect(texto()).not.toContain("Não conseguimos carregar");
    expect(cartoes().map((c) => c.dataset.id)).toEqual(["s1"]);
  });

  it("lista vazia com produtos da loja e a releitura rodando: sem esqueleto", () => {
    loja.products = [produto("s1", "Casa")];
    loja.loadingProducts = true;
    montar([]);
    expect(
      container.querySelector('[aria-label="Carregando favoritos"]'),
    ).toBeNull();
    expect(texto()).toContain("Você ainda não tem favoritos");
  });

  it("controle: sem favorito e sem nenhum produto, a releitura rodando mostra o esqueleto", () => {
    loja.loadingProducts = true;
    montar([]);
    expect(
      container.querySelector('[aria-label="Carregando favoritos"]'),
    ).not.toBeNull();
  });

  it("controle: sem favorito e sem nenhum produto, a falha mostra a tela de erro", () => {
    loja.catalogoErro = true;
    montar([]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Não conseguimos carregar",
    );
  });

  it("favoritos na mão com o catálogo vazio: a lista aparece, sem esqueleto nem erro", () => {
    loja.products = [];
    loja.loadingProducts = true;
    montar([produto("a", "Casa")]);
    expect(
      container.querySelector('[aria-label="Carregando favoritos"]'),
    ).toBeNull();
    expect(cartoes().map((c) => c.dataset.id)).toEqual(["a"]);

    loja.loadingProducts = false;
    loja.catalogoErro = true;
    montar([produto("a", "Casa")]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(cartoes().map((c) => c.dataset.id)).toEqual(["a"]);
  });
});

describe("Favoritos — contador de 'ainda sendo salvos' ausente é zero", () => {
  it("sem nenhum favorito e sem o contador: nenhum aviso", () => {
    loja.favoritos = { pendingCount: undefined };
    montar([]);
    expect(texto()).not.toContain("ainda está sendo salvo");
    expect(texto()).not.toContain("ainda estão sendo salvos");
  });

  it("com favoritos e sem o contador: nenhum aviso", () => {
    loja.favoritos = { pendingCount: undefined };
    montar([produto("a", "Casa")]);
    expect(texto()).not.toContain("ainda está sendo salvo");
    expect(texto()).not.toContain("ainda estão sendo salvos");
  });

  it("controle: com 1 pendente o aviso aparece no singular", () => {
    loja.favoritos = { pendingCount: 1 };
    montar([]);
    expect(texto()).toContain("1 favorito ainda está sendo salvo");
  });
});

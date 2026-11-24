// @vitest-environment jsdom
//
// Três bordas da tela de Favoritos que os testes de agrupamento e filtro não
// alcançam (todos os produtos deles têm `variants: []`, e o filtro só confere
// os NOMES dos cartões, nunca as seções que sobram):
//
// 1. "Menor preço" / "Maior preço" ordenam pelo preço de VITRINE (o menor entre
//    as opções à venda, o mesmo que o card anuncia), não pelo `price` cru do
//    produto. Produto cadastrado a R$ 50 cuja única opção à venda custa R$ 20
//    aparece no card como R$ 20 e tem que ordenar como R$ 20.
// 2. Com "Com desconto" ligado, a categoria que ficou sem nenhum produto some
//    por inteiro: nada de título "Brinquedos" com "0 produtos" e lista vazia.
// 3. O aviso para leitor de tela diz "2 produtos encontrados" (plural a partir
//    de 2), não só o singular de 1.
// 4. Sem nenhum favorito, a tela sugere no máximo 4 produtos da loja.
// 5. Na ordem original, o botão de ordenar mostra o rótulo simples "Ordem" (e
//    não fica vazio); o teste vizinho usava `toContain("Ordem")`, que as
//    próprias opções do seletor ("Ordem original") já satisfazem.
import type { Product } from "@/types";
import { FavoritesView } from "@/views/customer/FavoritesView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loja = vi.hoisted(() => ({
  config: { enableReviews: false },
  products: [] as unknown[],
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: loja.config, products: loja.products }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ erro: null, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn(), prefetchImage: vi.fn() }),
}));

function produto(
  id: string,
  name: string,
  price: number,
  category: string | undefined,
  extra: Record<string, unknown> = {},
): Product {
  return {
    id,
    name,
    price,
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
  loja.products = [];
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

function montar(lista: Product[]) {
  act(() =>
    raiz.render(
      <FavoritesView
        favorites={lista}
        onToggleFavorite={vi.fn()}
        onProductClick={vi.fn()}
        onNavigate={vi.fn()}
        isActive
      />,
    ),
  );
}
function escolherOrdem(valor: string) {
  const ordem = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Ordem dos favoritos"]',
  );
  expect(ordem).not.toBeNull();
  act(() => {
    if (!ordem) return;
    ordem.value = valor;
    ordem.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function secoes() {
  return [...container.querySelectorAll("section")].map((sec) => ({
    titulo: sec.querySelector("h2")?.textContent,
    itens: [...sec.querySelectorAll("h3 button")].map((el) => el.textContent),
  }));
}

describe("Favoritos — ordenação por preço usa o preço de vitrine", () => {
  const lista = [
    // Cadastrado a 50, mas a única opção à venda custa 20.
    produto("a", "Cadastrado a 50", 50, "Casa", {
      variants: [
        {
          id: "v-a",
          name: "Tamanho",
          value: "G",
          active: true,
          stockIncrement: 3,
          priceOverride: 20,
        },
      ],
    }),
    produto("b", "Custa 30", 30, "Casa"),
    produto("c", "Custa 40", 40, "Casa"),
  ];

  it("menor preço: o de vitrine 20 vem antes do de 30 e do de 40", () => {
    montar(lista);
    escolherOrdem("menor");
    expect(secoes()).toEqual([
      {
        titulo: "Casa",
        itens: ["Cadastrado a 50", "Custa 30", "Custa 40"],
      },
    ]);
  });

  it("maior preço: o de vitrine 20 vai para o fim", () => {
    montar(lista);
    escolherOrdem("maior");
    expect(secoes()).toEqual([
      {
        titulo: "Casa",
        itens: ["Custa 40", "Custa 30", "Cadastrado a 50"],
      },
    ]);
  });
});

describe("Favoritos — o que sobra depois do filtro 'Com desconto'", () => {
  const lista = [
    produto("a", "Em promoção", 50, "Casa", { originalPrice: 100 }),
    produto("b", "Sem promoção", 30, "Casa"),
    produto("c", "Outro sem promoção", 20, "Brinquedos"),
  ];

  it("a categoria sem nenhum produto em promoção não deixa seção vazia", () => {
    montar(lista);
    expect(secoes().map((secao) => secao.titulo)).toEqual([
      "Casa",
      "Brinquedos",
    ]);

    act(() => {
      const filtro = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.startsWith("Com desconto"),
      );
      filtro?.click();
    });

    expect(secoes()).toEqual([{ titulo: "Casa", itens: ["Em promoção"] }]);
  });

  it("o aviso de leitor de tela usa o plural a partir de 2 produtos", () => {
    montar(lista);
    const aviso = () =>
      container.querySelector('p.sr-only[role="status"]')?.textContent;

    expect(aviso()).toBe("3 produtos encontrados");
    act(() => {
      const filtro = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.startsWith("Com desconto"),
      );
      filtro?.click();
    });
    expect(aviso()).toBe("1 produto encontrado");
  });

  it("dois produtos: '2 produtos encontrados'", () => {
    montar(lista.slice(0, 2));
    expect(
      container.querySelector('p.sr-only[role="status"]')?.textContent,
    ).toBe("2 produtos encontrados");
  });
});

describe("Favoritos — lista vazia e rótulo da ordem", () => {
  it("sem favoritos, sugere só os 4 primeiros produtos ativos da loja", () => {
    loja.products = [
      produto("p1", "Primeiro", 10, "Casa"),
      produto("p2", "Segundo", 10, "Casa"),
      produto("p3", "Terceiro", 10, "Casa"),
      produto("p4", "Quarto", 10, "Casa"),
      produto("p5", "Quinto", 10, "Casa"),
      produto("p6", "Sexto", 10, "Casa"),
    ];
    montar([]);

    const cartoes = container.querySelectorAll("button[data-botao-favorito]");
    expect(cartoes).toHaveLength(4);
    expect(container.textContent).toContain("Quarto");
    expect(container.textContent).not.toContain("Quinto");
  });

  it("na ordem original o botão mostra 'Ordem'; ao escolher outra, o nome dela", () => {
    montar([produto("a", "Único", 10, "Casa")]);
    const ordem = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Ordem dos favoritos"]',
    );
    const rotulo = () =>
      Array.from(ordem?.parentElement?.childNodes ?? [])
        .filter((no) => no.nodeType === Node.TEXT_NODE)
        .map((no) => no.textContent)
        .join("");

    expect(rotulo()).toBe("Ordem");
    escolherOrdem("maior");
    expect(rotulo()).toBe("Maior preço");
  });
});

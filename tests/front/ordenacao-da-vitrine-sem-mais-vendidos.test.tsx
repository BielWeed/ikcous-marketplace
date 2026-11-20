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
const categoriasDaLoja = vi.hoisted(() => ({
  categories: [{ id: "geral", name: "Geral", isActive: true }],
  isLoading: false,
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => categoriasDaLoja,
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
    categoriasDaLoja.categories = [
      { id: "geral", name: "Geral", isActive: true },
    ];
    categoriasDaLoja.isLoading = false;
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
    isLoading = false,
    produtos: Product[] = PRODUTOS,
  ) => {
    await act(async () => {
      raiz.render(
        <HomeView
          products={produtos}
          isLoading={isLoading}
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
      'button[aria-haspopup="listbox"]',
    );
    expect(botao).not.toBeNull();
    await act(async () => {
      botao?.click();
    });
  };

  const opcoes = () =>
    Array.from(hospedeiro.querySelectorAll('[role="option"]'));

  it("categorias e Filtros ficam na mesma faixa e a contagem só é lida", async () => {
    await montar("default");
    const faixa = hospedeiro.querySelector(
      '[data-testid="faixa-categorias-filtros"]',
    );
    const categoria = hospedeiro.querySelector(
      'button[aria-label="Selecionar categoria Todas"]',
    );
    const filtros = hospedeiro.querySelector('button[aria-haspopup="listbox"]');
    expect(faixa).not.toBeNull();
    expect(faixa?.contains(categoria)).toBe(true);
    expect(faixa?.contains(filtros)).toBe(true);
    expect(faixa?.classList.contains("flex")).toBe(true);
    expect(filtros?.parentElement?.parentElement).toBe(faixa);
    expect(
      categoria?.parentElement?.parentElement?.parentElement?.parentElement,
    ).toBe(faixa);
    const contagem = hospedeiro.querySelector(
      '[data-testid="resultado-categoria"]',
    );
    expect(contagem?.className).toBe("sr-only");
    expect(contagem?.getAttribute("aria-live")).toBe("polite");
    expect(contagem?.textContent).toBe("Todas · 4 produtos");
  });

  it("avisa a ordenação alterada no nome acessível e no indicador", async () => {
    await montar("price-asc");
    const filtros = hospedeiro.querySelector('button[aria-haspopup="listbox"]');
    expect(filtros?.getAttribute("aria-label")).toBe(
      "Filtros, ordenado por Menor preço",
    );
    expect(filtros?.getAttribute("title")).toBe(
      "Filtros, ordenado por Menor preço",
    );
    expect(
      filtros?.querySelector('[data-testid="ordenacao-ativa"]'),
    ).not.toBeNull();
    await montar("default");
    expect(filtros?.getAttribute("aria-label")).toBe("Filtros");
    expect(
      filtros?.querySelector('[data-testid="ordenacao-ativa"]'),
    ).toBeNull();
  });

  it("abre o menu e Esc fecha devolvendo o foco a Filtros", async () => {
    await montar("default");
    await abrirMenu();
    const filtros = hospedeiro.querySelector('button[aria-haspopup="listbox"]');
    const menu = hospedeiro.querySelector<HTMLElement>('[role="listbox"]');
    expect(document.activeElement).toBe(menu);
    await act(async () => {
      menu?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(hospedeiro.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(filtros);
    expect(filtros?.getAttribute("aria-expanded")).toBe("false");
  });

  it("devolve o foco a Filtros após ativar uma ordem pelo teclado", async () => {
    const aoMudar = vi.fn();
    await montar("default", aoMudar);
    await abrirMenu();
    const filtros = hospedeiro.querySelector('button[aria-haspopup="listbox"]');
    const opcao = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ].find((botao) => botao.textContent?.includes("Menor Preço"))!;
    await act(async () => opcao.focus());
    expect(document.activeElement).toBe(opcao);
    // jsdom não dispara o clique nativo de Enter no botão focado.
    await act(async () => opcao.click());

    expect(aoMudar).toHaveBeenCalledWith("price-asc");
    expect(hospedeiro.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(filtros);
  });

  it("fecha Filtros quando Tab passa da última opção, sem roubar o foco", async () => {
    await montar("default");
    const filtros = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="listbox"]',
    )!;
    const proximo = document.createElement("button");
    hospedeiro.after(proximo);
    try {
      await act(async () => {
        filtros.focus();
        // jsdom não executa a ação padrão de Enter num botão.
        filtros.click();
      });
      const menu = hospedeiro.querySelector('[role="listbox"]');
      expect(menu).not.toBeNull();
      // jsdom também não move o foco com Tab: reproduzimos as transições.
      for (const opcao of hospedeiro.querySelectorAll<HTMLElement>(
        '[role="option"]',
      )) {
        await act(async () => opcao.focus());
        expect(document.activeElement).toBe(opcao);
        expect(hospedeiro.querySelector('[role="listbox"]')).toBe(menu);
      }
      await act(async () => proximo.focus());
      expect(hospedeiro.querySelector('[role="listbox"]')).toBeNull();
      expect(hospedeiro.querySelector('[aria-label="Fechar menu"]')).toBeNull();
      expect(document.activeElement).toBe(proximo);
    } finally {
      proximo.remove();
    }
  });

  it("reserva a mesma faixa com Filtros durante o carregamento e sem categorias", async () => {
    await montar("default", undefined, true);
    const faixa = hospedeiro.querySelector(
      '[data-testid="faixa-categorias-filtros"]',
    );
    expect(faixa?.classList.contains("h-[88px]")).toBe(true);
    expect(
      faixa?.querySelectorAll('[data-testid="categoria-skeleton"]'),
    ).toHaveLength(5);
    expect(faixa?.querySelector('button[aria-label="Filtros"]')).not.toBeNull();
    const classes = faixa?.className;
    await montar("default");
    expect(
      hospedeiro.querySelector('[data-testid="faixa-categorias-filtros"]')
        ?.className,
    ).toBe(classes);
    expect(faixa?.querySelector('button[aria-label="Filtros"]')).not.toBeNull();
    expect(
      faixa?.querySelector('button[aria-label="Selecionar categoria Geral"]'),
    ).not.toBeNull();
    categoriasDaLoja.categories = [];
    await montar("default");
    expect(faixa?.className).toBe(classes);
    expect(faixa?.querySelector('button[aria-label="Filtros"]')).not.toBeNull();
    categoriasDaLoja.isLoading = true;
    await montar("default");
    expect(faixa?.className).toBe(classes);
    expect(
      faixa?.querySelectorAll('[data-testid="categoria-skeleton"]'),
    ).toHaveLength(5);
    expect(faixa?.querySelector('button[aria-label="Filtros"]')).not.toBeNull();
  });

  it("clicar fora fecha o menu sem selecionar uma opção", async () => {
    const aoMudar = vi.fn();
    await montar("default", aoMudar);
    await abrirMenu();
    const camada = hospedeiro.querySelector<HTMLElement>(
      '[aria-label="Fechar menu"]',
    )!;
    await act(async () => camada.click());
    expect(hospedeiro.querySelector('[role="listbox"]')).toBeNull();
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("o menu oferece só Relevância, Menor preço e Maior preço", async () => {
    await montar("default");
    await abrirMenu();

    expect(opcoes().map((opcao) => opcao.textContent?.trim())).toEqual([
      "Relevância",
      "Menor preço",
      "Maior preço",
    ]);
    expect(hospedeiro.textContent).not.toMatch(/mais vendidos?/i);
  });

  it("tocar numa opção devolve o valor dela, e nenhuma é 'sold'", async () => {
    const escolhas: SortOption[] = [];
    await montar("default", (ordem) => escolhas.push(ordem));

    for (const rotulo of ["Relevância", "Menor preço", "Maior preço"]) {
      await abrirMenu();
      const opcao = opcoes().find((o) => o.textContent?.trim() === rotulo);
      expect(opcao).toBeDefined();
      const alvo = opcao as HTMLElement;
      await act(async () => {
        const naoCancelado = alvo.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
        // Reproduz a perda de foco de navegadores que não focam o botão
        // pressionado. O click só chega se a opção ainda estiver montada.
        if (naoCancelado) {
          (document.activeElement as HTMLElement).blur();
        }
      });
      expect(alvo.isConnected).toBe(true);
      await act(async () => alvo.click());
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

  it.each<{ ordem: SortOption; esperado: string[] }>([
    { ordem: "price-asc", esperado: ["com-opcao", "simples"] },
    { ordem: "price-desc", esperado: ["simples", "com-opcao"] },
  ])(
    "$ordem usa o preço anunciado da variação disponível",
    async ({ ordem, esperado }) => {
      const comOpcao: Product = {
        ...produto("com-opcao", 300, 5, 0),
        variants: [
          {
            id: "opcao-disponivel",
            productId: "com-opcao",
            name: "Tamanho",
            value: "P",
            active: true,
            stockIncrement: 5,
            priceOverride: 120,
          },
        ],
      };
      await montar(ordem, undefined, false, [
        produto("simples", 200, 5, 0),
        comOpcao,
      ]);
      expect(ordemNaTela()).toEqual(esperado);
    },
  );

  it.each<{ ordem: SortOption; esperado: string[] }>([
    { ordem: "price-asc", esperado: ["simples", "com-opcoes"] },
    { ordem: "price-desc", esperado: ["com-opcoes", "simples"] },
  ])(
    "$ordem ignora a variação mais barata esgotada",
    async ({ ordem, esperado }) => {
      const comOpcoes: Product = {
        ...produto("com-opcoes", 100, 5, 0),
        variants: [
          {
            id: "opcao-esgotada",
            productId: "com-opcoes",
            name: "Tamanho",
            value: "P",
            active: true,
            stockIncrement: 0,
            priceOverride: 50,
          },
          {
            id: "opcao-disponivel",
            productId: "com-opcoes",
            name: "Tamanho",
            value: "G",
            active: true,
            stockIncrement: 5,
            priceOverride: 250,
          },
        ],
      };
      await montar(ordem, undefined, false, [
        comOpcoes,
        produto("simples", 200, 5, 0),
      ]);
      expect(ordemNaTela()).toEqual(esperado);
    },
  );

  // Sem variação, `price` já é o preço promocional; `originalPrice` é só o "De".
  it.each<{ ordem: SortOption; esperado: string[] }>([
    { ordem: "price-asc", esperado: ["promocao", "simples"] },
    { ordem: "price-desc", esperado: ["simples", "promocao"] },
  ])(
    "$ordem usa o preço promocional, não o preço riscado",
    async ({ ordem, esperado }) => {
      await montar(ordem, undefined, false, [
        produto("simples", 200, 5, 0),
        { ...produto("promocao", 120, 5, 0), originalPrice: 300 },
      ]);
      expect(ordemNaTela()).toEqual(esperado);
    },
  );

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

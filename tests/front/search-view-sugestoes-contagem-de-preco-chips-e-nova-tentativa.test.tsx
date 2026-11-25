// @vitest-environment jsdom
//
// Buracos de prova da tela de Busca achados por MUTAÇÃO (plantar um defeito de
// uma linha em `SearchView.tsx` e ver se algum teste cai). Dos 50 defeitos
// plantados, 14 sobreviviam a todos os testes vizinhos; 12 caem com este
// arquivo e 2 são EQUIVALENTES (o `?? 0` do recuo de rolagem do cabeçalho, que
// só vale com o cabeçalho ausente — ele sempre existe —, e o
// `if (tentandoBusca) return;` do toque em "Tentar de novo", que repete o
// `disabled` do botão). Cada teste abaixo
// derruba alguns:
// - "Alguns produtos da loja" (estado vazio) mostra no MÁXIMO quatro cartões
//   (o grid tem 4 colunas; um quinto deixava um furo);
// - a faixa de preço guardada (`filtrosIniciais`, a cliente voltou de um
//   produto) conta no "Filtros (n)": mínimo conta 1, máximo conta 1, os dois 2;
// - a fileira de filtros rápidos mostra "Todas" + 5 categorias (6 chips), não
//   mais, não menos;
// - "Tentar de novo" (catálogo falhou) troca a tela por "Carregando busca…" e,
//   enquanto a nova tentativa corre, a região viva do leitor de tela NÃO afirma
//   "A loja ainda não tem produtos" (ainda não se sabe).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(p: Partial<Product> & Pick<Product, "id">): Product {
  return {
    name: p.id,
    description: "",
    price: 100,
    images: [],
    category: "Vestidos",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...p,
  };
}

const observadores: ((entradas: { isIntersecting: boolean }[]) => void)[] = [];

const loja = vi.hoisted(() => ({
  config: {
    enableReviews: false,
    shippingFee: 10,
    freeShippingMin: 0,
  } as Record<string, unknown>,
  catalogo: [] as unknown[],
  catalogoErro: false,
  loadingProducts: false,
  fetchProducts: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: loja.catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: loja.config,
    catalogoErro: loja.catalogoErro,
    loadingProducts: loja.loadingProducts,
    fetchProducts: loja.fetchProducts,
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: (props: {
    product: { id: string };
    onAddToCart?: (produto: unknown, clique?: unknown) => unknown;
    onAddToCartWithVariants?: (
      produto: unknown,
      variantId: string | undefined,
      variantNames: string,
      quantity?: number,
    ) => unknown;
  }) => (
    <span data-testid="resultado">
      {props.product.id}
      <button
        type="button"
        data-acao={`adicionar-${props.product.id}`}
        onClick={(clique) => props.onAddToCart?.(props.product, clique)}
      />
      <button
        type="button"
        data-acao={`opcoes-${props.product.id}`}
        onClick={() =>
          props.onAddToCartWithVariants?.(props.product, "var-1", "Azul")
        }
      />
    </span>
  ),
}));
// Painel "Refinar Busca" fechado: o Radix real pede APIs que o jsdom não tem.
// Os chips medidos aqui ficam FORA do painel, na fileira de filtros rápidos.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: () => null,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("SearchView — sugestões, contagem de preço, chips e nova tentativa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/SearchView");
  }, 60_000);

  beforeEach(() => {
    loja.catalogo = [];
    loja.catalogoErro = false;
    loja.loadingProducts = false;
    loja.config = { enableReviews: false, shippingFee: 10, freeShippingMin: 0 };
    loja.fetchProducts.mockReset();
    observadores.length = 0;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entradas: { isIntersecting: boolean }[]) => void) {
          observadores.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
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

  async function abrir(
    props: {
      initialQuery?: string;
      onBack?: () => void;
      onAddToCart?: (...args: unknown[]) => unknown;
      quantidadeInicial?: { termo: string; quantidade: number };
      filtrosIniciais?: {
        category: string;
        minPrice: number | "";
        maxPrice: number | "";
        sort: "newest";
      };
    } = {},
  ) {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          initialQuery={props.initialQuery ?? ""}
          filtrosIniciais={props.filtrosIniciais}
          quantidadeInicial={props.quantidadeInicial}
          onAddToCart={props.onAddToCart}
          onNavigate={() => {}}
          onBack={props.onBack ?? (() => {})}
        />,
      );
    });
  }

  const ids = () =>
    [...hospedeiro.querySelectorAll('[data-testid="resultado"]')].map(
      (el) => el.textContent,
    );
  const botaoFiltros = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Filtros"),
    ) as HTMLButtonElement;
  const regiaoViva = () =>
    hospedeiro.querySelector('p[role="status"].sr-only')?.textContent;

  it("nenhum resultado: as sugestões são os QUATRO primeiros produtos à venda e com estoque", async () => {
    loja.catalogo = [
      produto({ id: "p1" }),
      produto({ id: "esgotado", stock: 0 }),
      produto({ id: "p2" }),
      produto({ id: "p3" }),
      produto({ id: "p4" }),
      produto({ id: "p5" }),
      produto({ id: "p6" }),
    ];
    await abrir({ initialQuery: "nada-parecido" });
    expect(hospedeiro.textContent).toContain("Ué, nenhum resultado?");
    expect(ids()).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("nenhum resultado e só 3 produtos disponíveis: mostra os 3 (não inventa o quarto)", async () => {
    loja.catalogo = [
      produto({ id: "p1" }),
      produto({ id: "p2" }),
      produto({ id: "p3" }),
    ];
    await abrir({ initialQuery: "nada-parecido" });
    expect(ids()).toEqual(["p1", "p2", "p3"]);
  });

  it("a frase 'Que tal dar uma olhada...' só aparece quando há sugestões (basta UMA)", async () => {
    loja.catalogo = [produto({ id: "p1" })];
    await abrir({ initialQuery: "nada-parecido" });
    expect(hospedeiro.textContent).toContain(
      "Que tal dar uma olhada em alguns produtos da loja?",
    );
    expect(ids()).toEqual(["p1"]);

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    loja.catalogo = [produto({ id: "esgotado", stock: 0 })];
    await abrir({ initialQuery: "nada-parecido" });
    expect(hospedeiro.textContent).toContain("Ué, nenhum resultado?");
    expect(hospedeiro.textContent).not.toContain("Que tal dar uma olhada");
    expect(ids()).toEqual([]);
  });

  it("o título das sugestões usa o nome da loja SEM os espaços das pontas; em branco, o nome do app", async () => {
    const { branding } = await import("@/config/branding");
    loja.catalogo = [produto({ id: "p1" })];
    loja.config = { ...loja.config, storeName: "  Loja da Ana  " };
    await abrir({ initialQuery: "nada-parecido" });
    const titulo = () =>
      [...hospedeiro.querySelectorAll("h3")].map((h) => h.textContent)[0];
    expect(titulo()).toBe("Alguns produtos da Loja da Ana");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    loja.config = { ...loja.config, storeName: "   " };
    await abrir({ initialQuery: "nada-parecido" });
    expect(titulo()).toBe(`Alguns produtos da ${branding.appName}`);
  });

  it("carrinho: o toque do cartão entrega só o produto; a quantidade que o cartão não informa vale 1", async () => {
    const adicionar = vi.fn();
    loja.catalogo = [produto({ id: "p1" })];
    await abrir({ onAddToCart: adicionar });
    const botao = (acao: string) =>
      hospedeiro.querySelector<HTMLButtonElement>(`[data-acao="${acao}"]`);
    await act(async () => {
      botao("adicionar-p1")?.click();
    });
    expect(adicionar).toHaveBeenCalledTimes(1);
    expect(adicionar.mock.calls[0]).toEqual([loja.catalogo[0]]);
    await act(async () => {
      botao("opcoes-p1")?.click();
    });
    expect(adicionar).toHaveBeenCalledTimes(2);
    expect(adicionar).toHaveBeenLastCalledWith(
      loja.catalogo[0],
      1,
      "var-1",
      "Azul",
    );
  });

  it("o botão Voltar do topo chama onBack uma vez", async () => {
    const voltar = vi.fn();
    loja.catalogo = [produto({ id: "p1" })];
    await abrir({ onBack: voltar });
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('button[aria-label="Voltar"]')
        ?.click();
    });
    expect(voltar).toHaveBeenCalledTimes(1);
  });

  describe("lista longa: carregar mais ao rolar", () => {
    const trinta = () =>
      Array.from({ length: 30 }, (_, i) => produto({ id: `p${i + 1}` }));

    it("começa com 12; o sentinela SÓ carrega mais quando entra na tela", async () => {
      loja.catalogo = trinta();
      await abrir();
      expect(ids()).toHaveLength(12);
      const avisarSentinela = observadores[observadores.length - 1];
      await act(async () => {
        avisarSentinela([{ isIntersecting: false }]);
      });
      expect(ids()).toHaveLength(12);
      await act(async () => {
        avisarSentinela([{ isIntersecting: true }]);
      });
      expect(ids()).toHaveLength(24);
    });

    it("quantidade guardada MENOR que 12 não encurta a lista: continua 12", async () => {
      loja.catalogo = trinta();
      await abrir({ quantidadeInicial: { termo: "", quantidade: 5 } });
      expect(ids()).toHaveLength(12);
    });

    it("quantidade guardada maior (e do mesmo termo) é restaurada", async () => {
      loja.catalogo = trinta();
      await abrir({ quantidadeInicial: { termo: "", quantidade: 24 } });
      expect(ids()).toHaveLength(24);
    });
  });

  it.each([
    ["sem faixa guardada", "", "", null],
    ["só o mínimo", 10, "", "(1)"],
    ["só o máximo", "", 500, "(1)"],
    ["mínimo e máximo", 10, 500, "(2)"],
  ] as const)(
    "faixa de preço guardada — %s: o botão Filtros mostra a conta certa",
    async (_nome, minPrice, maxPrice, esperado) => {
      loja.catalogo = [produto({ id: "p1" })];
      await abrir({
        filtrosIniciais: {
          category: "Todas",
          minPrice,
          maxPrice,
          sort: "newest",
        },
      });
      const texto = botaoFiltros().textContent ?? "";
      if (esperado === null) expect(texto).not.toContain("(");
      else expect(texto).toContain(esperado);
    },
  );

  it("filtros rápidos: 'Todas' + 5 categorias, mesmo com 8 categorias na loja", async () => {
    loja.catalogo = [
      "Vestidos",
      "Sandálias",
      "Bolsas",
      "Blusas",
      "Saias",
      "Calças",
      "Cintos",
      "Meias",
    ].map((categoria) => produto({ id: categoria, category: categoria }));
    await abrir();
    const chips = [...hospedeiro.querySelectorAll("button[aria-pressed]")].map(
      (b) => b.textContent,
    );
    expect(chips).toEqual([
      "Todas",
      "Vestidos",
      "Sandálias",
      "Bolsas",
      "Blusas",
      "Saias",
    ]);
  });

  it("catálogo falhou: 'Tentar de novo' mostra 'Carregando busca…' e a região viva não afirma loja vazia enquanto corre", async () => {
    loja.catalogo = [];
    loja.catalogoErro = true;
    let terminar!: () => void;
    loja.fetchProducts.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          terminar = resolve;
        }),
    );
    await abrir();
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    expect(hospedeiro.textContent).toContain(
      "Não conseguimos carregar a busca agora",
    );

    const tentar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Tentar de novo",
    );
    await act(async () => {
      tentar?.click();
    });
    expect(hospedeiro.textContent).toContain("Carregando busca…");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();

    // O contexto limpa o erro ao começar a nova tentativa, mas a busca ainda
    // corre: a tela segue em "Carregando" e a região viva fica em silêncio.
    loja.catalogoErro = false;
    await abrir();
    expect(hospedeiro.textContent).toContain("Carregando busca…");
    expect(regiaoViva()).toBe("");

    await act(async () => terminar());
    expect(hospedeiro.textContent).not.toContain("Carregando busca…");
    expect(regiaoViva()).toBe("A loja ainda não tem produtos.");
    expect(loja.fetchProducts).toHaveBeenCalledTimes(1);
  });
});

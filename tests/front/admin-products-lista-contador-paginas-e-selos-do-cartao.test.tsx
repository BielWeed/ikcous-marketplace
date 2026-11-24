// @vitest-environment jsdom
//
// Caça por mutação na LISTA de produtos do painel: regras que nenhum teste
// segurava (cada uma foi mutada no código de produção e a suíte existente
// continuou verde):
//  - o contador do cabeçalho diz de onde vem o número ("no catálogo",
//    "na busca", "nesta categoria");
//  - o indicador de páginas ("1 de 2") e o aviso de página única, com a
//    fronteira de 12 por página (12 cabe numa, 13 pede duas, 24 duas, 25 três);
//  - o número do estoque fica VERMELHO quando o produto esgotou (e não âmbar,
//    mesmo o esgotado entrando na regra de "estoque baixo");
//  - o mínimo 0 aparece como "mín. 0" (não vira o padrão 5);
//  - esgotado no cartão compacto não ganha "Crítico" nem "mín.";
//  - "Estoque total" só com variações; "em estoque" só quando está tudo bem;
//  - "1 variação" no singular; a dica dos dois grupos de variação;
//  - o botão Ativo/Ativar diz o estado (aria-pressed);
//  - o vazio com busca E categoria nomeia as duas.
//
// Monta `AdminProductsView` de verdade (createRoot + act); só os hooks de dados
// são dublados, como em admin-products-esgotado.test.tsx.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  produtos: [] as any[],
  total: 0,
  loadProducts: vi.fn(),
}));
const onNavigate = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: h.produtos,
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts: h.loadProducts,
    loadProductsSemCusto: vi.fn().mockResolvedValue({ products: [] }),
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 500, totalValue: 900 } },
    fetchExecutiveSummary: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

function produto(extra: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    name: "Produto de Teste",
    category: "Geral",
    images: [],
    isActive: true,
    stock: 20,
    price: 100,
    variants: [],
    ...extra,
  };
}

describe.each(["compact", "detailed"] as const)(
  "Lista de produtos do painel (%s): contador, páginas e selos",
  (viewMode) => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;
    let armazem: Map<string, string>;

    beforeEach(() => {
      vi.clearAllMocks();
      h.produtos = [produto()];
      h.total = 1;
      h.loadProducts.mockImplementation(async () => ({
        products: h.produtos,
        total: h.total,
      }));
      vi.stubGlobal("IntersectionObserver", ObserverStub);
      vi.stubGlobal("ResizeObserver", ObserverStub);
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      armazem = new Map<string, string>();
      if (viewMode === "detailed")
        armazem.set("admin_products_view_mode", "detailed");
      vi.stubGlobal("localStorage", {
        getItem: (chave: string) => armazem.get(chave) ?? null,
        setItem: (chave: string, valor: string) => {
          armazem.set(chave, valor);
        },
        removeItem: (chave: string) => {
          armazem.delete(chave);
        },
      });
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
    });

    afterEach(() => {
      act(() => raiz.unmount());
      hospedeiro.remove();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    async function montar() {
      const { AdminProductsView } = await import(
        "@/views/admin/AdminProductsView"
      );
      await act(async () => {
        raiz.render(
          <AdminProductsView onNavigate={onNavigate} active={true} />,
        );
      });
      // A lista é buscada 320 ms depois de abrir.
      await esperar(380);
    }

    const texto = () => hospedeiro.textContent ?? "";
    const cartao = () =>
      hospedeiro.querySelector<HTMLElement>(
        viewMode === "detailed"
          ? ".content-visibility-detailed-card"
          : ".content-visibility-compact-card",
      )!;
    /** O span que carrega só o número do estoque (a cor mora nele). */
    const numeroDoEstoque = (valor: number) =>
      [...cartao().querySelectorAll<HTMLElement>("span")].find(
        (el) => el.textContent === String(valor) && el.children.length === 0,
      )!;

    describe("contador do cabeçalho", () => {
      it("sem busca nem categoria: diz 'no catálogo'", async () => {
        h.total = 13;
        await montar();
        expect(texto()).toContain("Sincronizado · 13 no catálogo");
      });

      it("com busca: diz 'na busca', com o total da busca", async () => {
        armazem.set("admin_products_search_term", JSON.stringify("camiseta"));
        h.total = 3;
        await montar();
        expect(texto()).toContain("Sincronizado · 3 na busca");
        expect(texto()).not.toContain("no catálogo");
      });

      it("com categoria: diz 'nesta categoria'", async () => {
        armazem.set("admin_products_filter_category", JSON.stringify("Roupas"));
        h.total = 4;
        await montar();
        expect(texto()).toContain("Sincronizado · 4 nesta categoria");
      });

      it("com busca E categoria: a busca é a que nomeia o número", async () => {
        armazem.set("admin_products_search_term", JSON.stringify("camiseta"));
        armazem.set("admin_products_filter_category", JSON.stringify("Roupas"));
        h.total = 2;
        await montar();
        expect(texto()).toContain("Sincronizado · 2 na busca");
        expect(texto()).not.toContain("nesta categoria");
      });
    });

    describe("indicador de páginas (12 por página)", () => {
      it.each([
        [13, "1 de 2"],
        [24, "1 de 2"],
        [25, "1 de 3"],
      ])("com %i produtos mostra '%s'", async (total, esperado) => {
        h.total = total;
        await montar();
        const indicador = hospedeiro.querySelector(".produtos-pagina");
        expect(indicador?.textContent).toBe(esperado);
        expect(texto()).not.toContain("Todos os resultados estão nesta página");
      });

      it.each([1, 12])(
        "com %i produto(s) cabe numa página: '1 de 1' e o aviso de página única",
        async (total) => {
          h.total = total;
          await montar();
          expect(hospedeiro.querySelector(".produtos-pagina")).toBeNull();
          expect(texto()).toContain("1 de 1");
          expect(texto()).toContain("Todos os resultados estão nesta página.");
        },
      );

      it("na segunda página de três, o indicador diz '2 de 3' e a lista pede a página certa", async () => {
        armazem.set("admin_products_current_page", JSON.stringify(1));
        h.total = 25;
        await montar();
        expect(h.loadProducts).toHaveBeenCalledWith(1, 12, expect.anything());
        expect(hospedeiro.querySelector(".produtos-pagina")?.textContent).toBe(
          "2 de 3",
        );
        expect(texto()).toContain("Exibindo 13 - 24 de 25");
      });
    });

    describe("estoque no cartão", () => {
      it("esgotado (0, mínimo padrão): o número do estoque é vermelho, não âmbar", async () => {
        h.produtos = [produto({ stock: 0 })];
        await montar();
        const numero = numeroDoEstoque(0);
        expect(numero.className).toContain("text-red-400");
        expect(numero.className).not.toContain("text-amber-400");
      });

      it("estoque baixo (3 com mínimo padrão): âmbar; estoque folgado: sem cor de alerta", async () => {
        h.produtos = [produto({ stock: 3 })];
        await montar();
        expect(numeroDoEstoque(3).className).toContain("text-amber-400");
        expect(numeroDoEstoque(3).className).not.toContain("text-red-400");

        act(() => raiz.unmount());
        raiz = createRoot(hospedeiro);
        h.produtos = [produto({ stock: 20 })];
        await montar();
        const folgado = numeroDoEstoque(20);
        expect(folgado.className).not.toContain("text-red-400");
        expect(folgado.className).not.toContain("text-amber-400");
      });

      it("o botão de pausar diz o estado: ativo = pressionado e 'Ativo'; pausado = solto e 'Ativar'", async () => {
        h.produtos = [produto({ name: "Capa Azul", isActive: true })];
        await montar();
        const pausar = cartao().querySelector<HTMLButtonElement>(
          'button[aria-label="Pausar Capa Azul"]',
        )!;
        expect(pausar.getAttribute("aria-pressed")).toBe("true");
        expect(pausar.textContent).toContain("Ativo");

        act(() => raiz.unmount());
        raiz = createRoot(hospedeiro);
        h.produtos = [produto({ name: "Capa Azul", isActive: false })];
        await montar();
        const ativar = cartao().querySelector<HTMLButtonElement>(
          'button[aria-label="Ativar Capa Azul"]',
        )!;
        expect(ativar.getAttribute("aria-pressed")).toBe("false");
        expect(ativar.textContent).toContain("Ativar");
      });
    });

    describe("vazio com filtros", () => {
      it("busca E categoria sem resultado: o aviso nomeia as duas, ligadas por 'e'", async () => {
        armazem.set("admin_products_search_term", JSON.stringify("zzz"));
        armazem.set("admin_products_filter_category", JSON.stringify("Roupas"));
        h.produtos = [];
        h.total = 0;
        await montar();
        expect(texto()).toContain(
          'Nada combina com a busca "zzz" e a categoria "Roupas".',
        );
      });
    });
  },
);

describe("Lista de produtos do painel (compacto): selos do cartão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.total = 1;
    h.loadProducts.mockImplementation(async () => ({
      products: h.produtos,
      total: h.total,
    }));
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await esperar(380);
  }
  const cartao = () =>
    hospedeiro.querySelector<HTMLElement>(".content-visibility-compact-card")!;
  const selos = () =>
    [...cartao().querySelectorAll('[data-slot="badge"]')].map(
      (el) => el.textContent,
    );

  it("esgotado não ganha 'Crítico' nem 'mín.' (o selo 'Esgotado' já diz tudo)", async () => {
    h.produtos = [produto({ stock: 0 })];
    await montar();
    expect(selos()).toContain("Esgotado");
    expect(selos()).not.toContain("Crítico");
    expect(cartao().textContent).not.toContain("mín.");
  });

  it("estoque baixo (3): 'Crítico', 'un.' e o mínimo padrão, sem 'em estoque'", async () => {
    h.produtos = [produto({ stock: 3 })];
    await montar();
    expect(selos()).toContain("Crítico");
    expect(cartao().textContent).toContain("· mín. 5");
    // (o menu do cartão também diz "3 em estoque"; o do selo é "3" + "em estoque" colados)
    expect(cartao().textContent).not.toContain("3em estoque");
  });

  it("tudo em ordem: diz 'em estoque'", async () => {
    h.produtos = [produto({ stock: 20 })];
    await montar();
    expect(cartao().textContent).toContain("20em estoque");
  });

  it("variações: '1 variação' no singular e '2 variações' no plural", async () => {
    h.produtos = [
      produto({ variants: [{ id: "v1", name: "Cor", value: "Azul" }] }),
    ];
    await montar();
    expect(cartao().textContent).toContain("1 variação");
    expect(cartao().textContent).not.toContain("1 variações");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    h.produtos = [
      produto({
        variants: [
          { id: "v1", name: "Cor", value: "Azul" },
          { id: "v2", name: "Cor", value: "Preta" },
        ],
      }),
    ];
    await montar();
    expect(cartao().textContent).toContain("2 variações");
  });
});

describe("Lista de produtos do painel (detalhado): rótulos do cartão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.total = 1;
    h.loadProducts.mockImplementation(async () => ({
      products: h.produtos,
      total: h.total,
    }));
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) =>
        chave === "admin_products_view_mode" ? "detailed" : null,
      setItem: () => {},
      removeItem: () => {},
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await esperar(380);
  }
  const cartao = () =>
    hospedeiro.querySelector<HTMLElement>(".content-visibility-detailed-card")!;

  it("esgotado com mínimo 0: o rótulo diz 'mín. 0', não o padrão 5", async () => {
    h.produtos = [produto({ stock: 0, estoqueMinimo: 0 })];
    await montar();
    expect(cartao().textContent).toContain("Estoque · mín. 0");
    expect(cartao().textContent).not.toContain("mín. 5");
  });

  it("com variações o rótulo é 'Estoque total'; sem elas, 'Estoque'", async () => {
    // O rótulo é o parágrafo inteiro: "Unidades em Estoque" e a nota das
    // variações também citam a palavra, então não vale procurar no cartão todo.
    const rotulos = () =>
      [...cartao().querySelectorAll("p")].map((p) => p.textContent);
    h.produtos = [
      produto({ variants: [{ id: "v1", name: "Cor", value: "Azul" }] }),
    ];
    await montar();
    expect(rotulos()).toContain("Estoque total");
    expect(rotulos()).not.toContain("Estoque");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    h.produtos = [produto({ variants: [] })];
    await montar();
    expect(rotulos()).toContain("Estoque");
    expect(rotulos()).not.toContain("Estoque total");
  });

  it("produto antigo com dois grupos de variação: a dica nomeia os dois ('Cor e Tamanho')", async () => {
    h.produtos = [
      produto({
        variants: [
          { id: "v1", name: "Cor", value: "Azul" },
          { id: "v2", name: "Tamanho", value: "P" },
        ],
      }),
    ];
    await montar();
    expect(cartao().textContent).toContain(
      "Cor e Tamanho são grupos separados",
    );
  });
});

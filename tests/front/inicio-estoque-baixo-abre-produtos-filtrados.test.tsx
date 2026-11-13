// @vitest-environment jsdom
//
// Início → "N produtos com estoque baixo · Repor em Produtos": o toque caía na
// lista inteira de Produtos, e com centenas de produtos o lojista rolava para
// achar os poucos que faltam. Agora o card abre Produtos JÁ filtrada (só os
// ativos com estoque baixo, a mesma conta do número do card), com a faixa
// "Mostrando só produtos com estoque baixo · N" e o botão "Ver todos" para
// voltar à lista toda.
//
// O filtro é do servidor (`get_admin_products_paged` com `stock: "low"` e
// `status: "active"`, a regra de `painel_inicio`): aqui só se prova que a tela
// PEDE esse filtro e desenha o que voltou. Monta `AdminProductsView` de verdade
// (createRoot + act); só os hooks de dados são dublados.
import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  pagina: [] as any[],
  loadProducts: vi.fn(),
  loadProductsSemCusto: vi.fn(),
  categorias: [] as Array<{ name: string }>,
}));
const onNavigate = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: h.pagina,
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts: h.loadProducts,
    loadProductsSemCusto: h.loadProductsSemCusto,
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: null,
    fetchExecutiveSummary: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: h.categorias, addCategory: vi.fn() }),
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

const produto = (id: string, stock: number) => ({
  id,
  name: `Produto ${id}`,
  isActive: true,
  stock,
  price: 20,
  category: "Geral",
  images: [],
  variants: [],
});

const TODOS = [produto("a", 40), produto("b", 2), produto("c", 90)];
const BAIXOS = [produto("b", 2), produto("d", 0)];

const esperar = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe("Início: o card de estoque baixo abre Produtos já filtrada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("tocar no card manda para Produtos com a visão 'estoque-baixo'", async () => {
    const navegar = vi.fn();
    const painel = {
      pendencias: {
        pedidosParaPreparar: 0,
        devolucoesAbertas: 0,
        estoqueBaixo: 12,
        caixaAberto: false,
      },
      contasVencidas: 0,
    } as unknown as PainelInicio;
    await act(async () => {
      raiz.render(
        <ParaFazer painel={painel} carregando={false} onNavigate={navegar} />,
      );
    });
    const card = [...hospedeiro.querySelectorAll<HTMLButtonElement>("button")]
      .filter((b) => (b.getAttribute("aria-label") ?? "").includes("estoque"))
      .at(0);
    expect(card).toBeDefined();
    await act(async () => card!.click());
    expect(navegar).toHaveBeenLastCalledWith("admin-products", "estoque-baixo");
  });
});

describe("Produtos: a visão 'estoque baixo'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    h.categorias = [];
    localStorage.setItem("admin_products_view_mode", "detailed");
    h.pagina = TODOS;
    h.loadProducts.mockImplementation(
      async (_pagina: number, _tamanho: number, filtros?: any) => {
        const baixo = filtros?.stock === "low";
        h.pagina = baixo ? BAIXOS : TODOS;
        return { products: h.pagina, total: h.pagina.length };
      },
    );
    h.loadProductsSemCusto.mockResolvedValue({ products: [], total: 0 });
    Element.prototype.scrollIntoView = vi.fn();
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

  let Tela: typeof import("@/views/admin/AdminProductsView").AdminProductsView;
  async function renderizar(active: boolean, visaoInicial?: string | null) {
    Tela = (await import("@/views/admin/AdminProductsView")).AdminProductsView;
    await act(async () => {
      raiz.render(
        <Tela
          onNavigate={onNavigate}
          active={active}
          visaoInicial={visaoInicial}
        />,
      );
    });
    await esperar(360);
  }
  const faixa = () => hospedeiro.querySelector("[data-visao-estoque-baixo]");
  const botaoVerTodos = () =>
    [...hospedeiro.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === "Ver todos",
    );
  const nomesNaLista = () =>
    [...hospedeiro.querySelectorAll("[data-produto-nome]")].map((el) =>
      el.textContent?.trim(),
    );

  it("vindo do card, pede ao servidor só os ativos com estoque baixo e mostra a faixa com a quantidade", async () => {
    await renderizar(true, "estoque-baixo");
    expect(h.loadProducts).toHaveBeenLastCalledWith(
      0,
      12,
      expect.objectContaining({ stock: "low", status: "active" }),
    );
    expect(nomesNaLista()).toEqual(["Produto b", "Produto d"]);
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Mostrando só produtos com estoque baixo · 2",
    );
    expect(h.loadProductsSemCusto).not.toHaveBeenCalled();
  });

  it("'Ver todos' tira o filtro e a faixa, e a lista volta inteira", async () => {
    await renderizar(true, "estoque-baixo");
    await act(async () => botaoVerTodos()!.click());
    await esperar(360);
    const ultimo = h.loadProducts.mock.lastCall![2];
    expect(ultimo?.stock).toBeUndefined();
    expect(ultimo?.status).toBeUndefined();
    expect(faixa()).toBeNull();
    expect(nomesNaLista()).toEqual(["Produto a", "Produto b", "Produto c"]);
  });

  it("a visão abre na página 1 (mesmo com outra lembrada) e 'Ver todos' volta à página de antes", async () => {
    localStorage.setItem("admin_products_current_page", JSON.stringify(2));
    h.loadProducts.mockImplementation(
      async (_pagina: number, _tamanho: number, filtros?: any) => {
        h.pagina = filtros?.stock === "low" ? BAIXOS : TODOS;
        return {
          products: h.pagina,
          total: filtros?.stock === "low" ? 14 : 40,
        };
      },
    );
    await renderizar(false);
    await renderizar(true, "estoque-baixo");
    expect(h.loadProducts.mock.lastCall![0]).toBe(0);
    await act(async () => botaoVerTodos()!.click());
    await esperar(360);
    expect(h.loadProducts.mock.lastCall![0]).toBe(2);
    expect(h.loadProducts.mock.lastCall![2]?.stock).toBeUndefined();
  });

  it.each(["estoque-baixo", "sem-custo"])(
    "consome %s no histórico: voltar da edição preserva a busca, nova escolha abre a visão",
    async (visao) => {
      const estadoAnterior = history.state;
      const urlAnterior = location.href;
      try {
        history.replaceState(
          { view: "admin-products", id: visao, from: "admin-dashboard" },
          "",
          "/admin-products",
        );
        localStorage.setItem(
          "admin_products_search_term",
          JSON.stringify("camiseta"),
        );
        localStorage.setItem(
          "admin_products_filter_category",
          JSON.stringify("Roupas"),
        );
        await renderizar(true, visao);
        const entradaDaLista = history.state;
        expect(entradaDaLista).toEqual({
          view: "admin-products",
          from: "admin-dashboard",
        });
        await act(async () => botaoVerTodos()!.click());
        await esperar(360);
        await renderizar(false, "produto-1");
        // É o id que syncWithUrl lê da entrada ao receber o popstate.
        await renderizar(true, entradaDaLista.id ?? null);
        expect(
          hospedeiro.querySelector("[data-visao-estoque-baixo]"),
        ).toBeNull();
        expect(hospedeiro.querySelector("[data-visao-sem-custo]")).toBeNull();
        expect(h.loadProducts.mock.lastCall![2]).toMatchObject({
          search: "camiseta",
          category: "Roupas",
        });
        await renderizar(false, null);
        history.replaceState(
          { view: "admin-products", id: visao },
          "",
          "/admin-products",
        );
        await renderizar(true, visao);
        expect(
          hospedeiro.querySelector(`[data-visao-${visao}]`),
        ).not.toBeNull();
      } finally {
        history.replaceState(estadoAnterior, "", urlAnterior);
        localStorage.clear();
      }
    },
  );

  // A visão fica montada atrás do Início: a lojista busca um nome DENTRO dela,
  // volta ao Início e toca de novo no card. O destino tem de recomeçar na página
  // 1, sem busca nem categoria, com tudo o que o card anunciou.
  const campoDeBusca = () =>
    hospedeiro.querySelector<HTMLInputElement>('input[name="search-assets"]')!;
  const digitar = (campo: HTMLInputElement, texto: string) =>
    act(async () => {
      const escrever = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      escrever.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  // A busca tem 400 ms de espera para digitar e a lista mais 320 ms: espera a
  // consulta com o texto chegar em vez de apostar num tempo fixo.
  const buscarDentro = async (texto: string) => {
    await digitar(campoDeBusca(), texto);
    for (let i = 0; i < 60; i++) {
      if (h.loadProducts.mock.lastCall?.[2]?.search === texto) break;
      await esperar(100);
    }
    await esperar(50);
  };
  const servidorComBusca = () =>
    h.loadProducts.mockImplementation(
      async (_pagina: number, _tamanho: number, filtros?: any) => {
        const base = filtros?.stock === "low" ? BAIXOS : TODOS;
        const busca = String(filtros?.search ?? "").toLowerCase();
        h.pagina = base.filter((p) => p.name.toLowerCase().includes(busca));
        return { products: h.pagina, total: h.pagina.length };
      },
    );

  it("tocar de novo no card com a visão já aberta limpa a busca feita dentro dela", async () => {
    servidorComBusca();
    await renderizar(true, "estoque-baixo");
    await buscarDentro("Produto d");
    expect(nomesNaLista()).toEqual(["Produto d"]);
    await renderizar(false, null);
    await renderizar(true, "estoque-baixo");
    expect(h.loadProducts.mock.lastCall![2]?.search).toBeUndefined();
    expect(h.loadProducts.mock.lastCall![2]).toMatchObject({ stock: "low" });
    expect(campoDeBusca().value).toBe("");
    expect(nomesNaLista()).toEqual(["Produto b", "Produto d"]);
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Mostrando só produtos com estoque baixo · 2",
    );
  });

  it("tocar de novo no card com a visão já aberta volta à página 1", async () => {
    h.loadProducts.mockImplementation(
      async (_pagina: number, _tamanho: number, filtros?: any) => {
        h.pagina = filtros?.stock === "low" ? BAIXOS : TODOS;
        return {
          products: h.pagina,
          total: filtros?.stock === "low" ? 30 : 40,
        };
      },
    );
    await renderizar(true, "estoque-baixo");
    const proxima = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent?.includes("Próximo"));
    expect(proxima).toBeDefined();
    await act(async () => proxima!.click());
    await esperar(360);
    expect(h.loadProducts.mock.lastCall![0]).toBe(1);
    await renderizar(false, null);
    await renderizar(true, "estoque-baixo");
    expect(h.loadProducts.mock.lastCall![0]).toBe(0);
  });

  it("tocar de novo no card com a visão já aberta tira a categoria escolhida dentro dela", async () => {
    h.categorias = [{ name: "Geral" }];
    h.loadProducts.mockImplementation(
      async (_pagina: number, _tamanho: number, filtros?: any) => {
        const base = filtros?.stock === "low" ? BAIXOS : TODOS;
        h.pagina = filtros?.category ? base.slice(0, 1) : base;
        return { products: h.pagina, total: h.pagina.length };
      },
    );
    await renderizar(true, "estoque-baixo");
    const chip = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    ].find((b) => b.textContent?.includes("Geral"));
    expect(chip).toBeDefined();
    await act(async () => chip!.click());
    await esperar(360);
    expect(h.loadProducts.mock.lastCall![2]).toMatchObject({
      category: "Geral",
    });
    await renderizar(false, null);
    await renderizar(true, "estoque-baixo");
    expect(h.loadProducts.mock.lastCall![2]?.category).toBeUndefined();
    expect(h.loadProducts.mock.lastCall![2]).toMatchObject({ stock: "low" });
    expect(nomesNaLista()).toEqual(["Produto b", "Produto d"]);
  });

  it("enquanto relê no toque repetido, a faixa não afirma a contagem da lista velha", async () => {
    servidorComBusca();
    await renderizar(true, "estoque-baixo");
    await buscarDentro("Produto d");
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Mostrando só produtos com estoque baixo · 1",
    );
    let liberar: () => void = () => {};
    h.loadProducts.mockImplementation(
      () =>
        new Promise((resolve) => {
          liberar = () => {
            h.pagina = BAIXOS;
            resolve({ products: BAIXOS, total: BAIXOS.length });
          };
        }),
    );
    await renderizar(false, null);
    await renderizar(true, "estoque-baixo");
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Procurando os produtos com estoque baixo…",
    );
    await act(async () => liberar());
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Mostrando só produtos com estoque baixo · 2",
    );
  });

  it("com a tela já ativa e a visão intacta, o toque repetido não pede nada nem trava a faixa em 'Procurando'", async () => {
    servidorComBusca();
    await renderizar(true, "estoque-baixo");
    const antes = h.loadProducts.mock.calls.length;
    await renderizar(true, null);
    await renderizar(true, "estoque-baixo");
    await esperar(360);
    expect(h.loadProducts).toHaveBeenCalledTimes(antes);
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Mostrando só produtos com estoque baixo · 2",
    );
  });

  it("leitura de outra página ainda em voo, ao tocar de novo no card, não fecha o 'Procurando' com a lista velha", async () => {
    h.loadProducts.mockImplementation(
      async (_pagina: number, _tamanho: number, filtros?: any) => {
        h.pagina = filtros?.stock === "low" ? BAIXOS : TODOS;
        return {
          products: h.pagina,
          total: filtros?.stock === "low" ? 30 : 40,
        };
      },
    );
    await renderizar(true, "estoque-baixo");
    const proxima = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent?.includes("Próximo"));
    let liberarVelha: () => void = () => {};
    h.loadProducts.mockImplementation(
      () =>
        new Promise((resolve) => {
          liberarVelha = () =>
            resolve({ products: BAIXOS, total: BAIXOS.length });
        }),
    );
    await act(async () => proxima!.click());
    await esperar(360);
    expect(h.loadProducts.mock.lastCall![0]).toBe(1);
    // A leitura da página 2 segue pendente quando a lojista volta pelo card.
    await act(async () => {
      raiz.render(
        <Tela onNavigate={onNavigate} active={false} visaoInicial={null} />,
      );
    });
    await act(async () => {
      raiz.render(
        <Tela onNavigate={onNavigate} active visaoInicial="estoque-baixo" />,
      );
    });
    h.loadProducts.mockImplementation(
      async (_pagina: number, _tamanho: number, filtros?: any) => {
        h.pagina = filtros?.stock === "low" ? BAIXOS : TODOS;
        return { products: h.pagina, total: 30 };
      },
    );
    await act(async () => liberarVelha());
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Procurando os produtos com estoque baixo…",
    );
    await esperar(360);
    expect(h.loadProducts.mock.lastCall![0]).toBe(0);
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Mostrando só produtos com estoque baixo · 30",
    );
  });

  it("o toque repetido não apaga os filtros de antes da visão: 'Ver todos' os devolve", async () => {
    localStorage.setItem(
      "admin_products_search_term",
      JSON.stringify("Produto"),
    );
    localStorage.setItem(
      "admin_products_filter_category",
      JSON.stringify("Geral"),
    );
    servidorComBusca();
    await renderizar(true, "estoque-baixo");
    await buscarDentro("Produto d");
    await renderizar(false, null);
    await renderizar(true, "estoque-baixo");
    await act(async () => botaoVerTodos()!.click());
    await esperar(360);
    expect(h.loadProducts.mock.lastCall![2]).toMatchObject({
      search: "Produto",
      category: "Geral",
    });
    expect(h.loadProducts.mock.lastCall![2]?.stock).toBeUndefined();
  });

  it("o toque repetido pede a lista uma só vez, com a visão intacta ou com busca feita dentro dela", async () => {
    servidorComBusca();
    await renderizar(true, "estoque-baixo");
    const intacta = h.loadProducts.mock.calls.length;
    await renderizar(false, null);
    await renderizar(true, "estoque-baixo");
    await esperar(360);
    expect(h.loadProducts).toHaveBeenCalledTimes(intacta + 1);
    // Visão intacta: nada a refazer, e a faixa não fica em "Procurando…".
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Mostrando só produtos com estoque baixo · 2",
    );
    await buscarDentro("Produto d");
    const comBusca = h.loadProducts.mock.calls.length;
    await renderizar(false, null);
    await renderizar(true, "estoque-baixo");
    await esperar(360);
    expect(h.loadProducts).toHaveBeenCalledTimes(comBusca + 1);
  });

  it("sem pedido (ou com valor qualquer) a lista abre normal, sem filtro", async () => {
    await renderizar(true, null);
    expect(faixa()).toBeNull();
    await renderizar(true, "outra-coisa");
    expect(faixa()).toBeNull();
    expect(h.loadProducts.mock.lastCall![2]?.stock).toBeUndefined();
  });

  it("sem nenhum produto com estoque baixo, a tela não diz 'Nenhum produto cadastrado'", async () => {
    h.loadProducts.mockImplementation(
      async (_pagina: number, _tamanho: number, filtros?: any) => {
        h.pagina = filtros?.stock === "low" ? [] : TODOS;
        return { products: h.pagina, total: h.pagina.length };
      },
    );
    await renderizar(true, "estoque-baixo");
    expect(hospedeiro.textContent).toContain(
      "Nenhum produto com estoque baixo",
    );
    expect(hospedeiro.textContent).not.toContain("Nenhum produto cadastrado");
    expect(botaoVerTodos()).toBeDefined();
  });

  it("pedir a visão 'sem custo' depois troca de visão: sai a faixa de estoque baixo", async () => {
    await renderizar(true, "estoque-baixo");
    expect(faixa()).not.toBeNull();
    await renderizar(true, "sem-custo");
    expect(faixa()).toBeNull();
    expect(hospedeiro.querySelector("[data-visao-sem-custo]")).not.toBeNull();
    expect(h.loadProducts).toHaveBeenCalledTimes(1);
  });
});

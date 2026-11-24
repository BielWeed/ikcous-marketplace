// @vitest-environment jsdom
//
// Caça por mutação: pausar um produto DENTRO das visões "Estoque baixo" e
// "Sem custo" tem de recarregar a lista (o produto pausado sai do filtro dos
// ativos). Tirar essa recarga deixava a suíte verde: o produto pausado ficava
// na faixa "Mostrando só produtos com estoque baixo" como se ainda precisasse
// de reposição. Na lista normal, ao contrário, o pausar NÃO relê nada (o hook
// já atualiza a linha). Também: na visão "Sem custo", uma busca que não acha
// nada diz que é a BUSCA que não achou, e não que todos têm custo.
//
// Monta `AdminProductsView` de verdade (createRoot + act); só os hooks de dados
// são dublados, no molde de inicio-estoque-baixo-abre-produtos-filtrados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  pagina: [] as any[],
  loadProducts: vi.fn(),
  loadProductsSemCusto: vi.fn(),
  toggleProductStatus: vi.fn(),
}));
const onNavigate = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: h.pagina,
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: h.toggleProductStatus,
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

const esperar = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe("Produtos: pausar dentro das visões e busca vazia na visão 'sem custo'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    const armazem = new Map<string, string>([
      ["admin_products_view_mode", "detailed"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    h.pagina = [produto("b", 2)];
    h.toggleProductStatus.mockResolvedValue(true);
    h.loadProducts.mockImplementation(async () => ({
      products: h.pagina,
      total: h.pagina.length,
    }));
    h.loadProductsSemCusto.mockResolvedValue({
      products: [produto("b", 2)],
      total: 1,
    });
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

  async function renderizar(visaoInicial?: string | null) {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductsView
          onNavigate={onNavigate}
          active={true}
          visaoInicial={visaoInicial}
        />,
      );
    });
    await esperar(360);
  }
  const pausar = () =>
    [...hospedeiro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.startsWith("Pausar Produto"),
    )!;

  it("visão 'estoque baixo': pausar um produto relê a lista com o mesmo filtro", async () => {
    await renderizar("estoque-baixo");
    const antes = h.loadProducts.mock.calls.length;
    await act(async () => pausar().click());
    await esperar(50);
    expect(h.toggleProductStatus).toHaveBeenCalledWith("b", true);
    expect(h.loadProducts.mock.calls.length).toBeGreaterThan(antes);
    expect(h.loadProducts.mock.lastCall![2]).toMatchObject({
      stock: "low",
      status: "active",
    });
  });

  it("visão 'sem custo': pausar um produto relê a lista dos sem custo", async () => {
    await renderizar("sem-custo");
    const antes = h.loadProductsSemCusto.mock.calls.length;
    await act(async () => pausar().click());
    await esperar(50);
    expect(h.loadProductsSemCusto.mock.calls.length).toBeGreaterThan(antes);
  });

  it("lista normal: pausar NÃO relê a lista (o hook já atualiza a linha)", async () => {
    await renderizar(null);
    const antes = h.loadProducts.mock.calls.length;
    await act(async () => pausar().click());
    await esperar(50);
    expect(h.toggleProductStatus).toHaveBeenCalledTimes(1);
    expect(h.loadProducts.mock.calls.length).toBe(antes);
  });

  it("visão 'estoque baixo': pausar que FALHA não relê nada", async () => {
    h.toggleProductStatus.mockResolvedValue(false);
    await renderizar("estoque-baixo");
    const antes = h.loadProducts.mock.calls.length;
    await act(async () => pausar().click());
    await esperar(50);
    expect(h.loadProducts.mock.calls.length).toBe(antes);
  });

  it("visão 'sem custo' com busca que não acha: diz que a BUSCA não achou, não que todos têm custo", async () => {
    h.loadProductsSemCusto.mockImplementation(async (filtros?: any) => ({
      products: filtros?.search ? [] : [produto("b", 2)],
      total: filtros?.search ? 0 : 1,
    }));
    await renderizar("sem-custo");
    const campo = hospedeiro.querySelector<HTMLInputElement>(
      'input[name="search-assets"]',
    )!;
    await act(async () => {
      const escrever = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      escrever.call(campo, "xyz");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    for (let i = 0; i < 60; i++) {
      if (h.loadProductsSemCusto.mock.lastCall?.[0]?.search === "xyz") break;
      await esperar(100);
    }
    await esperar(50);
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Nenhum produto sem custo encontrado");
    expect(texto).toContain(
      'Nenhum produto sem custo combina com a busca "xyz".',
    );
    expect(texto).not.toContain(
      "Todos os produtos ativos em estoque têm custo cadastrado.",
    );
  });
});

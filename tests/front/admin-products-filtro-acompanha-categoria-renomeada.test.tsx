// @vitest-environment jsdom
//
// A lista de produtos LEMBRA o filtro de categoria no aparelho
// (`admin_products_filter_category`) e o que ela guarda é o NOME da categoria.
// Quando a lojista renomeia (ou apaga) justamente a categoria que está
// filtrada, o filtro lembrado ficaria com um nome que não existe mais: lista
// vazia e nenhum botão de categoria marcado, sem erro nenhum. É o quinto lugar
// (o primeiro fora do banco) que guarda o nome da categoria.
//
// Também prova que a lista oferece "Gerenciar categorias" e que a tela só é
// baixada quando se clica nela.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadProducts = vi.fn();
const onNavigate = vi.fn();
const rpcMock = vi.fn();

const produtoTeste = {
  id: "prod-1",
  name: "Produto Teste",
  category: "Brinquedo",
  images: [
    "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
  ],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
};

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [produtoTeste],
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 500, totalValue: 900 } },
    fetchExecutiveSummary: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [
      { id: "c1", name: "Brinquedo", slug: "brinquedo", isActive: true },
      { id: "c2", name: "Cama", slug: "cama", isActive: true },
    ],
    addCategory: vi.fn(),
    renameCategory: vi.fn(),
    deleteCategory: vi.fn(),
    setCategoryActive: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
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

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const espera = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
const FILTRO = "admin_products_filter_category";

describe("AdminProductsView — o filtro lembrado acompanha a categoria renomeada ou apagada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    loadProducts.mockResolvedValue({ products: [produtoTeste], total: 1 });
    rpcMock.mockResolvedValue({ data: [], error: null });
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
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
    armazem = new Map<string, string>([[FILTRO, JSON.stringify("Brinquedo")]]);
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
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await espera(400);
    });
  }

  const categoriaDaUltimaBusca = () =>
    loadProducts.mock.calls.at(-1)?.[2]?.category;

  it("começa filtrando pela categoria lembrada", async () => {
    await montar();
    expect(categoriaDaUltimaBusca()).toBe("Brinquedo");
  });

  it("a categoria filtrada foi RENOMEADA: o filtro vira o nome novo, na tela e no aparelho, e a lista é buscada de novo", async () => {
    await montar();
    const { publicarMudancaDeCategoria } = await import(
      "@/lib/avisos-de-categoria"
    );
    await act(async () => {
      publicarMudancaDeCategoria({
        tipo: "renomeada",
        de: "brinquedo ", // a régua é a da vitrine: maiúscula e espaço nas pontas não contam
        para: "Brinquedos",
      });
    });
    await act(async () => {
      await espera(500); // a lista espera 320 ms antes de buscar
    });
    expect(JSON.parse(armazem.get(FILTRO) ?? "null")).toBe("Brinquedos");
    expect(categoriaDaUltimaBusca()).toBe("Brinquedos");
  });

  it("a categoria filtrada foi APAGADA: o filtro volta para 'todas'", async () => {
    await montar();
    const { publicarMudancaDeCategoria } = await import(
      "@/lib/avisos-de-categoria"
    );
    await act(async () => {
      publicarMudancaDeCategoria({ tipo: "apagada", nome: "Brinquedo" });
    });
    await act(async () => {
      await espera(500); // a lista espera 320 ms antes de buscar
    });
    expect(JSON.parse(armazem.get(FILTRO) ?? "null")).toBe("all");
    expect(categoriaDaUltimaBusca()).toBeUndefined();
  });

  it("OUTRA categoria foi renomeada: o filtro fica como está, mas a lista é buscada de novo (os produtos trocaram de nome)", async () => {
    await montar();
    const antes = loadProducts.mock.calls.length;
    const { publicarMudancaDeCategoria } = await import(
      "@/lib/avisos-de-categoria"
    );
    await act(async () => {
      publicarMudancaDeCategoria({
        tipo: "renomeada",
        de: "Cama",
        para: "Cama e Banho",
      });
      await espera(50);
    });
    expect(JSON.parse(armazem.get(FILTRO) ?? "null")).toBe("Brinquedo");
    expect(loadProducts.mock.calls.length).toBeGreaterThan(antes);
    expect(categoriaDaUltimaBusca()).toBe("Brinquedo");
  });

  it("a lista tem o botão 'Gerenciar categorias', e a tela só é carregada e aberta quando se clica nele", async () => {
    await montar();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(
      /Renomeie, esconda da vitrine/,
    );
    const botao = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Gerenciar categorias"),
    ) as HTMLButtonElement | undefined;
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
      await espera(100);
    });
    expect(rpcMock).toHaveBeenCalledWith("categorias_com_uso");
    expect(document.body.textContent).toMatch(/Renomeie, esconda da vitrine/);
  });
});

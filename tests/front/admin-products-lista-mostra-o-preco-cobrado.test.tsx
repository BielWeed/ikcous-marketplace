// @vitest-environment jsdom
//
// Painel, lista de Produtos: o preço do cartão é o que a cliente PAGA. Caso do
// defeito: base 69,90 e todo tamanho com preço próprio de 89,90 -- a lista
// dizia R$ 69,90 (o `product.price` cru) enquanto a loja cobrava 89,90. Com
// tamanhos a preços diferentes, o cartão mostra a faixa "R$ menor – R$ maior".
// A regra em si é testada em preco-cobrado-na-lista.test.ts; aqui a prova é que
// os TRÊS lugares da lista (cartão da grade, cartão detalhado e o cabeçalho do
// menu de ações) leem por ela.
//
// Montagem real (createRoot + act), mesmo molde de produtos-detalhado-preco-
// alto-nao-invade-o-estoque.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteProduct = vi.fn();
const addProduct = vi.fn();
const loadProducts = vi.fn();
const toggleProductStatus = vi.fn();
const onNavigate = vi.fn();
const fetchExecutiveSummary = vi.fn();

let produtosMock: any[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtosMock,
    loading: false,
    deleteProduct,
    toggleProductStatus,
    addProduct,
    loadProducts,
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 300, totalValue: 690.5 } },
    fetchExecutiveSummary,
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

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function classesDe(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

function textoDe(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

const tamanho = (value: string, priceOverride?: number, active = true) => ({
  id: `var-${value}`,
  productId: "prod-1",
  name: "Tamanho",
  value,
  stockIncrement: 4,
  active,
  priceOverride,
});

describe("Produtos: a lista mostra o preço que a loja cobra", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    loadProducts.mockImplementation(async () => ({
      products: produtosMock,
      total: 1,
    }));
    fetchExecutiveSummary.mockResolvedValue(null);

    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(
    modo: "compact" | "detailed",
    variants: ReturnType<typeof tamanho>[],
    extra: Record<string, unknown> = {},
  ) {
    armazem.set("admin_products_view_mode", modo);
    produtosMock = [
      {
        id: "prod-1",
        name: "Vestido midi",
        category: "Vestidos",
        images: [],
        isActive: true,
        stock: 12,
        price: 69.9,
        costPrice: 30,
        estoqueMinimo: null,
        variants,
        ...extra,
      },
    ];
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function precoDaGrade(): HTMLElement {
    const el = hospedeiro.querySelector<HTMLElement>("p.text-xl.tabular-nums");
    if (!el) throw new Error("Preço do cartão da grade não apareceu.");
    return el;
  }

  function precoDoDetalhado(): HTMLElement {
    const rotulo = [...hospedeiro.querySelectorAll(".produto-resumo p")].find(
      (p) => p.textContent?.trim() === "Preço de Venda",
    );
    if (!rotulo) throw new Error("Rótulo 'Preço de Venda' não está no cartão.");
    return rotulo.nextElementSibling as HTMLElement;
  }

  function cabecalhoDoMenu(): string {
    const linha = [...hospedeiro.querySelectorAll("p")].find((p) =>
      / · \d+ em estoque$/.test(p.textContent ?? ""),
    );
    if (!linha) throw new Error("Cabeçalho do menu de ações não apareceu.");
    return textoDe(linha);
  }

  it("grade: todo tamanho a 89,90 sobre base 69,90 → R$ 89,90 no cartão e no menu", async () => {
    await montar("compact", [
      tamanho("P", 89.9),
      tamanho("M", 89.9),
      tamanho("G", 89.9),
    ]);

    expect(textoDe(precoDaGrade())).toBe("R$ 89,90");
    expect(cabecalhoDoMenu()).toMatch(/^R\$ 89,90 · /);
  });

  it("grade: preços diferentes → faixa", async () => {
    await montar("compact", [tamanho("P"), tamanho("G", 89.9)]);

    expect(textoDe(precoDaGrade())).toBe("R$ 69,90 – R$ 89,90");
    expect(cabecalhoDoMenu()).toMatch(/^R\$ 69,90 – R\$ 89,90 · /);
  });

  it("detalhado: todo tamanho a 89,90 → R$ 89,90, numa linha como antes", async () => {
    await montar("detailed", [tamanho("P", 89.9), tamanho("G", 89.9)]);

    const valor = precoDoDetalhado();
    expect(textoDe(valor)).toBe("R$ 89,90");
    expect(classesDe(valor)).toContain("whitespace-nowrap");
  });

  it("detalhado: a faixa pode quebrar (coluna de 1/3 do cartão a 320 px)", async () => {
    await montar("detailed", [tamanho("P"), tamanho("G", 89.9)]);

    const valor = precoDoDetalhado();
    expect(textoDe(valor)).toBe("R$ 69,90 – R$ 89,90");
    expect(classesDe(valor)).not.toContain("whitespace-nowrap");
    expect(classesDe(valor)).toContain("break-words");
  });

  it("variação inativa não muda o preço", async () => {
    await montar("compact", [tamanho("P", 89.9), tamanho("G", 150, false)]);
    expect(textoDe(precoDaGrade())).toBe("R$ 89,90");
  });

  it("controle: sem variações, o preço base de sempre (e a promoção não troca o número)", async () => {
    await montar("compact", [], { originalPrice: 99.9 });

    expect(textoDe(precoDaGrade())).toBe("R$ 69,90");
    expect(cabecalhoDoMenu()).toMatch(/^R\$ 69,90 · /);
  });
});

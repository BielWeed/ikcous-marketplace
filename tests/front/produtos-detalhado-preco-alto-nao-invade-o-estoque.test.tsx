// @vitest-environment jsdom
//
// Painel, Produtos no modo DETALHADO: o resumo do cartão é uma grade de 3
// colunas (Preço de Venda, Estoque, Margem). O preço usava `whitespace-nowrap`
// SEMPRE, e o teto de preço da loja é R$ 9.999.999,99: no celular, "R$
// 1.234.567,89" numa linha só é mais largo que a coluna e se sobrepunha ao
// Estoque. Dinheiro não se corta (nada de `truncate`/`text-ellipsis`): o preço
// alto agora pode quebrar (depois do "R$", e dentro do número só se ainda
// não couber), com a letra fixa em `text-sm`.
//
// O jsdom não mede layout, então a prova é sobre as classes do elemento do
// preço, sem fingir que mede pixel. O controle é o preço comum: continua numa
// linha só, com a letra que cresce nas telas largas (produtos-detalhado-nao-
// esconde-o-preco.test.tsx, bloco "i").
//
// Montagem real (createRoot + act), mesmo molde de produtos-detalhado-nao-
// esconde-o-preco.
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

describe("Produtos, modo detalhado: preço muito alto não invade a coluna do estoque", () => {
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
    armazem = new Map<string, string>([
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

  async function montarComPreco(price: number) {
    produtosMock = [
      {
        id: "prod-1",
        name: "Conjunto de joias",
        category: "Joias",
        images: [],
        isActive: true,
        stock: 12,
        price,
        costPrice: 10,
        estoqueMinimo: null,
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

  function valorDoPreco(): HTMLElement {
    const rotulo = [...hospedeiro.querySelectorAll(".produto-resumo p")].find(
      (p) => p.textContent?.trim() === "Preço de Venda",
    );
    if (!rotulo) throw new Error("Rótulo 'Preço de Venda' não está no cartão.");
    return rotulo.nextElementSibling as HTMLElement;
  }

  function textoDe(el: Element): string {
    return (el.textContent ?? "").replace(/\s/g, " ");
  }

  it("teto de preço (R$ 9.999.999,99): o valor aparece inteiro e PODE quebrar, sem whitespace-nowrap", async () => {
    await montarComPreco(9999999.99);

    const valor = valorDoPreco();
    expect(textoDe(valor)).toBe("R$ 9.999.999,99");
    const classes = classesDe(valor);
    expect(classes).not.toContain("whitespace-nowrap");
    expect(classes).toContain("break-words");
    // Dinheiro não se corta: nada de reticências nem de recorte.
    expect(classes).not.toContain("truncate");
    expect(classes).not.toContain("text-ellipsis");
    expect(classes).not.toContain("overflow-hidden");
    // A letra não cresce com a largura da tela: a coluna é 1/3 do cartão.
    expect(classes).toContain("text-sm");
    expect(classes.some((c) => /^min-\[\d+px\]:text-/.test(c))).toBe(false);
  });

  it("R$ 1.234.567,89 (o exemplo do defeito) também deixa de ser nowrap", async () => {
    await montarComPreco(1234567.89);

    const valor = valorDoPreco();
    expect(textoDe(valor)).toBe("R$ 1.234.567,89");
    expect(classesDe(valor)).not.toContain("whitespace-nowrap");
    expect(classesDe(valor)).toContain("break-words");
  });

  it("a coluna do preço continua min-w-0 e o Estoque segue na coluna ao lado", async () => {
    await montarComPreco(9999999.99);

    const coluna = valorDoPreco().parentElement as HTMLElement;
    expect(classesDe(coluna)).toContain("min-w-0");
    const estoque = coluna.nextElementSibling as HTMLElement;
    expect(estoque.textContent).toContain("12");
    expect(classesDe(estoque)).toContain("min-w-0");
  });

  it("controle: preço de até R$ 99.999,99 segue numa linha só e com a letra que cresce", async () => {
    await montarComPreco(99999.99);

    const valor = valorDoPreco();
    expect(textoDe(valor)).toBe("R$ 99.999,99");
    const classes = classesDe(valor);
    expect(classes).toContain("whitespace-nowrap");
    expect(classes).not.toContain("break-words");
    expect(classes).toContain("text-sm");
    expect(classes).toContain("min-[360px]:text-base");
    expect(classes).toContain("min-[400px]:text-lg");
  });

  it("controle: R$ 100.000,00 é a primeira faixa que pode quebrar", async () => {
    await montarComPreco(100000);

    expect(classesDe(valorDoPreco())).not.toContain("whitespace-nowrap");
  });
});

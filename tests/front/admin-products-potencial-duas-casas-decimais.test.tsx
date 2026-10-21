// @vitest-environment jsdom
//
// Achado 14 da auditoria de 20/08/2026
// (docs/auditoria/2026-08-20-painel-pedidos-produtos.md): no cartão
// detalhado do produto, "Lucro bruto do estoque" era o único valor em dinheiro
// formatado com `minimumFractionDigits: 0` — os vizinhos ("Preço de
// Venda", "Capital Alocado") usam 2. O resultado era "R$ 37,2", que não é
// um jeito válido de escrever dinheiro em português.
//
// Monta `AdminProductsView` de verdade, mesmo padrão de
// admin-products-margem-sem-custo.test.tsx — reaproveitado aqui porque já
// resolveu os mesmos obstáculos de montar esta tela. A visualização padrão
// é "compact" (não mostra "Lucro bruto do estoque"); o teste pré-carrega
// `admin_products_view_mode = "detailed"` no dublê de `localStorage` para
// cair direto no cartão detalhado, que é onde o achado 14 vive.
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
let custoDoResumo = 500;

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtosMock,
    loading: false,
    deleteProduct,
    toggleProductStatus,
    addProduct,
    loadProducts,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: {
      inventory: {
        totalCost: custoDoResumo,
        totalValue: 900,
        totalRevenue: 900,
        revenueWithoutCost: 0,
        productsWithoutCost: 0,
        productsWithCost: 1,
      },
    },
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
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
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
  AlertDialogCancel: ({
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
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em address-form-cep-race.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function montarProduto(overrides: Record<string, unknown>) {
  produtosMock = [
    {
      id: "prod-1",
      name: "Produto de Teste",
      category: "Geral",
      images: [
        "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
      ],
      isActive: true,
      stock: 20,
      price: 100,
      ...overrides,
    },
  ];
}

describe("AdminProductsView — achado 14: 'Potencial' sempre com duas casas decimais", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    custoDoResumo = 500;
    loadProducts.mockResolvedValue({ products: produtosMock, total: 1 });
    fetchExecutiveSummary.mockResolvedValue(null);
    addProduct.mockResolvedValue(undefined);
    toggleProductStatus.mockResolvedValue(true);

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

  async function montar() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );

    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    const abrir = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-controls="metricas-produto-prod-1"]',
    );
    expect(abrir).not.toBeNull();
    await act(async () => abrir?.click());
  }

  function cartaoDoProduto(): HTMLElement {
    const cartao = hospedeiro.querySelector(
      ".content-visibility-detailed-card",
    );
    if (!cartao)
      throw new Error("Cartão detalhado do produto não está na tela.");
    return cartao as HTMLElement;
  }

  function lerValorPeloRotulo(rotulo: string): string | null {
    const elementoRotulo = [
      ...cartaoDoProduto().querySelectorAll("span, p"),
    ].find((el) => el.textContent === rotulo);
    const valor = elementoRotulo?.nextElementSibling;
    return valor?.textContent ?? null;
  }

  it.each([
    { price: 150, costPrice: 100, cor: "text-emerald-400" },
    { price: 50, costPrice: 100, cor: "text-red-400" },
    { price: 100, costPrice: 100, cor: "text-zinc-400" },
  ])(
    "margem, retorno e lucro seguem o sinal: $cor",
    async ({ price, costPrice, cor }) => {
      montarProduto({ price, costPrice, stock: 2 });
      await montar();
      for (const seletor of ["[data-margem]", "[data-lucro-sobre-custo]"]) {
        expect(
          cartaoDoProduto().querySelector(seletor)?.classList.contains(cor),
        ).toBe(true);
      }
      const rotulo = [...cartaoDoProduto().querySelectorAll("p")].find(
        (el) => el.textContent === "Lucro bruto do estoque",
      );
      expect(rotulo?.nextElementSibling?.classList.contains(cor)).toBe(true);
    },
  );

  it.each([
    { custo: 500, cor: "text-emerald-400" },
    { custo: 1000, cor: "text-red-400" },
    { custo: 900, cor: "text-zinc-400" },
  ])(
    "KPI de lucro colore o número, não o ícone: $cor",
    async ({ custo, cor }) => {
      custoDoResumo = custo;
      montarProduto({ price: 100, costPrice: 20, stock: 2 });
      await montar();
      const resumo = hospedeiro.querySelector(
        '[role="group"][aria-label="Lucro bruto potencial"]',
      )!;
      expect
        .soft(resumo.querySelector("h3")?.classList.contains(cor))
        .toBe(true);
      expect
        .soft(resumo.querySelector("svg")?.classList.contains("text-zinc-400"))
        .toBe(true);
      const expandir = [...hospedeiro.querySelectorAll("button")].find((el) =>
        el.textContent?.includes("Expandir"),
      )!;
      await act(async () => expandir.click());
      const expandido = hospedeiro.querySelector(
        'article[aria-label="Lucro bruto potencial"]',
      )!;
      expect
        .soft(expandido.querySelector("h3")?.classList.contains(cor))
        .toBe(true);
      expect
        .soft(
          expandido.querySelector("svg")?.classList.contains("text-zinc-400"),
        )
        .toBe(true);
    },
  );

  it("simulador usa cor no resultado e risco, sem bloco colorido", async () => {
    montarProduto({ price: 100, costPrice: 20, stock: 2 });
    await montar();
    const guia = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Guia e simulador"]',
    )!;
    await act(async () => guia.click());
    const simulador = [...document.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === "Simulador",
    )!;
    await act(async () => simulador.click());
    const dialogo = document.querySelector('[role="dialog"]')!;
    expect(dialogo).not.toBeNull();
    expect.soft(dialogo.querySelector('[class*="rose-"]')).toBeNull();
    const rotulo = [...dialogo.querySelectorAll("p")].find(
      (el) => el.textContent === "Lucro bruto do lote simulado",
    )!;
    expect
      .soft(rotulo.nextElementSibling?.classList.contains("text-emerald-400"))
      .toBe(true);
    expect
      .soft(
        dialogo.querySelector(
          'div[class*="bg-red-"], div[class*="bg-emerald-"], div[class*="bg-amber-"], div[class*="bg-teal-"]',
        ),
      )
      .toBeNull();
    const preco = document.getElementById("sim-price") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(preco, "5");
      preco.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect
      .soft(rotulo.nextElementSibling?.classList.contains("text-red-400"))
      .toBe(true);
    expect.soft(dialogo.querySelector('[class*="rose-"]')).toBeNull();
    expect
      .soft(
        dialogo.querySelector(
          'div[class*="bg-red-"], div[class*="bg-emerald-"], div[class*="bg-amber-"], div[class*="bg-teal-"]',
        ),
      )
      .toBeNull();
  });

  it("estoque crítico é âmbar sem pintar um bloco", async () => {
    montarProduto({ price: 100, costPrice: 20, stock: 2, estoqueMinimo: 3 });
    await montar();
    const critico = [...cartaoDoProduto().querySelectorAll("span")].find(
      (el) => el.textContent === "Crítico",
    );
    expect(critico?.classList.contains("text-amber-400")).toBe(true);
    expect(cartaoDoProduto().querySelector('[class*="orange-"]')).toBeNull();
  });

  it("valor com centavos que 'sobram' (37,2 do relatório): mostra 'R$ 37,20', nunca 'R$ 37,2'", async () => {
    // totalProfit = price*stock - costPrice*stock = 137.2*1 - 100*1 = 37.2
    montarProduto({ price: 137.2, stock: 1, costPrice: 100 });

    await montar();

    const potencialTexto = lerValorPeloRotulo("Lucro bruto do estoque");
    expect(potencialTexto).toBe("+ R$ 37,20");
  });

  it("lucro do produto usa preço de cada variante ativa, inclusive zero e herança do pai", async () => {
    montarProduto({
      price: 100,
      stock: 5,
      costPrice: 20,
      variants: [
        { id: "v1", active: true, stockIncrement: 2, priceOverride: 60 },
        { id: "v2", active: true, stockIncrement: 2, priceOverride: 0 },
        { id: "v3", active: true, stockIncrement: 1 },
        {
          id: "ignorada",
          active: false,
          stockIncrement: 100,
          priceOverride: 999,
        },
      ],
    });
    await montar();
    // Receita220 − custo100 =120; preço pai×estoque inventaria lucro400.
    expect(lerValorPeloRotulo("Lucro bruto do estoque")).toBe("+ R$ 120,00");
    expect(cartaoDoProduto().querySelector("[data-margem]")?.textContent).toBe(
      "54,5%",
    );
    expect(
      cartaoDoProduto().querySelector("[data-lucro-sobre-custo]")?.textContent,
    ).toBe("120,0%");
  });

  it("prejuízo da variante não recebe um sinal de mais enganoso", async () => {
    montarProduto({
      price: 100,
      stock: 1,
      costPrice: 20,
      variants: [
        { id: "v1", active: true, stockIncrement: 1, priceOverride: 10 },
      ],
    });
    await montar();
    expect(lerValorPeloRotulo("Lucro bruto do estoque")).toBe("R$ -10,00");
  });

  it.each([
    { priceOverride: 0, margem: "—" },
    { priceOverride: 0.05, margem: "0,0%" },
  ])(
    "custo suspeito preserva margem indefinida e zero medido: $margem",
    async ({ priceOverride, margem }) => {
      montarProduto({
        price: 100,
        stock: 10,
        costPrice: 0.05,
        variants: [
          { id: "v1", active: true, stockIncrement: 10, priceOverride },
        ],
      });
      await montar();
      expect(
        cartaoDoProduto().querySelector("[data-custo-suspeito] [data-margem]")
          ?.textContent,
      ).toBe(margem);
    },
  );

  it("sem variantes ativas, lucro do produto volta ao preço e estoque do pai", async () => {
    montarProduto({
      price: 100,
      stock: 3,
      costPrice: 20,
      variants: [
        {
          id: "pausada",
          active: false,
          stockIncrement: 100,
          priceOverride: 999,
        },
      ],
    });
    await montar();
    expect(lerValorPeloRotulo("Lucro bruto do estoque")).toBe("+ R$ 240,00");
  });

  it("valor redondo (sem centavos): mostra 'R$ 100,00', não 'R$ 100' — as duas casas são OBRIGATÓRIAS, como nos vizinhos", async () => {
    // totalProfit = 15*20 - 10*20 = 100
    montarProduto({ price: 15, stock: 20, costPrice: 10 });

    await montar();

    const potencialTexto = lerValorPeloRotulo("Lucro bruto do estoque");
    expect(potencialTexto).toBe("+ R$ 100,00");
  });
});

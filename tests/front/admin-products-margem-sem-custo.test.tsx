// @vitest-environment jsdom
//
// Achado 8 da auditoria de 20/08/2026
// (docs/auditoria/2026-08-20-painel-pedidos-produtos.md): a conta de margem e
// ROI do cartão detalhado de produto usava `costPrice || 0` — "sem custo
// cadastrado" virava "custo é zero", e custo zero produzia margem de 100%
// (o melhor número do painel) junto com ROI de 0% no MESMO cartão. A
// etiqueta "Custo Suspeito" também pulava exatamente esse caso, porque a
// condição exigia `costPrice > 0`.
//
// A correção separa os dois estados com `hasCost`: sem custo cadastrado
// (`costPrice` ausente OU zero) a tela para de afirmar um número que
// ninguém mediu e mostra "—" — mesmo precedente de
// AdminCustomersView.tsx:249-250 ("Ticket Médio"). Com custo real (> 0) a
// conta continua BYTE A BYTE a mesma de antes.
//
// Monta `AdminProductsView` de verdade (sem @testing-library: createRoot +
// act do React puro), mesmo padrão de
// admin-products-kpi-apos-mexer-no-catalogo.test.tsx — reaproveitado aqui
// porque já resolveu os mesmos obstáculos de montar esta tela (Radix sem
// PointerEvent, IntersectionObserver/ResizeObserver/matchMedia ausentes no
// jsdom). A visualização padrão é "compact" (não mostra margem/ROI); os
// testes pré-carregam `admin_products_view_mode = "detailed"` no dublê de
// `localStorage` para cair direto no cartão detalhado, que é onde o achado
// 8 vive.
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

// Mutado por cada teste antes de montar — é o que o mock de `useProducts`
// abaixo devolve.
let produtosMock: any[] = [];

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
    stats: { inventory: { totalCost: 500, totalValue: 900 } },
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

// jsdom não implementa IntersectionObserver -- LazyImage (usado pelo card de
// produto) cria um a cada montagem.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom não implementa ResizeObserver -- embla-carousel-react (usado por
// AdminKpiCarousel) cria um a cada montagem.
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

describe("AdminProductsView — achado 8: produto sem custo não afirma margem/ROI falsos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
    // Mesmo padrão de admin-products-kpi-apos-mexer-no-catalogo.test.tsx: um
    // Map de verdade, pré-carregado com "detailed" — a visualização padrão
    // real é "compact" (AdminProductsView.tsx:169-172) e não mostra
    // margem/ROI/etiqueta nenhuma; o achado 8 vive só no cartão detalhado.
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
  }

  /** Raiz do cartão detalhado de UM produto — classe exclusiva
   * (`content-visibility-detailed-card`, AdminProductsView.tsx:1462).
   * Necessário para escopar as buscas abaixo: o rótulo "Capital Alocado"
   * também existe no dicionário do modal de ajuda global (~linha 920),
   * sempre presente no DOM mesmo fechado (Radix Dialog sem `forceMount`
   * ainda assim renderizou o conteúdo neste jsdom) — sem escopo, `find()`
   * pegava esse rótulo primeiro e devolvia `null` (o parágrafo de
   * explicação ao lado dele não é o valor que este teste quer). */
  function cartaoDoProduto(): HTMLElement {
    const cartao = hospedeiro.querySelector(
      ".content-visibility-detailed-card",
    );
    if (!cartao)
      throw new Error("Cartão detalhado do produto não está na tela.");
    return cartao as HTMLElement;
  }

  /** Os spans de margem e ROI compartilham a mesma combinação de classes,
   * exclusiva do cartão detalhado (AdminProductsView.tsx:~1569/~1596) —
   * ordem de aparição no DOM é margem primeiro, ROI depois, pela ordem do
   * JSX. */
  function lerMargemERoi() {
    const spans = [
      ...cartaoDoProduto().querySelectorAll(
        "span.text-lg.font-black.tracking-tighter",
      ),
    ];
    expect(spans).toHaveLength(2);
    return {
      margemTexto: spans[0].textContent,
      roiTexto: spans[1].textContent,
    };
  }

  /** Acha o valor pelo RÓTULO vizinho ("Capital Alocado" / "Potencial"),
   * escopado ao cartão do produto — em vez de por classe Tailwind com
   * barra (`text-white/80`), que exigiria escapar "/" no seletor CSS. */
  function lerValorPeloRotulo(rotulo: string): string | null {
    const elementoRotulo = [
      ...cartaoDoProduto().querySelectorAll("span, p"),
    ].find((el) => el.textContent === rotulo);
    const valor = elementoRotulo?.nextElementSibling;
    return valor?.textContent ?? null;
  }

  function lerCapitalEPotencial() {
    return {
      capitalTexto: lerValorPeloRotulo("Capital Alocado"),
      potencialTexto: lerValorPeloRotulo("Potencial"),
    };
  }

  it("custo AUSENTE (costPrice indefinido): não afirma 100,0% nem 100.0% em lugar nenhum, mostra '—'", async () => {
    montarProduto({ price: 100, stock: 10 });
    // biome-ignore lint/performance/noDelete: o cenario deste teste e a propriedade AUSENTE, nao presente-com-undefined. Trocar por `= undefined` deixaria a chave existindo e testaria outro caso — o proprio nome do teste diz "costPrice indefinido".
    delete produtosMock[0].costPrice;

    await montar();

    const { margemTexto, roiTexto } = lerMargemERoi();
    expect(margemTexto).toBe("—");
    expect(roiTexto).toBe("—");
    expect(hospedeiro.textContent).not.toContain("100,0%");
    expect(hospedeiro.textContent).not.toContain("100.0%");

    const { capitalTexto, potencialTexto } = lerCapitalEPotencial();
    expect(capitalTexto).toBe("—");
    expect(potencialTexto).toBe("—");
  });

  it("custo AUSENTE: mostra a etiqueta de aviso", async () => {
    montarProduto({ price: 100, stock: 10 });
    // biome-ignore lint/performance/noDelete: o cenario deste teste e a propriedade AUSENTE, nao presente-com-undefined. Trocar por `= undefined` deixaria a chave existindo e testaria outro caso — o proprio nome do teste diz "costPrice indefinido".
    delete produtosMock[0].costPrice;

    await montar();

    expect(hospedeiro.textContent).toContain("Sem Custo Cadastrado");
  });

  it("custo ZERO (costPrice: 0): não afirma 100,0% nem 100.0%, mostra '—'", async () => {
    montarProduto({ price: 100, stock: 10, costPrice: 0 });

    await montar();

    const { margemTexto, roiTexto } = lerMargemERoi();
    expect(margemTexto).toBe("—");
    expect(roiTexto).toBe("—");
    expect(hospedeiro.textContent).not.toContain("100,0%");
    expect(hospedeiro.textContent).not.toContain("100.0%");

    const { capitalTexto, potencialTexto } = lerCapitalEPotencial();
    expect(capitalTexto).toBe("—");
    expect(potencialTexto).toBe("—");
  });

  it("custo ZERO: mostra a etiqueta de aviso", async () => {
    montarProduto({ price: 100, stock: 10, costPrice: 0 });

    await montar();

    expect(hospedeiro.textContent).toContain("Sem Custo Cadastrado");
  });

  it("caso-limite (regressão): custo NORMAL continua com os números de sempre, sem etiqueta de aviso", async () => {
    montarProduto({ price: 15, stock: 20, costPrice: 10 });

    await montar();

    const { margemTexto, roiTexto } = lerMargemERoi();
    // margin = (15-10)/15*100 = 33.333...% ; roi = (15-10)/10*100 = 50%
    expect(margemTexto).toBe("33.3%");
    expect(roiTexto).toBe("50.0%");

    const { capitalTexto, potencialTexto } = lerCapitalEPotencial();
    // invested = 10 * 20 = 200 ; totalProfit = 15*20 - 200 = 100
    expect(capitalTexto).toBe("R$ 200,00");
    expect(potencialTexto).toBe("+ R$ 100");

    expect(hospedeiro.textContent).not.toContain("Sem Custo Cadastrado");
    expect(hospedeiro.textContent).not.toContain("Custo Suspeito");
  });

  it("custo na faixa suspeita (0,05): etiqueta continua aparecendo, como hoje", async () => {
    montarProduto({ price: 10, stock: 5, costPrice: 0.05 });

    await montar();

    expect(hospedeiro.textContent).toContain("Custo Suspeito");
    expect(hospedeiro.textContent).not.toContain("Sem Custo Cadastrado");

    // Custo > 0 aqui: a conta roda normalmente, não vira "—".
    const { margemTexto, roiTexto } = lerMargemERoi();
    expect(margemTexto).not.toBe("—");
    expect(roiTexto).not.toBe("—");
  });
});

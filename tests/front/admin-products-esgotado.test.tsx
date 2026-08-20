// @vitest-environment jsdom
//
// Achado 9 da auditoria de 20/08/2026
// (docs/auditoria/2026-08-20-painel-pedidos-produtos.md): a etiqueta de
// status do cartão de produto só olhava `product.isActive` — um produto
// ativo com estoque zero (medido: 6 no banco em 20/08/2026) aparecia com a
// etiqueta verde "Em Operação", e na visualização compacta (a padrão) não
// havia mais nenhum sinal de que o produto acabou além do número "00" em
// vermelho. O resto do sistema já usa a palavra "Esgotado" para esse mesmo
// estado — a loja (ProductCard.tsx, PremiumOffers.tsx) e o simulador de
// celular embutido NESTA MESMA tela (PhoneSimulator.tsx). A correção
// reutiliza essa palavra nos dois cartões do painel (compacto e detalhado),
// com precedência: inativo vence tudo ("Offline"), depois esgotado
// ("Esgotado"), depois "Em Operação".
//
// Monta `AdminProductsView` de verdade (sem @testing-library: createRoot +
// act do React puro), mesmo padrão de
// admin-products-margem-sem-custo.test.tsx — reaproveitado aqui porque já
// resolveu os mesmos obstáculos de montar esta tela (Radix sem
// PointerEvent, IntersectionObserver/ResizeObserver/matchMedia ausentes no
// jsdom).
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
// usado em admin-products-margem-sem-custo.test.tsx.
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

const rotulosDeStatus = ["Em Operação", "Offline", "Esgotado"];

describe.each(["compact", "detailed"] as const)(
  "AdminProductsView (%s) — achado 9: etiqueta de status olha o estoque",
  (viewMode) => {
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
      // Um Map de verdade, pré-carregado com o viewMode do describe.each
      // atual — a visualização padrão real é "compact"
      // (AdminProductsView.tsx:169-172), então só pré-carrega a chave
      // quando o cenário é "detailed".
      const armazem = new Map<string, string>(
        viewMode === "detailed"
          ? [["admin_products_view_mode", "detailed"]]
          : [],
      );
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
        raiz.render(
          <AdminProductsView onNavigate={onNavigate} active={true} />,
        );
      });
      await act(async () => {
        await esperarMicrotarefas();
      });
    }

    /** Raiz do cartão do produto — classe exclusiva de cada modo de
     * visualização (`content-visibility-detailed-card` ou
     * `content-visibility-compact-card`, AdminProductsView.tsx). */
    function cartaoDoProduto(): HTMLElement {
      const classe =
        viewMode === "detailed"
          ? ".content-visibility-detailed-card"
          : ".content-visibility-compact-card";
      const cartao = hospedeiro.querySelector(classe);
      if (!cartao) throw new Error("Cartão do produto não está na tela.");
      return cartao as HTMLElement;
    }

    /** A etiqueta de status é o único `Badge` (`[data-slot="badge"]`) cujo
     * texto é exatamente um dos três rótulos de status — distingue da
     * etiqueta "Crítico" (estoque baixo) e "Sem Custo Cadastrado"/"Custo
     * Suspeito", que só existem no cartão detalhado. */
    function lerEtiquetaDeStatus(): string | null {
      const badges = [
        ...cartaoDoProduto().querySelectorAll('[data-slot="badge"]'),
      ];
      const badge = badges.find((el) =>
        rotulosDeStatus.includes(el.textContent ?? ""),
      );
      return badge?.textContent ?? null;
    }

    it("produto ATIVO com estoque 0: mostra 'Esgotado', não 'Em Operação'", async () => {
      montarProduto({ isActive: true, stock: 0 });

      await montar();

      expect(lerEtiquetaDeStatus()).toBe("Esgotado");
    });

    it("produto ATIVO com estoque > 0 (regressão): continua 'Em Operação'", async () => {
      montarProduto({ isActive: true, stock: 20 });

      await montar();

      expect(lerEtiquetaDeStatus()).toBe("Em Operação");
    });

    it("produto INATIVO com estoque 0 (precedência): continua 'Offline', não 'Esgotado'", async () => {
      montarProduto({ isActive: false, stock: 0 });

      await montar();

      expect(lerEtiquetaDeStatus()).toBe("Offline");
    });
  },
);

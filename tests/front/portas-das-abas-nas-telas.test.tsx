// @vitest-environment jsdom
//
// Painel simples, tarefas C1-C3: cada tela de aba mostra SÓ as suas portas,
// desenhadas pelo AtalhosDaAba (nomes e rotas de NOMES_DO_PAINEL/
// PORTAS_DO_PAINEL), no lugar dos três cartões antigos de dashboard/:
//   - Produtos: Cupons (a porta do Frete foi para Ajustes);
//   - Pedidos:  Devoluções (Perguntas e Avaliações saíram, vivem em Clientes);
//   - Clientes: "Perguntas e avaliações" -> admin-qa e "Avisar clientes" ->
//               admin-push (some "Canais de Atendimento").
//
// O teste mede a PORTA, não o texto de enfeite: monta a tela de verdade, clica
// em cada atalho da faixa de portas e olha o destino chamado.
//
// A faixa de portas é lida pelos botões `min-h-11` com ícone que o
// AtalhosDaAba desenha (alvo de toque de 44px).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOMES_DO_PAINEL } from "../../src/config/nomes-do-painel";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts: vi.fn().mockResolvedValue({ products: [], total: 0 }),
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: null,
    fetchExecutiveSummary: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    totalOrders: 0,
    isLoaded: true,
    loading: false,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    pedidosCancelados: [],
    fetchPedidosCancelados: vi.fn(async () => []),
    pedidosCanceladosIncompleto: false,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => {
      const builder: any = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => builder);
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      builder.then = (resolve: any, reject?: any) =>
        Promise.resolve({ data: [], count: 0, error: null }).then(
          resolve,
          reject,
        );
      return builder;
    }),
    rpc: vi.fn(() =>
      Promise.resolve({
        data: {
          data: [],
          total_count: 0,
          stats: {
            total_customers: 0,
            global_ltv: 0,
            global_orders: 0,
            new_customers_30d: 0,
          },
        },
        error: null,
      }),
    ),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
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
  }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("as telas de aba mostram só as suas portas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
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

  async function montar(ui: ReactNode) {
    await act(async () => {
      raiz.render(ui);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  /** As portas: os botões `min-h-11` com chevron que o AtalhosDaAba desenha. */
  function portas(): HTMLButtonElement[] {
    return Array.from(hospedeiro.querySelectorAll("button")).filter(
      (b) => b.className.includes("min-h-11") && b.querySelector("svg"),
    ) as HTMLButtonElement[];
  }

  function nomesDasPortas(): string[] {
    return portas().map((b) => b.textContent?.trim() ?? "");
  }

  /** Clica em cada porta e devolve o destino de cada clique, na ordem. */
  function destinosDeCadaPorta(onNavigate: ReturnType<typeof vi.fn>) {
    const destinos: unknown[] = [];
    for (const porta of portas()) {
      onNavigate.mockClear();
      act(() => {
        porta.click();
      });
      destinos.push(onNavigate.mock.calls[0]?.[0]);
    }
    return destinos;
  }

  it("Produtos: só 'Cupons' -> admin-coupons, e o título é o de NOMES_DO_PAINEL", async () => {
    const onNavigate = vi.fn();
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await montar(<AdminProductsView onNavigate={onNavigate} active={true} />);

    expect(hospedeiro.querySelector("h1")?.textContent).toContain(
      NOMES_DO_PAINEL["admin-products"],
    );
    expect(nomesDasPortas()).toEqual(["Cupons"]);
    expect(destinosDeCadaPorta(onNavigate)).toEqual(["admin-coupons"]);
    // a porta do Frete saiu de Produtos (mora em Ajustes)
    expect(hospedeiro.textContent).not.toContain("Entrega e frete");
  });

  it("Pedidos: só 'Devoluções' -> admin-devolucoes; Perguntas e Avaliações não estão aqui", async () => {
    const onNavigate = vi.fn();
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await montar(<AdminOrdersView onNavigate={onNavigate} active={true} />);

    expect(hospedeiro.querySelector("h1")?.textContent).toContain(
      NOMES_DO_PAINEL["admin-orders"],
    );
    expect(nomesDasPortas()).toEqual(["Devoluções"]);
    expect(destinosDeCadaPorta(onNavigate)).toEqual(["admin-devolucoes"]);
    const todosOsBotoes = Array.from(hospedeiro.querySelectorAll("button"));
    for (const b of todosOsBotoes) {
      onNavigate.mockClear();
      expect(b.textContent?.trim()).not.toBe("Perguntas");
      expect(b.textContent?.trim()).not.toBe("Avaliações");
    }
  });

  it("Clientes: 'Perguntas e avaliações' -> admin-qa e 'Avisar clientes' -> admin-push; nenhuma porta para admin-whatsapp-config", async () => {
    const onNavigate = vi.fn();
    const { AdminCustomersView } = await import(
      "@/views/admin/AdminCustomersView"
    );
    await montar(<AdminCustomersView onNavigate={onNavigate} active={true} />);

    expect(hospedeiro.querySelector("h1")?.textContent).toContain(
      NOMES_DO_PAINEL["admin-customers"],
    );
    expect(nomesDasPortas()).toEqual([
      "Perguntas e avaliações",
      "Avisar clientes",
    ]);
    const destinos = destinosDeCadaPorta(onNavigate);
    expect(destinos).toEqual(["admin-qa", "admin-push"]);
    expect(destinos).not.toContain("admin-whatsapp-config");
    expect(hospedeiro.textContent).not.toContain("Canais de Atendimento");
  });
});

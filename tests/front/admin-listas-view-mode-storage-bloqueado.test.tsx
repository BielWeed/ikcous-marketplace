// @vitest-environment jsdom
//
// Pedidos, Clientes e Produtos lembram se a lojista prefere a lista "detalhada"
// ou "compacta" (admin_orders_view_mode, admin_customers_view_mode,
// admin_products_view_mode). Ler e gravar isso ficava solto no render e num
// efeito de montagem: com o armazenamento do navegador cheio (QuotaExceeded)
// ou bloqueado (SecurityError) a exceção subia até o quadro de erro e a lista
// inteira caía só por causa de uma preferência de aparência.
//
// Regras travadas aqui: (1) storage quebrado nunca derruba a tela; (2) quem já
// tem "detailed"/"compact" CRU salvo (o formato de sempre destas três chaves)
// continua com a escolha dele.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Referências ESTÁVEIS: um `vi.fn()` ou `[]` criado dentro da fábrica do hook
// nasceria de novo a cada render, mudaria as dependências dos efeitos da tela
// e a montagem entraria em laço (estourou 4 GB de memória na 1ª versão).
const estavel = vi.hoisted(() => ({
  semLista: [] as never[],
  loadOrders: vi.fn(),
  updateOrderStatus: vi.fn(),
  loadProducts: vi.fn(async () => ({ products: [], total: 0 })),
  deleteProduct: vi.fn(),
  toggleProductStatus: vi.fn(),
  addProduct: vi.fn(),
  addCategory: vi.fn(),
  fetchExecutiveSummary: vi.fn(async () => null),
  anular: vi.fn(),
  pedirRecarga: vi.fn(),
  recarregar: vi.fn(),
  prefetch: vi.fn(),
  stats: { deliveredTotal: 1 },
  porPedido: {},
}));

const clientes = [
  {
    id: "a1",
    email: "a1@teste.com",
    full_name: "Paulo Lima",
    phone: null,
    role: "customer",
    created_at: "2026-08-01T00:00:00Z",
    orders_count: 1,
    total_spent: 10,
    last_order_date: null,
  },
];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          data: clientes,
          total_count: 1,
          stats: {
            total_customers: 1,
            global_ltv: 10,
            global_orders: 1,
            new_customers_30d: 0,
          },
        },
        error: null,
      }),
    from: () => ({
      select: () => {
        const resposta = Promise.resolve({ data: [], error: null });
        return Object.assign(resposta, {
          in: () => resposta,
          eq: () => resposta,
          order: () => resposta,
        });
      },
    }),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: estavel.semLista,
    totalOrders: 0,
    isLoaded: true,
    loading: false,
    erroDaListagem: null,
    loadOrders: estavel.loadOrders,
    updateOrderStatus: estavel.updateOrderStatus,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: estavel.semLista,
    loading: false,
    deleteProduct: estavel.deleteProduct,
    toggleProductStatus: estavel.toggleProductStatus,
    addProduct: estavel.addProduct,
    loadProducts: estavel.loadProducts,
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: estavel.semLista,
    addCategory: estavel.addCategory,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: estavel.stats,
    fetchExecutiveSummary: estavel.fetchExecutiveSummary,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useAnularVendaDoBalcao", () => ({
  useAnularVendaDoBalcao: () => ({ anular: estavel.anular }),
}));
vi.mock("@/hooks/useNumerosDosPedidos", () => ({
  useNumerosDosPedidos: () => ({
    paraPreparar: 0,
    aguardandoPagamento: 0,
    aCaminho: 0,
    abertosComPagamentoAConferir: 0,
    pedirRecarga: estavel.pedirRecarga,
  }),
}));
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));
vi.mock("@/hooks/useEstornosEmCursoDosPedidos", () => ({
  useEstornosEmCursoDosPedidos: () => ({
    porPedido: estavel.porPedido,
    recarregar: estavel.recarregar,
  }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: estavel.prefetch,
    prefetchAll: estavel.prefetch,
    prefetchViewPromise: estavel.prefetch,
    prefetchImage: estavel.prefetch,
  }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    warning: vi.fn(),
  },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

type Tela = "pedidos" | "clientes" | "produtos";

const TELAS: ReadonlyArray<{ tela: Tela; chave: string }> = [
  { tela: "pedidos", chave: "admin_orders_view_mode" },
  { tela: "clientes", chave: "admin_customers_view_mode" },
  { tela: "produtos", chave: "admin_products_view_mode" },
];

describe("Listas do painel — preferência de modo com armazenamento quebrado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    // Erro de render sem quadro de erro vira ruído no console do teste.
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  async function montar(tela: Tela) {
    const elemento =
      tela === "pedidos"
        ? await import("@/views/admin/AdminOrdersView").then((m) => (
            <m.AdminOrdersView active={false} onNavigate={vi.fn()} />
          ))
        : tela === "clientes"
          ? await import("@/views/admin/AdminCustomersView").then((m) => (
              <m.AdminCustomersView active={true} onNavigate={vi.fn()} />
            ))
          : await import("@/views/admin/AdminProductsView").then((m) => (
              <m.AdminProductsView active={true} onNavigate={vi.fn()} />
            ));
    await act(async () => {
      raiz.render(elemento);
    });
    await act(async () => {
      await esperar(0);
    });
  }

  it.each(TELAS)(
    "$tela: armazenamento BLOQUEADO (getItem lança) abre a lista em vez de cair",
    async ({ tela }) => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new DOMException("bloqueado", "SecurityError");
        },
        setItem: () => {
          throw new DOMException("bloqueado", "SecurityError");
        },
        removeItem: () => {},
      });
      await expect(montar(tela)).resolves.toBeUndefined();
      expect(hospedeiro.childElementCount).toBeGreaterThan(0);
    },
  );

  it.each(TELAS)(
    "$tela: armazenamento CHEIO (setItem lança) abre a lista em vez de cair",
    async ({ tela }) => {
      vi.stubGlobal("localStorage", {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("cheio", "QuotaExceededError");
        },
        removeItem: () => {},
      });
      await expect(montar(tela)).resolves.toBeUndefined();
      expect(hospedeiro.childElementCount).toBeGreaterThan(0);
    },
  );

  it.each(TELAS)(
    "$tela: o valor CRU 'detailed' que a lojista já tinha salvo continua valendo e é regravado igual",
    async ({ tela, chave }) => {
      const armazem = new Map<string, string>([[chave, "detailed"]]);
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => armazem.get(k) ?? null,
        setItem: (k: string, v: string) => armazem.set(k, v),
        removeItem: (k: string) => armazem.delete(k),
      });
      await montar(tela);
      expect(armazem.get(chave)).toBe("detailed");
    },
  );
});

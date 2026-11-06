// @vitest-environment jsdom
// Com uma única conta, a linha de status da tela de Clientes dizia
// "1 contas no app". No singular é "1 conta no app".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Customer } from "@/utils/admin_cache";
import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const unica: Customer = {
  id: "c-1",
  full_name: "Maria Souza",
  email: "c-1@example.com",
  phone: null,
  role: "customer",
  created_at: "2026-10-01T12:00:00Z",
  orders_count: 1,
  total_spent: 50,
};

function resposta(totalDeContas: number) {
  return {
    data: {
      data: [unica],
      total_count: 1,
      stats: {
        total_customers: totalDeContas,
        global_ltv: 50,
        global_orders: 1,
        new_customers_30d: 0,
      },
    },
    error: null,
  };
}

let AdminCustomersView: typeof TipoClientes;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
}, 60_000);

describe("Clientes — a contagem de contas concorda com o número", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function abrirTela() {
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
  }

  it("uma conta: '1 conta no app'", async () => {
    rpc.mockResolvedValue(resposta(1));
    await abrirTela();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("1 conta no app · Sincronizado");
    expect(texto).not.toContain("1 contas");
  });

  it("várias contas: segue no plural", async () => {
    rpc.mockResolvedValue(resposta(24));
    await abrirTela();
    expect(hospedeiro.textContent).toContain("24 contas no app · Sincronizado");
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isLeader: false,
  user: { id: "admin-canal-teste" },
  session: { user: { id: "admin-canal-teste" } },
  fetchExecutiveSummary: vi.fn().mockResolvedValue(undefined),
  fetchCategoryAnalytics: vi.fn().mockResolvedValue(undefined),
  handlers: [] as Array<() => void>,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, session: h.session, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: h.isLeader }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: vi.fn(),
  useAnalytics: () => ({
    fetchExecutiveSummary: h.fetchExecutiveSummary,
    fetchCategoryAnalytics: h.fetchCategoryAnalytics,
    stats: null,
    categoryData: null,
    error: null,
    categoryError: null,
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: () => {
      const canal = {
        on: (_tipo: string, _filtro: unknown, handler: () => void) => {
          h.handlers.push(handler);
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: vi.fn().mockResolvedValue(undefined),
  },
}));

// @ts-expect-error flag de teste do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  h.handlers = [];
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each([false, true])("aba líder: %s", (lider) => {
  beforeEach(() => {
    h.isLeader = lider;
  });

  it.each(["ausente", "bloqueado"])(
    "pedidos montam e desmontam com canal %s",
    async (situacao) => {
      prepararCanal(situacao);
      const { useOrders } = await import("@/hooks/useOrders");
      function Pedidos() {
        useOrders(true, true);
        return <span>Pedidos abertos</span>;
      }
      await act(async () => raiz.render(<Pedidos />));
      expect(hospedeiro.textContent).toBe("Pedidos abertos");
      await act(async () => raiz.unmount());
      expect(hospedeiro.textContent).toBe("");
    },
  );

  it.each(["ausente", "bloqueado"])(
    "CRM monta, recebe evento e desmonta com canal %s",
    async (situacao) => {
      prepararCanal(situacao);
      const { useDashboardClassico } = await import("@/hooks/useCrm");
      const atualizar = vi.fn();
      function Crm() {
        useDashboardClassico(true, atualizar);
        return <span>CRM aberto</span>;
      }
      await act(async () => raiz.render(<Crm />));
      expect(hospedeiro.textContent).toBe("CRM aberto");
      if (lider) {
        expect(h.handlers.length).toBeGreaterThan(0);
        await act(async () => {
          h.handlers[0]();
          await vi.advanceTimersByTimeAsync(1500);
        });
        expect(atualizar).toHaveBeenCalledOnce();
      }
      await act(async () => raiz.unmount());
      expect(hospedeiro.textContent).toBe("");
    },
  );
});

function prepararCanal(situacao: string) {
  vi.stubGlobal("BroadcastChannel", undefined);
  if (situacao === "ausente") {
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
  } else {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new DOMException("Canal bloqueado", "SecurityError");
        }
      },
    );
  }
}

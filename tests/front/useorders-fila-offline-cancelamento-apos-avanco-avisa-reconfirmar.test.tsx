// @vitest-environment jsdom
import { useOrders } from "@/hooks/useOrders";
import type { OrderStatus } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { rpc, single } = vi.hoisted(() => ({ rpc: vi.fn(), single: vi.fn() }));
const lojista = { id: "lojista-1" };
const idPedido = "pedido-1";
const chaveDaFila = "orders_offline_updates_queue:lojista-1";
const avisoReconfirmar = "Abra o pedido e confirme o cancelamento novamente";
const avisoGenerico =
  "Fila de pedidos atualizada. Algumas alterações não se aplicam mais ao estado atual dos pedidos.";
let statusNoServidor: OrderStatus;
let raiz: Root;
let host: HTMLDivElement;
let online: boolean;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: lojista } } }),
    },
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
    channel: () => ({ on: vi.fn(), subscribe: vi.fn() }),
    removeChannel: vi.fn().mockResolvedValue("ok"),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: lojista, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "fila"),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

// @ts-expect-error Flag interna do React usada nos testes com act.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const armazenamento = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazenamento.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazenamento.set(chave, valor),
    removeItem: (chave: string) => armazenamento.delete(chave),
    clear: () => armazenamento.clear(),
  });
  statusNoServidor = "pending";
  const data = new Date().toISOString();
  rpc.mockImplementation((nome: string) => {
    if (nome !== "get_admin_orders_paged") {
      return Promise.resolve({ data: null, error: null });
    }
    return {
      abortSignal: async () => ({
        data: {
          data: [
            {
              id: idPedido,
              status: statusNoServidor,
              payment_method: "cash",
              created_at: data,
              updated_at: data,
            },
          ],
          total_count: 1,
        },
        error: null,
      }),
    };
  });
  single.mockImplementation(async () => ({
    data: { status: statusNoServidor },
    error: null,
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  localStorage.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function montarPainelComAvancoOffline() {
  let painel!: ReturnType<typeof useOrders>;
  function Sonda() {
    const hook = useOrders(true, true);
    useEffect(() => {
      painel = hook;
    });
    return null;
  }

  await act(async () => {
    raiz.render(<Sonda />);
  });
  await act(async () => {
    await painel.loadOrders();
  });
  expect(painel.orders[0]?.status).toBe("pending");

  online = false;
  await act(async () => {
    await painel.updateOrderStatus(idPedido, "processing");
  });
  expect(painel.orders[0]?.status).toBe("processing");
  return () => painel;
}

async function reconectar() {
  online = true;
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1000);
  });
  // O painel pode reler a lista por RPC, mas não pode gravar nenhuma mudança.
  expect(
    rpc.mock.calls.filter(([nome]) => nome !== "get_admin_orders_paged"),
  ).toEqual([]);
  expect(single).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(chaveDaFila)).toBeNull();
  expect(toast.error).not.toHaveBeenCalled();
}

it("pede nova confirmação ao descartar um cancelamento feito após avanço offline", async () => {
  const painel = await montarPainelComAvancoOffline();
  await act(async () => {
    await painel().updateOrderStatus(
      idPedido,
      "cancelled",
      undefined,
      false,
      "processing",
    );
  });
  expect(JSON.parse(localStorage.getItem(chaveDaFila) ?? "[]")).toEqual([
    expect.objectContaining({
      orderId: idPedido,
      status: "cancelled",
      statusEsperado: "processing",
    }),
  ]);

  await reconectar();

  expect(toast.info).toHaveBeenLastCalledWith(
    expect.stringContaining(avisoReconfirmar),
    { id: "fila" },
  );
});

it("mantém o aviso genérico ao descartar só o avanço de um pedido cancelado no servidor", async () => {
  await montarPainelComAvancoOffline();
  statusNoServidor = "cancelled";

  await reconectar();

  expect(toast.info).toHaveBeenLastCalledWith(avisoGenerico, { id: "fila" });
});

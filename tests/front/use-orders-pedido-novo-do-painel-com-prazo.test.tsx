// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOrders } from "@/hooks/useOrders";

const rede = vi.hoisted(() => ({
  consultarPedido: vi.fn(),
  consultarLista: vi.fn(),
  receber: undefined as ((evento: unknown) => Promise<void>) | undefined,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, parametros: unknown) => {
      if (nome !== "get_admin_orders_paged") return Promise.resolve({});
      return { abortSignal: () => rede.consultarLista(parametros) };
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: rede.consultarPedido }) }),
    }),
    channel: () => ({
      on: (
        _tipo: string,
        _filtro: unknown,
        receber: (evento: unknown) => Promise<void>,
      ) => {
        rede.receber = receber;
      },
      subscribe: () => {},
    }),
    removeChannel: () => Promise.resolve(),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-teste" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const linha = {
  id: "pedido-teste-1",
  user_id: "cliente-teste",
  canal: "online",
  status: "pending",
  payment_status: "aguardando",
  customer_data: {},
  items: [],
  created_at: "2026-11-19T12:00:00.000Z",
};
const evento = { eventType: "INSERT", new: linha, old: {} };

describe("pedido novo no painel", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  let painel: ReturnType<typeof useOrders>;
  const avisar = vi.fn();

  function Sonda() {
    const pedidos = useOrders(true, true, { onRealtimeEvent: avisar });
    useEffect(() => {
      painel = pedidos;
    });
    return null;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("BroadcastChannel", undefined);
    avisar.mockClear();
    rede.receber = undefined;
    rede.consultarPedido.mockReset();
    rede.consultarLista
      .mockReset()
      .mockResolvedValueOnce({
        data: { data: [], total_count: 0 },
        error: null,
      })
      .mockResolvedValue({
        data: { data: [linha], total_count: 1 },
        error: null,
      });

    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await painel.loadOrders(0, 12, "open");
    });
    expect(painel.orders).toEqual([]);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      await vi.advanceTimersByTimeAsync(4_000);
    });
    host.remove();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("avisa no prazo e recupera uma única linha mesmo com a consulta do pedido pendurada", async () => {
    rede.consultarPedido.mockReturnValue(new Promise(() => {}));
    expect(rede.receber).toBeTypeOf("function");

    await act(async () => {
      void rede.receber?.(evento);
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(avisar).not.toHaveBeenCalled();
    expect(painel.orders).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(avisar).toHaveBeenCalledExactlyOnceWith(evento);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(painel.orders.map((pedido) => pedido.id)).toEqual([linha.id]);
    expect(painel.totalOrders).toBe(1);
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(rede.consultarLista).toHaveBeenLastCalledWith(
      expect.objectContaining({ p_page: 0, p_page_size: 12, p_status: "open" }),
    );
  });

  it("insere uma linha e avisa uma vez quando a consulta responde normalmente", async () => {
    rede.consultarPedido.mockResolvedValue({ data: linha, error: null });
    expect(rede.receber).toBeTypeOf("function");

    await act(async () => {
      await rede.receber?.(evento);
      await vi.advanceTimersByTimeAsync(20_500);
    });

    expect(painel.orders.map((pedido) => pedido.id)).toEqual([linha.id]);
    expect(painel.totalOrders).toBe(1);
    expect(avisar).toHaveBeenCalledExactlyOnceWith(evento);
    expect(rede.consultarLista).toHaveBeenCalledTimes(1);
  });
});

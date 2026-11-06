// @vitest-environment jsdom
//
// Cancelar um pedido de pagar-na-entrega (dinheiro, PIX/cartão na entrega)
// vai pela RPC `update_order_status_atomic`, não pela edge do pagamento
// online. Esse caminho dizia "Status atualizado com sucesso" mesmo quando o
// clique era "Cancelar pedido": quem cancela quer ler "Pedido cancelado.",
// a mesma frase do caminho online. As demais mudanças de status seguem com
// o texto de sempre.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const rpcMock = vi.hoisted(() => vi.fn());
const toasts = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
}));
const exposto = vi.hoisted(() => ({
  updateOrderStatus: null as null | ((...args: unknown[]) => Promise<unknown>),
}));

function pedidoNaEntrega(status: Order["status"]): Order {
  return {
    id: "pedido-1",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status,
    paymentStatus: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
  };
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-1" }, isAdmin: false }),
}));

import { useOrders } from "@/hooks/useOrders";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Alvo() {
  const hook = useOrders(false, false);
  useEffect(() => {
    exposto.updateOrderStatus = hook.updateOrderStatus as unknown as (
      ...args: unknown[]
    ) => Promise<unknown>;
  });
  return null;
}

describe("useOrders.updateOrderStatus — texto do aviso de sucesso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    for (const t of Object.values(toasts)) t.mockClear();
    const armazenamento = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazenamento.get(chave) ?? null,
      setItem: (chave: string, valor: string) =>
        armazenamento.set(chave, valor),
      removeItem: (chave: string) => armazenamento.delete(chave),
      clear: () => armazenamento.clear(),
    });
    // Pedido semeado e CONHECIDO: pedido que a tela não tem em memória
    // cancelaria pela edge, não pela RPC.
    localStorage.setItem(
      "ikcous_orders_cache_cliente-1",
      JSON.stringify([pedidoNaEntrega("pending")]),
    );
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Alvo />);
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cliente cancela pagar-na-entrega: a RPC é chamada e o aviso diz 'Pedido cancelado.'", async () => {
    await act(async () => {
      await exposto.updateOrderStatus!("pedido-1", "cancelled");
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "update_order_status_atomic",
      expect.objectContaining({
        p_order_id: "pedido-1",
        p_new_status: "cancelled",
      }),
    );
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledWith("Pedido cancelado.");
    expect(toasts.success).not.toHaveBeenCalledWith(
      "Status atualizado com sucesso",
    );
  });

  it("silencioso (silent = true): nenhum aviso de sucesso, nem o novo", async () => {
    await act(async () => {
      await exposto.updateOrderStatus!(
        "pedido-1",
        "cancelled",
        undefined,
        true,
      );
    });

    expect(rpcMock).toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("a RPC recusa o cancelamento: NÃO diz 'Pedido cancelado.' (nada foi cancelado)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Transição de status não permitida." },
    });

    await act(async () => {
      await exposto.updateOrderStatus!("pedido-1", "cancelled").catch(() => {});
    });

    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalled();
  });
});

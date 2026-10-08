// @vitest-environment jsdom
//
// Ressalva da revisão do lote do número do pedido (04/10/2026), item 1: o
// aviso "Novo pedido recebido!" que o realtime de `useOrders` mostra quando
// NINGUÉM assinou `onRealtimeEvent` (o ramo de cliente, fora do painel) usava
// os 8 PRIMEIROS caracteres do id ("#c35ce4dd") — o resto do app mostra os 6
// ÚLTIMOS, em maiúsculas ("#3884BE", `numeroDoPedido`). O cliente via dois
// nomes para o mesmo pedido.
//
// Mock no molde de use-orders-cancelados-insert-recarrega-com-debounce: o
// handler REAL do canal (`channel.on("postgres_changes", ...)`) é capturado e
// recebe o INSERT; o SELECT pontual devolve o pedido do próprio cliente.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ID_DO_PEDIDO = "c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";

let mockRealtimeOnHandler: ((payload: unknown) => unknown) | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: vi.fn(),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: {
                id: ID_DO_PEDIDO,
                user_id: "cliente-1",
                status: "pending",
                customer_name: "Cliente Teste",
                created_at: new Date(0).toISOString(),
                updated_at: new Date(0).toISOString(),
              },
              error: null,
            }),
        }),
      }),
    }),
    channel: () => ({
      on: (
        _evento: string,
        _filtro: unknown,
        handler: (payload: unknown) => unknown,
      ) => {
        mockRealtimeOnHandler = handler;
        return { subscribe: () => ({}) };
      },
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-1" }, isAdmin: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;

describe("useOrders (cliente) — o aviso de pedido novo usa o número que a loja mostra", () => {
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
    vi.mocked(toast.info).mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("INSERT do próprio pedido: o toast diz '#3884BE' (6 últimos, maiúsculas), nunca '#c35ce4dd'", async () => {
    const { useOrders } = await import("@/hooks/useOrders");

    function Sonda() {
      // Sem `onRealtimeEvent`: é o ramo que mostra o toast.
      useOrders(true, false);
      return null;
    }

    await act(async () => {
      raiz.render(<Sonda />);
    });
    expect(mockRealtimeOnHandler).toBeTruthy();

    await act(async () => {
      await mockRealtimeOnHandler!({
        eventType: "INSERT",
        new: { id: ID_DO_PEDIDO },
      });
    });

    expect(toast.info).toHaveBeenCalledTimes(1);
    const mensagem = String(vi.mocked(toast.info).mock.calls[0][0]);
    expect(mensagem).toBe("Novo pedido recebido! #3884BE");
    expect(mensagem).not.toContain("c35ce4dd");
  });
});

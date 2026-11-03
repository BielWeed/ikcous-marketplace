// @vitest-environment jsdom
//
// Caça 02/11, achado a2: o canal realtime dos pedidos do cliente é COMPARTILHADO
// (`globalOrderSubscriptions`) e cada tela que chama `useOrders` (Carrinho,
// Perfil...) registra o seu callback nele. Um único INSERT chamava todos, e
// cada instância sem `onRealtimeEvent` mostrava o seu "Novo pedido recebido!":
// o cliente que acabou de pedir via o mesmo aviso duas vezes. A saída é um aviso
// com id estável por pedido — o sonner funde os repetidos num só.
//
// Mock no molde de use-orders-toast-de-pedido-novo-usa-o-numero-da-loja.
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
        // O canal é compartilhado: só a primeira instância o cria, então este
        // handler é guardado uma vez e chama o callback de TODAS.
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

describe("useOrders (cliente) — o aviso de pedido novo não se repete entre telas", () => {
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
    mockRealtimeOnHandler = null;
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

  it("duas telas com useOrders no mesmo canal: um INSERT gera avisos com o MESMO id (o sonner funde)", async () => {
    const { useOrders } = await import("@/hooks/useOrders");

    function Sonda() {
      useOrders(true, false);
      return null;
    }

    await act(async () => {
      raiz.render(
        <>
          <Sonda />
          <Sonda />
        </>,
      );
    });
    expect(mockRealtimeOnHandler).toBeTruthy();

    await act(async () => {
      await mockRealtimeOnHandler!({
        eventType: "INSERT",
        new: { id: ID_DO_PEDIDO },
      });
    });

    const chamadas = vi.mocked(toast.info).mock.calls;
    expect(chamadas.length).toBeGreaterThanOrEqual(1);
    const ids = chamadas.map(
      ([, opcoes]) => (opcoes as { id?: string } | undefined)?.id,
    );
    expect(ids[0]).toBe(`pedido-novo-${ID_DO_PEDIDO}`);
    expect(new Set(ids).size).toBe(1);
  });
});

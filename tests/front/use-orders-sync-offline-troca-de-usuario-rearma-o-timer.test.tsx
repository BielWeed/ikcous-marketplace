// @vitest-environment jsdom
//
// A troca de user?.id re-executa o efeito "online" de useOrders: é a
// retentativa da fila offline ao autenticar. Desde que o desmonte cancela o
// timer de 1 s (7637052f), esta re-execução tem de fazer três coisas ao mesmo
// tempo — e é isto que este teste trava (pedido do dono, 04/10/2026):
//   1. cancelar o timer da execução ANTIGA (sem clearTimeout, a fila era lida
//      duas vezes);
//   2. armar e RODAR o timer da execução NOVA (sem rearmar, a retentativa ao
//      autenticar some);
//   3. processar a fila exatamente UMA vez, sem remontar o componente.
// Caso escrito e provado com mutantes pela revisão Opus de front (aced) do
// 7637052f.
//
// Mesma sonda dos outros testes de useOrders (este projeto não tem
// @testing-library/react).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ id: "cliente-1" }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: [], error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
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
  useAuth: () => ({ user: { id: auth.id }, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_DA_FILA = "orders_offline_updates_queue";

let host: HTMLDivElement;
let raiz: Root;
let getItem: ReturnType<typeof vi.fn>;

function leituraDaFila(): number {
  return getItem.mock.calls.filter(([chave]) => chave === CHAVE_DA_FILA).length;
}

// A MESMA função de componente nas duas renderizações: trocar a função
// remontaria o componente e o teste deixaria de provar a re-execução por
// dependência (o contador de montagens confere isso).
let montagens = 0;
let SondaFixa: (() => null) | null = null;
async function renderizar(): Promise<void> {
  if (!SondaFixa) {
    const { useOrders } = await import("@/hooks/useOrders");
    SondaFixa = function Sonda() {
      useOrders(false, false);
      useEffect(() => {
        montagens++;
      }, []);
      return null;
    };
  }
  const Sonda = SondaFixa;
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

describe("useOrders: troca de user?.id com o timer da fila offline pendente", () => {
  beforeEach(() => {
    auth.id = "cliente-1";
    montagens = 0;
    vi.useFakeTimers();
    getItem = vi.fn(() => null);
    vi.stubGlobal("localStorage", {
      getItem,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    host.remove();
  });

  it("cancela o timer antigo, arma o novo e lê a fila exatamente 1 vez", async () => {
    await renderizar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(leituraDaFila()).toBe(0);

    auth.id = "cliente-2";
    await renderizar();

    // t=1000: o timer da execução antiga venceria aqui — tem de ter sido cancelado.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(leituraDaFila()).toBe(0);

    // t=1500: o timer da execução nova (armado em t=500) roda a retentativa.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(leituraDaFila()).toBe(1);

    // Nada mais roda depois: a fila não é processada em dobro.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(leituraDaFila()).toBe(1);
    expect(montagens).toBe(1);
  });
});

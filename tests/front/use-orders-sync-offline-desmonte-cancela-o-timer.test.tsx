// @vitest-environment jsdom
//
// O timer de 1 s que religa a sincronização da fila offline (useOrders, efeito
// "online") não era cancelado quando o hook desmontava. Quem pagava: o
// `processarFilaOfflineDePedidos` rodava DEPOIS do desmonte e lia
// `localStorage` de um ambiente já desmontado — na suíte, depois do teardown
// do jsdom (`localStorage` ausente ou o do Node, sem `getItem`), o que virava
// "Unhandled Rejection: localStorage.getItem is not a function" e
// reprovava `npm run test:front` com 792/792 arquivos verdes (04/10/2026).
// O desmonte agora cancela o timer pendente.
//
// Mesma sonda dos outros testes de useOrders (este projeto não tem
// @testing-library/react).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  useAuth: () => ({ user: { id: "cliente-1" }, isAdmin: false }),
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

async function montar(): Promise<void> {
  const { useOrders } = await import("@/hooks/useOrders");
  function Sonda() {
    useOrders(false, false);
    useEffect(() => {});
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

describe("useOrders — o timer da sincronização offline não sobrevive ao desmonte", () => {
  beforeEach(() => {
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    host.remove();
  });

  it("controle: montado e online, a fila é lida depois de 1 s (a sincronização continua existindo)", async () => {
    await montar();
    expect(leituraDaFila()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(leituraDaFila()).toBeGreaterThanOrEqual(1);
    act(() => {
      raiz.unmount();
    });
  });

  it("desmontar antes de 1 s cancela a leitura da fila: nada roda depois do desmonte", async () => {
    await montar();
    act(() => {
      raiz.unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(leituraDaFila()).toBe(0);
  });

  it("o evento 'online' que armou um timer novo também é cancelado pelo desmonte", async () => {
    await montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const antes = leituraDaFila();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    act(() => {
      raiz.unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(leituraDaFila()).toBe(antes);
  });
});

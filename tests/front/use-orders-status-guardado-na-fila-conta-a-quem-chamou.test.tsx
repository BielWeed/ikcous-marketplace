// @vitest-environment jsdom
//
// `updateOrderStatus` lê `navigator.onLine` NA HORA e, sem rede, guarda a
// mudança na fila offline em vez de gravar. Quem chama (a ficha do pedido,
// `AdminOrdersView.handleStatusChange`) decidia se mandava o aviso à cliente
// pelo `isOffline` capturado no render — que pode ser de antes de a internet
// cair (a pergunta "Cancelar o pedido?" fica aberta enquanto a rede some).
// Agora a função CONTA que guardou na fila, e a ficha decide pelo que
// aconteceu de verdade: a fila é quem avisa a cliente quando sincronizar.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderStatus } from "@/types";

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: [], error: null }),
          single: () =>
            Promise.resolve({ data: { status: "processing" }, error: null }),
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
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;

async function montarPainel() {
  const { useOrders } = await import("@/hooks/useOrders");
  let atualizar: ReturnType<typeof useOrders>["updateOrderStatus"] | null =
    null;
  function Sonda() {
    const { updateOrderStatus } = useOrders(true, true);
    useEffect(() => {
      atualizar = updateOrderStatus;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  return (status: OrderStatus, statusEsperado: OrderStatus) =>
    act(async () =>
      atualizar?.("pedido-1", status, undefined, false, statusEsperado),
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
  armazem = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
  });
  vi.stubGlobal("navigator", { ...navigator, onLine: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe("useOrders.updateOrderStatus — conta a quem chamou que a mudança foi para a fila", () => {
  it("sem rede: guarda na fila e devolve 'guardado-na-fila'", async () => {
    const atualizar = await montarPainel();
    vi.stubGlobal("navigator", { ...navigator, onLine: false });

    const resultado = await atualizar("shipping", "processing");

    expect(resultado).toBe("guardado-na-fila");
    expect(armazem.get("orders_offline_updates_queue:lojista-1")).toContain(
      '"status":"shipping"',
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "avancar_status_do_pedido",
      expect.anything(),
    );
  });

  it("sem rede: o aviso diz QUAL pedido ficou guardado (nota da 1.5.245)", async () => {
    const { toast } = await import("sonner");
    const atualizar = await montarPainel();
    vi.stubGlobal("navigator", { ...navigator, onLine: false });

    await atualizar("shipping", "processing");

    // "pedido-1" -> os 6 últimos, em maiúsculas, como o painel mostra o número.
    expect(toast.info).toHaveBeenCalledWith(
      "Alteração de status do pedido #DIDO-1 guardada offline.",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("controle: com rede grava no banco e não diz que foi para a fila", async () => {
    const atualizar = await montarPainel();

    const resultado = await atualizar("shipping", "processing");

    expect(rpc).toHaveBeenCalledWith(
      "avancar_status_do_pedido",
      expect.objectContaining({ p_new_status: "shipping" }),
    );
    // 27/11/2026: a gravação direta passou a devolver a hora gravada no banco
    // (carimbo do aviso à cliente); o dublê do rpc não devolve a linha, então vem null.
    // O que este controle prova continua igual: NÃO foi para a fila.
    expect(resultado).not.toBe("guardado-na-fila");
    expect(resultado).toEqual({ gravadoNoBancoEm: null });
    expect(armazem.get("orders_offline_updates_queue:lojista-1")).toBe(
      undefined,
    );
  });
});

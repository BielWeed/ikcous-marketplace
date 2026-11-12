// @vitest-environment jsdom
//
// Defeito: depois que a conexão ao vivo de PEDIDOS cai e volta, um pedido que
// chegou DURANTE a queda ficava fora da lista, mesmo com o canal "conectado".
// `handleReconnect` recarrega a lista e SÓ DEPOIS chama `setupRealtime`, que
// reaproveita o canal existente — o SDK reabre o socket por conta própria,
// mais tarde. O que o banco emitiu entre a recarga e o novo SUBSCRIBED se
// perdia. O conserto: o SUBSCRIBED que vem DEPOIS de uma queda recarrega a
// lista (uma vez, em silêncio); o primeiro SUBSCRIBED de um canal novo não.
//
// Cada recarga é contada pelas idas à tabela `marketplace_orders`.

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chamadasFrom = vi.hoisted(() => ({ marketplaceOrders: 0 }));
const canal = vi.hoisted(() => ({
  aviso: null as null | ((status: string, err?: unknown) => unknown),
}));
// Um usuário novo por teste = um canal compartilhado novo (o mapa de canais é
// do módulo e sobrevive ao desmonte por 4s).
const usuario = vi.hoisted(() => ({ id: "u0" }));

vi.mock("@/lib/supabase", () => {
  const builder = () => {
    const promessa = Promise.resolve({ data: [], error: null, count: 0 });
    const alvo: Record<string, unknown> = {
      select: () => alvo,
      eq: () => alvo,
      order: () => alvo,
      range: () => alvo,
      limit: () => alvo,
      or: () => alvo,
      in: () => alvo,
      abortSignal: () => alvo,
      single: () => alvo,
      maybeSingle: () => alvo,
    };
    // biome-ignore lint/suspicious/noThenProperty: mock de consulta precisa ser awaitable
    Object.defineProperty(alvo, "then", {
      value: (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) =>
        promessa.then(res, rej),
    });
    return alvo;
  };
  const novoCanal = () => {
    const alvo: Record<string, unknown> = {
      on: () => alvo,
      // NÃO responde sozinho: o teste dita cada status, como o SDK faria.
      subscribe: (cb: (status: string, err?: unknown) => unknown) => {
        canal.aviso = cb;
        return alvo;
      },
    };
    return alvo;
  };
  return {
    supabase: {
      from: (tabela: string) => {
        if (tabela === "marketplace_orders") chamadasFrom.marketplaceOrders++;
        return builder();
      },
      rpc: () => builder(),
      channel: () => novoCanal(),
      removeChannel: () => Promise.resolve(),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: usuario.id }, isAdmin: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { useOrders } from "@/hooks/useOrders";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const BroadcastChannelStub = class {
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  close() {}
};

function Alvo() {
  useOrders(true);
  return null;
}

describe("useOrders — recarrega a lista quando o canal volta depois de uma queda", () => {
  let root: Root | null = null;
  let contagem = 0;

  beforeEach(async () => {
    vi.useFakeTimers();
    chamadasFrom.marketplaceOrders = 0;
    canal.aviso = null;
    usuario.id = `u${Math.random().toString(36).slice(2)}`;
    if (typeof (globalThis as any).BroadcastChannel === "undefined") {
      (globalThis as any).BroadcastChannel = BroadcastChannelStub;
    }
    const memoria = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => memoria.get(k) ?? null,
        setItem: (k: string, v: string) => {
          memoria.set(k, String(v));
        },
        removeItem: (k: string) => {
          memoria.delete(k);
        },
        clear: () => memoria.clear(),
      },
    });
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);
    act(() => {
      root!.render(<Alvo />);
    });
    await act(async () => {});
    expect(canal.aviso).not.toBeNull();
    contagem = chamadasFrom.marketplaceOrders;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const avisar = async (status: string, err?: unknown) => {
    await act(async () => {
      await canal.aviso?.(status, err);
    });
    await act(async () => {});
  };

  it("o PRIMEIRO SUBSCRIBED de um canal novo não recarrega (a lista já foi carregada)", async () => {
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem);
  });

  it("queda (CHANNEL_ERROR) seguida de SUBSCRIBED recarrega EXATAMENTE uma vez", async () => {
    await avisar("SUBSCRIBED");
    await avisar("CHANNEL_ERROR", { message: "1006 abnormal" });
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 1);
  });

  it("queda (CLOSED) seguida de SUBSCRIBED também recarrega uma vez", async () => {
    await avisar("SUBSCRIBED");
    await avisar("CLOSED");
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 1);
  });

  it("o caso do defeito: a recarga do handleReconnect vem ANTES do SUBSCRIBED e não basta", async () => {
    await avisar("SUBSCRIBED");
    await avisar("TIMED_OUT");
    // O timer do handleReconnect (1s + jitter) recarrega e chama setupRealtime,
    // que só reaproveita o canal — o socket ainda não voltou.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 1);
    // O SDK reabre o canal DEPOIS: o que passou nesse intervalo só chega por
    // uma recarga feita agora.
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 2);
  });

  it("dois SUBSCRIBED seguidos, sem queda no meio, não recarregam de novo", async () => {
    await avisar("SUBSCRIBED");
    await avisar("CHANNEL_ERROR", { message: "1006 abnormal" });
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 1);
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 1);
  });
});

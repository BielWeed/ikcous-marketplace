// @vitest-environment jsdom
//
// Defeito: depois que a conexão ao vivo de PEDIDOS cai e volta, um pedido que
// chegou DURANTE a queda ficava fora da lista, mesmo com o canal "conectado".
// `handleReconnect` recarrega a lista e SÓ DEPOIS chama `setupRealtime`, que
// reaproveita o canal existente — o SDK reabre o socket por conta própria,
// mais tarde. O que o banco emitiu entre a recarga e o novo SUBSCRIBED se
// perdia. O conserto: o SUBSCRIBED que vem DEPOIS de uma queda recarrega a
// lista (uma vez, em silêncio).
//
// O PRIMEIRO SUBSCRIBED de um canal novo tem a mesma janela: a leitura inicial
// sai ANTES de a assinatura confirmar, e o pedido que entra entre as duas não
// chega nem pela consulta nem pelo tempo real. Por isso ele também relê, mas
// SÓ se a leitura inicial já terminou — confirmando antes dela terminar, a
// leitura em andamento já é a que vale e reler seria trabalho em dobro.
//
// Cada recarga é contada pelas idas à tabela `marketplace_orders`.

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chamadasFrom = vi.hoisted(() => ({ marketplaceOrders: 0 }));
// O que o banco devolve para a lista do cliente (muda ao longo do teste: é o
// pedido que "entra" na janela entre a leitura e a assinatura).
const banco = vi.hoisted(() => ({ pedidos: [] as unknown[] }));
const canal = vi.hoisted(() => ({
  aviso: null as null | ((status: string, err?: unknown) => unknown),
}));
// Um usuário novo por teste = um canal compartilhado novo (o mapa de canais é
// do módulo e sobrevive ao desmonte por 4s).
const usuario = vi.hoisted(() => ({ id: "u0" }));

vi.mock("@/lib/supabase", () => {
  const builder = (tabela = "") => {
    // Lida na CRIAÇÃO da consulta: cada ida ao banco vê o retrato daquele instante.
    const promessa = Promise.resolve({
      data: tabela === "marketplace_orders" ? [...banco.pedidos] : [],
      error: null,
      count: 0,
    });
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
        return builder(tabela);
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

type Exposto = {
  orders: Array<{ id: string }>;
  fetchUserOrders: (silent?: boolean) => Promise<unknown>;
};
// Um Map (e não campo solto): escrever em objeto de módulo dentro do componente
// é o que `react-hooks/immutability` barra.
const exposto = vi.hoisted(() => new Map<string, Exposto>());
const aoReconciliar = vi.hoisted(() => vi.fn());
const hook = () => exposto.get("atual") as Exposto;

function Alvo() {
  exposto.set(
    "atual",
    useOrders(true, false, {
      onReconciliar: aoReconciliar,
    }) as unknown as Exposto,
  );
  return null;
}

describe("useOrders — recarrega a lista quando o canal volta depois de uma queda", () => {
  let root: Root | null = null;
  let contagem = 0;

  beforeEach(async () => {
    vi.useFakeTimers();
    chamadasFrom.marketplaceOrders = 0;
    banco.pedidos = [];
    aoReconciliar.mockClear();
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

  // A leitura que o consumidor (a tela) faz ao abrir. O hook não a dispara sozinho.
  const lerAListaInicial = async () => {
    await act(async () => {
      await hook().fetchUserOrders(true);
    });
    contagem = chamadasFrom.marketplaceOrders;
  };

  const pedidoDoBanco = (id: string) => ({
    id,
    user_id: usuario.id,
    customer_name: "Cliente de teste",
    customer_data: {},
    items: [],
    total: 10,
    subtotal: 10,
    shipping: 0,
    discount: 0,
    status: "pending",
    payment_status: "aguardando",
    payment_method: "pix",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  });

  it("SUBSCRIBED que confirma ANTES de a leitura inicial terminar não recarrega (ela ainda vale)", async () => {
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem);
    expect(aoReconciliar).not.toHaveBeenCalled();
  });

  it("o PRIMEIRO SUBSCRIBED, com a leitura inicial já terminada, recarrega EXATAMENTE uma vez", async () => {
    await lerAListaInicial();
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 1);
  });

  it("pedido que entra DEPOIS da leitura inicial e ANTES da assinatura aparece na lista (a janela perdida)", async () => {
    await lerAListaInicial();
    expect(hook().orders).toHaveLength(0);
    // Entrou no banco depois da consulta e antes de o canal estar ativo:
    // nenhum evento do tempo real vai trazê-lo.
    banco.pedidos = [pedidoDoBanco("ped-da-janela")];
    await avisar("SUBSCRIBED");
    expect(hook().orders.map((p) => p.id)).toEqual(["ped-da-janela"]);
  });

  it("cada SUBSCRIBED recarrega no máximo uma vez: a recarga não puxa outra em cascata", async () => {
    await lerAListaInicial();
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 1);
    // Mesmo com o relógio correndo e a recarga já terminada, nada mais lê.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 1);
    // Confirmação repetida sem queda no meio: nada.
    await avisar("SUBSCRIBED");
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 1);
  });

  it("a leitura da conta ANTERIOR não vale para a conta que entrou: o canal novo dela não relê à toa", async () => {
    await lerAListaInicial();
    usuario.id = `${usuario.id}-outra`;
    await act(async () => {
      root!.render(<Alvo />);
    });
    await act(async () => {});
    const lidas = chamadasFrom.marketplaceOrders;
    aoReconciliar.mockClear();

    // Canal NOVO (outra conta): a leitura desta conta ainda nem aconteceu.
    await avisar("SUBSCRIBED");

    expect(chamadasFrom.marketplaceOrders).toBe(lidas);
    expect(aoReconciliar).not.toHaveBeenCalled();
  });

  it("com a leitura inicial feita: primeira confirmação, queda e volta recarregam uma vez CADA (2 no total)", async () => {
    await lerAListaInicial();
    await avisar("SUBSCRIBED");
    await avisar("CHANNEL_ERROR", { message: "1006 abnormal" });
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(contagem + 2);
  });

  it("toda reconciliação por SUBSCRIBED avisa quem mostra os números do topo, uma vez por recarga", async () => {
    await lerAListaInicial();
    await avisar("SUBSCRIBED");
    expect(aoReconciliar).toHaveBeenCalledTimes(1);
    await avisar("SUBSCRIBED");
    expect(aoReconciliar).toHaveBeenCalledTimes(1);
    await avisar("CLOSED");
    await avisar("SUBSCRIBED");
    expect(aoReconciliar).toHaveBeenCalledTimes(2);
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

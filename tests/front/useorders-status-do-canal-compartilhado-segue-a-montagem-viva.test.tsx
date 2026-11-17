// @vitest-environment jsdom
//
// Defeito: a lojista sai de Pedidos e volta em menos de 4 s. O canal de tempo
// real é REAPROVEITADO (a limpeza dele é adiada 4 s) — a montagem nova entra
// com o callback de EVENTOS, mas o callback de STATUS que o SDK chama
// (`channel.subscribe`) continuava sendo o da montagem ANTIGA, já encerrada.
// Quando só o SOCKET caía (internet viva, aba visível), `CHANNEL_ERROR` e o
// `SUBSCRIBED` seguinte batiam numa montagem morta: nada reabria a conexão
// pela montagem viva e os pedidos recebidos durante a queda ficavam fora da
// lista até outra releitura (voltar à aba, sair e entrar, mudar filtro).
//
// O conserto leva o status do canal a TODA montagem viva que o usa — e só a
// elas: a montagem encerrada não pode voltar a trabalhar.
//
// Cada recarga é contada pelas idas à tabela `marketplace_orders`.

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chamadasFrom = vi.hoisted(() => ({ marketplaceOrders: 0 }));
const canal = vi.hoisted(() => ({
  aviso: null as null | ((status: string, err?: unknown) => unknown),
  criados: 0,
}));
// Um usuário novo por teste = um canal compartilhado novo (o mapa de canais é
// do módulo e sobrevive ao desmonte por 4 s).
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
    canal.criados++;
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

type Exposto = { fetchUserOrders: (silent?: boolean) => Promise<unknown> };
// Um Map (e não campo solto): escrever em objeto de módulo dentro do componente
// é o que `react-hooks/immutability` barra.
const expostos = vi.hoisted(() => new Map<string, Exposto>());

function Montagem({
  nome,
  aoReconciliar,
}: {
  nome: string;
  aoReconciliar: () => void;
}) {
  expostos.set(
    nome,
    useOrders(true, false, { onReconciliar: aoReconciliar }) as Exposto,
  );
  return null;
}

describe("useOrders — o status do canal compartilhado chega à montagem VIVA", () => {
  const raizes: Root[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    chamadasFrom.marketplaceOrders = 0;
    canal.aviso = null;
    canal.criados = 0;
    expostos.clear();
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
  });

  afterEach(() => {
    for (const raiz of raizes.splice(0)) {
      act(() => {
        raiz.unmount();
      });
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Monta uma instância da tela e faz a leitura inicial dela, como a tela faz. */
  async function montar(nome: string, aoReconciliar = vi.fn()) {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const raiz = createRoot(div);
    raizes.push(raiz);
    act(() => {
      raiz.render(<Montagem nome={nome} aoReconciliar={aoReconciliar} />);
    });
    await act(async () => {});
    await act(async () => {
      await expostos.get(nome)?.fetchUserOrders(true);
    });
    return { raiz, aoReconciliar };
  }

  async function desmontar(raiz: Root) {
    await act(async () => {
      raiz.unmount();
    });
    raizes.splice(raizes.indexOf(raiz), 1);
  }

  const avisar = async (status: string, err?: unknown) => {
    await act(async () => {
      await canal.aviso?.(status, err);
    });
    await act(async () => {});
  };

  const passar = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("sair de Pedidos e voltar em menos de 4 s: a queda do SOCKET depois disso recarrega a lista e pede os números do topo", async () => {
    const a = await montar("A");
    await avisar("SUBSCRIBED");
    await desmontar(a.raiz);

    await passar(1000); // < 4 s: o canal é reaproveitado, não recriado
    const b = await montar("B");
    expect(canal.criados).toBe(1);
    const lidasAntes = chamadasFrom.marketplaceOrders;

    // Só o socket cai (internet segue): o SDK avisa pelo MESMO callback de
    // status que registrou quando a montagem A criou o canal.
    await avisar("CHANNEL_ERROR", { message: "1006 abnormal" });
    await passar(3000); // o recuo do handleReconnect (1 s + jitter) vence
    expect(chamadasFrom.marketplaceOrders).toBe(lidasAntes + 1);

    // O SDK reabre o socket DEPOIS: o que entrou no intervalo só chega por uma
    // recarga feita agora.
    await avisar("SUBSCRIBED");
    expect(chamadasFrom.marketplaceOrders).toBe(lidasAntes + 2);
    expect(b.aoReconciliar).toHaveBeenCalledTimes(1);
  });

  it("a montagem ENCERRADA não volta a trabalhar: sem nenhuma montagem viva, a queda não recarrega nada", async () => {
    const a = await montar("A");
    await avisar("SUBSCRIBED");
    await desmontar(a.raiz);
    await passar(1000);
    const lidasAntes = chamadasFrom.marketplaceOrders;
    a.aoReconciliar.mockClear();

    await avisar("CHANNEL_ERROR", { message: "1006 abnormal" });
    await passar(5000);
    await avisar("SUBSCRIBED");

    expect(chamadasFrom.marketplaceOrders).toBe(lidasAntes);
    expect(a.aoReconciliar).not.toHaveBeenCalled();
  });

  it("a montagem encerrada ANTES da primeira confirmação também não trabalha: ela chega a uma tela morta", async () => {
    // A leu a lista e saiu antes de o canal confirmar; a primeira confirmação
    // (a que relê) chega depois, sem nenhuma montagem viva.
    const a = await montar("A");
    await desmontar(a.raiz);
    await passar(1000);
    const lidasAntes = chamadasFrom.marketplaceOrders;
    a.aoReconciliar.mockClear();

    await avisar("SUBSCRIBED");

    expect(chamadasFrom.marketplaceOrders).toBe(lidasAntes);
    expect(a.aoReconciliar).not.toHaveBeenCalled();
  });

  it("a montagem encerrada não atrapalha a viva: só a viva reconcilia (uma vez)", async () => {
    const a = await montar("A");
    await avisar("SUBSCRIBED");
    await desmontar(a.raiz);
    await passar(1000);
    const b = await montar("B");
    a.aoReconciliar.mockClear();
    b.aoReconciliar.mockClear();

    await avisar("TIMED_OUT");
    await passar(3000);
    await avisar("SUBSCRIBED");

    expect(b.aoReconciliar).toHaveBeenCalledTimes(1);
    expect(a.aoReconciliar).not.toHaveBeenCalled();
  });

  it("duas telas vivas no mesmo canal: cada uma reconcilia a SUA lista depois da queda", async () => {
    const a = await montar("A");
    const b = await montar("B");
    await avisar("SUBSCRIBED");
    a.aoReconciliar.mockClear();
    b.aoReconciliar.mockClear();

    await avisar("CHANNEL_ERROR", { message: "1006 abnormal" });
    await passar(3000);
    await avisar("SUBSCRIBED");

    expect(a.aoReconciliar).toHaveBeenCalledTimes(1);
    expect(b.aoReconciliar).toHaveBeenCalledTimes(1);
  });

  it("a montagem que entra com o canal JÁ confirmado não relê à toa no SUBSCRIBED repetido", async () => {
    const a = await montar("A");
    await avisar("SUBSCRIBED");
    await desmontar(a.raiz);
    await passar(500);
    const b = await montar("B");
    const lidasAntes = chamadasFrom.marketplaceOrders;
    b.aoReconciliar.mockClear();

    // O canal já estava confirmado quando B entrou e B leu a lista depois
    // disso: não há janela a cobrir.
    await avisar("SUBSCRIBED");

    expect(chamadasFrom.marketplaceOrders).toBe(lidasAntes);
    expect(b.aoReconciliar).not.toHaveBeenCalled();
  });
});

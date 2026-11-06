// @vitest-environment jsdom
//
// Cancelar pedido (DINHEIRO-ADJACENTE) com rede "pendurada": a conexão abre e
// não responde. Sem prazo, `functions.invoke("criar-pagamento", {metodo:
// "cancelar"})` nunca terminava, o `finally` da tela nunca rodava e o botão
// ficava em "Processando" para sempre, sem erro e sem saída.
//
// O prazo só encerra a ESPERA DA TELA: a requisição segue no servidor e pode
// ter cancelado o pedido (e anulado a cobrança). Por isso a frase NÃO afirma
// que falhou: diz que não sabe e manda conferir o pedido antes de tentar de
// novo. O que é enviado, a ordem das chamadas e a regra não mudam: uma única
// chamada à edge, nunca a RPC direta, nunca "cancelado" na tela sem a resposta.
//
// Mesma sonda de cancelar-pedido-online-pela-edge.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const rpc = vi.fn();
const invoke = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: [], error: null }),
          single: () =>
            Promise.resolve({ data: { status: "pending" }, error: null }),
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

const usuario = { id: "cliente-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRAZO_ESPERADO_MS = 30_000;

function pedidoOnline(): Order {
  return {
    id: "pedido-1",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    status: "pending",
    paymentStatus: "aguardando",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
  };
}

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;
let ordersAtuais: Order[] = [];
let atualizar: (id: string, status: "cancelled") => Promise<void> =
  async () => {};

async function montarSonda() {
  armazem.set(
    `ikcous_orders_cache_${usuario.id}`,
    JSON.stringify([pedidoOnline()]),
  );
  const { useOrders } = await import("@/hooks/useOrders");
  function Sonda() {
    const { orders, updateOrderStatus } = useOrders(false, false);
    useEffect(() => {
      ordersAtuais = orders;
      atualizar = updateOrderStatus as typeof atualizar;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

/** Clica em cancelar e devolve o que a chamada fará (resolve ou rejeita). */
function clicarCancelar() {
  const desfecho: { settled: boolean; erro: unknown } = {
    settled: false,
    erro: null,
  };
  const promessa = atualizar("pedido-1", "cancelled").then(
    () => {
      desfecho.settled = true;
    },
    (erro: unknown) => {
      desfecho.settled = true;
      desfecho.erro = erro;
    },
  );
  return { desfecho, promessa };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  rpc.mockReset();
  invoke.mockReset();
  rpc.mockResolvedValue({ error: null });
  armazem = new Map();
  ordersAtuais = [];
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

afterEach(async () => {
  await act(async () => {
    raiz.unmount();
    await vi.advanceTimersByTimeAsync(4001);
  });
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("cancelar pedido: a espera da tela tem prazo", () => {
  it("a edge nunca responde: depois do prazo a chamada TERMINA (o botão volta) com frase honesta e o pedido continua aberto", async () => {
    invoke.mockReturnValue(new Promise(() => {})); // pendurada para sempre
    const { MENSAGEM_CANCELAMENTO_SEM_RESPOSTA, ErroCancelamentoNaoConcluido } =
      await import("@/hooks/useOrders");
    await montarSonda();

    let clique!: ReturnType<typeof clicarCancelar>;
    await act(async () => {
      clique = clicarCancelar();
      // um instante antes do prazo: ainda "Processando"
      await vi.advanceTimersByTimeAsync(PRAZO_ESPERADO_MS - 1);
    });
    expect(clique.desfecho.settled).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await clique.promessa;
    });

    expect(clique.desfecho.settled).toBe(true);
    expect(clique.desfecho.erro).toBeInstanceOf(ErroCancelamentoNaoConcluido);
    // "não sei" nunca vira "cancelado" nem "falhou": desfecho recuperável,
    // com a frase que manda conferir o pedido.
    expect(
      (
        clique.desfecho.erro as InstanceType<
          typeof ErroCancelamentoNaoConcluido
        >
      ).desfecho,
    ).toBe("recuperavel");
    expect((clique.desfecho.erro as Error).message).toBe(
      MENSAGEM_CANCELAMENTO_SEM_RESPOSTA,
    );
    expect(MENSAGEM_CANCELAMENTO_SEM_RESPOSTA).toMatch(
      /não sabemos|não conseguimos confirmar/i,
    );
    expect(MENSAGEM_CANCELAMENTO_SEM_RESPOSTA).toMatch(/confira o pedido/i);
    expect(MENSAGEM_CANCELAMENTO_SEM_RESPOSTA).not.toMatch(
      /não foi cancelado/i,
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      MENSAGEM_CANCELAMENTO_SEM_RESPOSTA,
    );
    expect(toast.success).not.toHaveBeenCalled();
    // nada pintado, nenhuma segunda tentativa, nunca a RPC que só mexe no banco
    expect(ordersAtuais.find((o) => o.id === "pedido-1")?.status).toBe(
      "pending",
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("criar-pagamento", {
      body: { orderId: "pedido-1", metodo: "cancelar" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("borda: a resposta que chega ANTES do prazo vale (cancelado), e o relógio do prazo não fica armado", async () => {
    let responder!: (v: unknown) => void;
    invoke.mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    await montarSonda();

    let clique!: ReturnType<typeof clicarCancelar>;
    await act(async () => {
      clique = clicarCancelar();
      await vi.advanceTimersByTimeAsync(PRAZO_ESPERADO_MS - 1000);
    });
    expect(clique.desfecho.settled).toBe(false);

    const armadosAntes = vi.getTimerCount();
    await act(async () => {
      responder({
        data: { cancelamento: "cancelado", mensagem: "Pedido cancelado." },
        error: null,
      });
      await clique.promessa;
    });
    expect(clique.desfecho.erro).toBeNull();
    expect(ordersAtuais.find((o) => o.id === "pedido-1")?.status).toBe(
      "cancelled",
    );
    expect(toast.success).toHaveBeenCalledWith("Pedido cancelado.");
    // o temporizador do prazo foi limpo (um a menos que antes da resposta)
    expect(vi.getTimerCount()).toBeLessThan(armadosAntes);
    // passar do prazo agora não muda nada
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_ESPERADO_MS);
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(ordersAtuais.find((o) => o.id === "pedido-1")?.status).toBe(
      "cancelled",
    );
  });

  it("borda: depois do aviso, tocar de novo manda UMA nova chamada (a anterior, tardia, não vira duas)", async () => {
    invoke.mockReturnValueOnce(new Promise(() => {}));
    await montarSonda();

    let primeiro!: ReturnType<typeof clicarCancelar>;
    await act(async () => {
      primeiro = clicarCancelar();
      await vi.advanceTimersByTimeAsync(PRAZO_ESPERADO_MS);
      await primeiro.promessa;
    });
    expect(primeiro.desfecho.settled).toBe(true);

    invoke.mockResolvedValueOnce({
      data: {
        cancelamento: "cancelado",
        jaEstava: true,
        mensagem: "Pedido cancelado.",
      },
      error: null,
    });
    let segundo!: ReturnType<typeof clicarCancelar>;
    await act(async () => {
      segundo = clicarCancelar();
      await segundo.promessa;
    });
    expect(segundo.desfecho.erro).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith(
      "Este pedido já estava cancelado.",
    );
  });
});

// @vitest-environment jsdom
//
// S1 (dinheiro, 04/10/2026, migration 20261198000000): cancelar pedido de
// pagamento ONLINE não pode mais só mexer no banco — a cobrança no Mercado
// Pago ficava viva e o cliente podia pagar um pedido já cancelado. Agora
// `useOrders.updateOrderStatus(id, "cancelled")` pede à edge
// `criar-pagamento` (ação `cancelar`), que ANULA a cobrança antes, e a tela
// só pinta "cancelado" com a resposta `cancelado` dela. Este arquivo prova o
// lado do front:
//
//   - cada desfecho da edge (cancelado, ja_pago, em_analise, mudou,
//     recuperavel, recusado) vira o comportamento certo: SÓ `cancelado` muda
//     o pedido na tela; os outros lançam `ErroCancelamentoNaoConcluido`
//     com a frase da edge, sem update otimista;
//   - "não sei" (rede caiu, corpo ilegível, `cancelado` dentro de um corpo de
//     ERRO) nunca vira cancelado;
//   - sem rede, nem cliente nem ADMIN enfileiram o cancelamento financeiro
//     (a fila offline nunca anuncia um cancelamento que a edge não fez);
//   - controle: pedido NÃO online (PIX/dinheiro na entrega) continua na RPC
//     de sempre, sem passar pela edge.
//
// Mesma sonda de cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx
// (o projeto não tem @testing-library/react).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, OrderStatus } from "@/types";

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

const MENSAGEM_EM_ANALISE =
  "Há um pagamento com cartão em análise para este pedido. Ele não pode ser cancelado agora — aguarde a confirmação do banco.";
const MENSAGEM_JA_PAGO =
  "Este pedido acabou de ser pago e não foi cancelado. A confirmação do pagamento aparece em instantes.";
const MENSAGEM_RECUPERAVEL_DA_EDGE =
  "Não foi possível confirmar o cancelamento com o Mercado Pago agora. O pedido NÃO foi cancelado — tente de novo em instantes.";

function pedidoOnline(over: Partial<Order> = {}): Order {
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
    ...over,
  };
}

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;

type Atualiza = (
  id: string,
  status: OrderStatus,
  notes?: string,
  silent?: boolean,
) => Promise<void>;

async function montarSonda(
  pedido: Order | null,
  isAdmin = false,
): Promise<{ pegarOrders: () => Order[]; atualizar: Atualiza }> {
  if (pedido) {
    armazem.set(`ikcous_orders_cache_${usuario.id}`, JSON.stringify([pedido]));
  }
  const { useOrders } = await import("@/hooks/useOrders");
  let ordersAtuais: Order[] = [];
  let atualizar: Atualiza = async () => {};
  function Sonda() {
    const { orders, updateOrderStatus } = useOrders(false, isAdmin);
    useEffect(() => {
      ordersAtuais = orders;
      atualizar = updateOrderStatus as Atualiza;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  return {
    pegarOrders: () => ordersAtuais,
    atualizar: (...a) => atualizar(...a),
  };
}

/** Resposta não-2xx do supabase-js v2: corpo dentro de `error.context`. */
function erroHttp(status: number, corpo: unknown) {
  return {
    data: null,
    error: {
      name: "FunctionsHttpError",
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify(corpo), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReset();
  invoke.mockReset();
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

async function cancelar(atualizar: Atualiza): Promise<unknown> {
  let erro: unknown = null;
  await act(async () => {
    erro = await atualizar("pedido-1", "cancelled").then(
      () => null,
      (e: unknown) => e,
    );
  });
  return erro;
}

describe("S1 — cancelar pedido online vai pela edge e só a resposta `cancelado` muda a tela", () => {
  it("edge responde cancelado: a tela pinta cancelado, mostra sucesso, e a RPC direta NÃO é chamada", async () => {
    invoke.mockResolvedValue({
      data: { cancelamento: "cancelado", mensagem: "Pedido cancelado." },
      error: null,
    });
    const { pegarOrders, atualizar } = await montarSonda(pedidoOnline());

    const erro = await cancelar(atualizar);

    expect(erro).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("criar-pagamento", {
      body: { orderId: "pedido-1", metodo: "cancelar" },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(pegarOrders().find((o) => o.id === "pedido-1")?.status).toBe(
      "cancelled",
    );
    expect(toast.success).toHaveBeenCalledWith("Pedido cancelado.");
  });

  it("edge responde cancelado com aviso (sentinela sem order no MP, admin): sucesso + o aviso, nessa ordem", async () => {
    invoke.mockResolvedValue({
      data: {
        cancelamento: "cancelado",
        mensagem: "Pedido cancelado.",
        aviso: "AVISO-DA-EDGE",
      },
      error: null,
    });
    const { atualizar } = await montarSonda(pedidoOnline());

    expect(await cancelar(atualizar)).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith("AVISO-DA-EDGE");
  });

  it.each([
    ["em_analise", MENSAGEM_EM_ANALISE, "warning"],
    ["ja_pago", MENSAGEM_JA_PAGO, "warning"],
    ["mudou", "A cobrança deste pedido mudou. Confira o pedido.", "warning"],
    ["recuperavel", MENSAGEM_RECUPERAVEL_DA_EDGE, "error"],
  ] as const)(
    "edge responde %s (200): NÃO cancela na tela, lança ErroCancelamentoNaoConcluido com a frase da edge e um único aviso",
    async (desfecho, mensagem, tipoDoToast) => {
      invoke.mockResolvedValue({
        data: { cancelamento: desfecho, mensagem },
        error: null,
      });
      const { ErroCancelamentoNaoConcluido } = await import(
        "@/hooks/useOrders"
      );
      const { pegarOrders, atualizar } = await montarSonda(pedidoOnline());

      const erro = await cancelar(atualizar);

      expect(erro).toBeInstanceOf(ErroCancelamentoNaoConcluido);
      expect(
        (erro as InstanceType<typeof ErroCancelamentoNaoConcluido>).desfecho,
      ).toBe(desfecho);
      expect((erro as Error).message).toBe(mensagem);
      const pedido = pegarOrders().find((o) => o.id === "pedido-1");
      expect(pedido?.status).toBe("pending");
      // "já pago" NUNCA vira pago pelo front: a confirmação é do servidor.
      expect(pedido?.paymentStatus).toBe("aguardando");
      expect(rpc).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      const outro = tipoDoToast === "error" ? toast.warning : toast.error;
      expect(toast[tipoDoToast]).toHaveBeenCalledTimes(1);
      expect(toast[tipoDoToast]).toHaveBeenCalledWith(mensagem);
      expect(outro).not.toHaveBeenCalled();
    },
  );

  it("edge 409 recusado (corpo de erro com a frase): não cancela, desfecho recusado, frase do servidor", async () => {
    invoke.mockResolvedValue(
      erroHttp(409, {
        error: "Pagamento antigo: fale com a loja.",
        cancelamento: "recusado",
      }),
    );
    const { pegarOrders, atualizar } = await montarSonda(pedidoOnline());

    const erro = (await cancelar(atualizar)) as {
      desfecho?: string;
      message?: string;
    };

    expect(erro?.desfecho).toBe("recusado");
    expect(erro?.message).toBe("Pagamento antigo: fale com a loja.");
    expect(pegarOrders()[0]?.status).toBe("pending");
  });

  it("edge 503 recuperavel (corpo de erro): toast de erro com a frase da edge, nada cancelado", async () => {
    invoke.mockResolvedValue(
      erroHttp(503, {
        cancelamento: "recuperavel",
        mensagem: MENSAGEM_RECUPERAVEL_DA_EDGE,
      }),
    );
    const { pegarOrders, atualizar } = await montarSonda(pedidoOnline());

    const erro = (await cancelar(atualizar)) as { desfecho?: string };

    expect(erro?.desfecho).toBe("recuperavel");
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_RECUPERAVEL_DA_EDGE);
    expect(pegarOrders()[0]?.status).toBe("pending");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("borda: `cancelado` dentro de um corpo de ERRO (5xx) nunca vira cancelado — vira recuperável", async () => {
    invoke.mockResolvedValue(erroHttp(500, { cancelamento: "cancelado" }));
    const { pegarOrders, atualizar } = await montarSonda(pedidoOnline());

    const erro = (await cancelar(atualizar)) as { desfecho?: string };

    expect(erro?.desfecho).toBe("recuperavel");
    expect(pegarOrders()[0]?.status).toBe("pending");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("borda: a chamada à edge estoura (rede caiu no meio): recuperável, nada cancelado, nenhuma segunda tentativa", async () => {
    invoke.mockRejectedValue(new TypeError("Failed to fetch"));
    const { MENSAGEM_CANCELAMENTO_RECUPERAVEL } = await import(
      "@/hooks/useOrders"
    );
    const { pegarOrders, atualizar } = await montarSonda(pedidoOnline());

    const erro = (await cancelar(atualizar)) as { desfecho?: string };

    expect(erro?.desfecho).toBe("recuperavel");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_CANCELAMENTO_RECUPERAVEL);
    expect(pegarOrders()[0]?.status).toBe("pending");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("borda: resposta 200 sem desfecho conhecido (corpo estranho) nunca vira cancelado", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const { pegarOrders, atualizar } = await montarSonda(pedidoOnline());

    const erro = (await cancelar(atualizar)) as { desfecho?: string };

    expect(erro?.desfecho).toBe("recuperavel");
    expect(pegarOrders()[0]?.status).toBe("pending");
  });

  it("pedido que a tela NÃO tem em memória (deep link) também vai pela edge — 'não sei' nunca vai pela RPC que só mexe no banco", async () => {
    invoke.mockResolvedValue({
      data: { cancelamento: "cancelado" },
      error: null,
    });
    const { atualizar } = await montarSonda(null);

    expect(await cancelar(atualizar)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("controle: pedido NÃO online (PIX na entrega, pago) continua na RPC de sempre — a edge não é chamada", async () => {
    const { atualizar } = await montarSonda(
      pedidoOnline({ paymentMethod: "pix", paymentStatus: "pago" }),
    );

    const erro = await cancelar(atualizar);

    expect(erro).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "update_order_status_atomic",
      expect.objectContaining({ p_new_status: "cancelled" }),
    );
  });
});

describe("S1 — sem rede, o cancelamento financeiro não entra na fila offline (nem do admin)", () => {
  it("cliente offline: recusa com a frase de sempre, sem edge, sem RPC, sem fila", async () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    const { ErroCancelamentoOfflineRecusado } = await import(
      "@/hooks/useOrders"
    );
    const { pegarOrders, atualizar } = await montarSonda(pedidoOnline());

    const erro = await cancelar(atualizar);

    expect(erro).toBeInstanceOf(ErroCancelamentoOfflineRecusado);
    expect(invoke).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(armazem.get("orders_offline_updates_queue")).toBeUndefined();
    expect(pegarOrders()[0]?.status).toBe("pending");
  });

  it("ADMIN offline cancelando pedido online: recusa, NÃO enfileira, e não anuncia 'guardada offline'", async () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    const { ErroCancelamentoOfflineRecusado } = await import(
      "@/hooks/useOrders"
    );
    const { atualizar } = await montarSonda(null, true);

    const erro = await cancelar(atualizar);

    expect(erro).toBeInstanceOf(ErroCancelamentoOfflineRecusado);
    expect(invoke).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(armazem.get("orders_offline_updates_queue")).toBeUndefined();
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});

describe("cancelamentoVaiPelaEdge — quem cancela pela edge", () => {
  it("online, aguardando ou desconhecido → edge; não online e não aguardando → RPC", async () => {
    const { cancelamentoVaiPelaEdge } = await import("@/hooks/useOrders");
    expect(cancelamentoVaiPelaEdge(undefined)).toBe(true);
    expect(cancelamentoVaiPelaEdge(pedidoOnline())).toBe(true);
    expect(
      cancelamentoVaiPelaEdge(pedidoOnline({ paymentStatus: "pago" })),
    ).toBe(true);
    expect(
      cancelamentoVaiPelaEdge(
        pedidoOnline({ paymentMethod: "pix", paymentStatus: "aguardando" }),
      ),
    ).toBe(true);
    expect(
      cancelamentoVaiPelaEdge(
        pedidoOnline({ paymentMethod: "cash", paymentStatus: null }),
      ),
    ).toBe(false);
  });
});

// @vitest-environment jsdom
//
// Anular venda do balcão (caça 13, D5): `useAnularVendaDoBalcao` só chamava a
// RPC. A etiqueta do pedido na lista e na ficha ficava "Finalizado / Recebido"
// até o tempo real chegar (e, com ele atrasado ou perdido, até recarregar), e
// os números do topo de Pedidos não eram relidos. Agora o sucesso avisa a
// lista de pedidos do painel (que muda o pedido na hora, como o cancelamento
// pela edge) e os números do topo (releitura coalescida, nunca por filtro).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    channel: () => {
      const canal: any = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useAnularVendaDoBalcao } from "@/hooks/useAnularVendaDoBalcao";
import { useNumerosDosPedidos } from "@/hooks/useNumerosDosPedidos";
import { useOrders } from "@/hooks/useOrders";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: "delivered",
    updated_at: "2026-10-16T10:00:00Z",
    created_at: "2026-10-16T09:00:00Z",
    user_id: null,
    customer_name: "Balcão",
    items: [],
    payment_method: "cash",
    payment_status: "recebido_na_entrega",
    cancelled_after_shipping: false,
    canal: "presencial",
    ...extra,
  };
}

let linhasDoServidor: ReturnType<typeof linha>[] = [];
let respostaDaAnulacao: () => Promise<{ data: unknown; error: unknown }>;

let pedidos: ReturnType<typeof useOrders>;
let anular: ReturnType<typeof useAnularVendaDoBalcao>["anular"];
function Sonda() {
  const retorno = useOrders(true, true);
  const anulacao = useAnularVendaDoBalcao();
  useNumerosDosPedidos(true);
  useEffect(() => {
    pedidos = retorno;
    anular = anulacao.anular;
  });
  return null;
}

const CONTAGENS_POR_RODADA = 4;
const leiturasDosNumeros = () =>
  from.mock.calls.filter(([tabela]) => tabela === "marketplace_orders").length;

describe("anular venda do balcão atualiza a lista na hora", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(async () => {
    vi.useFakeTimers();
    linhasDoServidor = [linha("BAL-1"), linha("BAL-2")];
    respostaDaAnulacao = async () => ({
      data: { order_id: "BAL-1", ja_anulada: false },
      error: null,
    });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_admin_orders_paged") {
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: linhasDoServidor,
                total_count: linhasDoServidor.length,
              },
              error: null,
            }),
        };
      }
      if (nome === "anular_venda_presencial") return respostaDaAnulacao();
      // Painel de cancelados e afins: resposta vazia, com o `abortSignal` do builder.
      return Object.assign(Promise.resolve({ data: null, error: null }), {
        abortSignal: () => Promise.resolve({ data: null, error: null }),
      });
    });
    from.mockReset();
    from.mockImplementation(() => {
      const cadeia = {
        select: () => cadeia,
        in: () => cadeia,
        or: () => cadeia,
        eq: () => cadeia,
        order: () => cadeia,
        limit: () => cadeia,
        // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
      };
      return cadeia;
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await pedidos.loadOrders(0, 12, "all");
    });
  });
  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      await vi.advanceTimersByTimeAsync(4001);
    });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const doPedido = (id: string) => pedidos.orders.find((o) => o.id === id);

  it("sucesso: o pedido vira cancelado/estornado sem esperar o tempo real, e só ele", async () => {
    expect(doPedido("BAL-1")?.status).toBe("delivered");
    await act(async () => {
      await anular("BAL-1", "engano");
    });
    expect(doPedido("BAL-1")?.status).toBe("cancelled");
    expect(doPedido("BAL-1")?.paymentStatus).toBe("estornado");
    // O vizinho não muda.
    expect(doPedido("BAL-2")?.status).toBe("delivered");
    expect(doPedido("BAL-2")?.paymentStatus).toBe("recebido_na_entrega");
  });

  it("duplo toque (ja_anulada): a tela também fica de acordo com o banco", async () => {
    respostaDaAnulacao = async () => ({
      data: { order_id: "BAL-1", ja_anulada: true },
      error: null,
    });
    await act(async () => {
      await anular("BAL-1", "engano");
    });
    expect(doPedido("BAL-1")?.status).toBe("cancelled");
  });

  it("os números do topo são relidos uma vez, na janela de coalescência", async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    const antes = leiturasDosNumeros();
    await act(async () => {
      await anular("BAL-1", "engano");
      // Rajada: um segundo aviso dentro da janela não cria outra rodada.
      await anular("BAL-1", "engano");
    });
    // Ainda dentro da janela: nada lido.
    expect(leiturasDosNumeros()).toBe(antes);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    // UMA rodada = as 4 contagens do topo (preparar, aguardando, a caminho, a conferir).
    expect(leiturasDosNumeros()).toBe(antes + CONTAGENS_POR_RODADA);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(leiturasDosNumeros()).toBe(antes + CONTAGENS_POR_RODADA);
  });

  it("falha da anulação (RPC recusou): a lista NÃO muda e os números não são relidos", async () => {
    respostaDaAnulacao = async () => ({
      data: null,
      error: {
        code: "22023",
        message: "Esta venda não pode ser anulada aqui.",
      },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    const antes = leiturasDosNumeros();
    await act(async () => {
      await expect(anular("BAL-1", "engano")).rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(doPedido("BAL-1")?.status).toBe("delivered");
    expect(doPedido("BAL-1")?.paymentStatus).toBe("recebido_na_entrega");
    expect(leiturasDosNumeros()).toBe(antes);
  });

  it("resposta torta da RPC (erro de formato): a lista NÃO muda", async () => {
    respostaDaAnulacao = async () => ({ data: { algo: 1 }, error: null });
    await act(async () => {
      await expect(anular("BAL-1", "engano")).rejects.toThrow(
        "Resposta inesperada",
      );
    });
    expect(doPedido("BAL-1")?.status).toBe("delivered");
  });

  it("depois de desmontar, anular não mexe em nada (assinatura é desfeita)", async () => {
    const anularGuardado = anular;
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(host);
    await expect(anularGuardado("BAL-1", "engano")).resolves.toBeDefined();
  });
});

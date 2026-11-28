// @vitest-environment jsdom
//
// Lote 587 (28/11/2026): pedido novo de pagamento online com o cartão aprovado
// na hora. O INSERT (reserva "aguardando", que por regra não ganha aviso)
// chega e o hook vai buscar a linha completa; o UPDATE do pagamento ("pago")
// chega antes de o pedido entrar na lista. Sem o pedido na memória, o "antes"
// do UPDATE ficava só com a chave primária (RLS) e o painel dizia "Pedido #N
// foi atualizado" — a lojista nunca ouvia que entrou uma venda paga. O hook
// passa a lembrar a linha dos pedidos que nasceram pelo INSERT desta sessão e
// a usa como "antes" quando a lista ainda não os tem.
//
// Casco: use-orders-realtime-completa-o-old-do-aviso (hook de verdade, evento
// com o `old` real só com o id), mais a leitura do INSERT (`from().single()`).
import { useOrders } from "@/hooks/useOrders";
import { esquecerAcaoPropriaDoPedido } from "@/lib/acao-propria-do-painel";
import {
  deveAvisarPedidoNovo,
  tipoDoAvisoDoPedido,
} from "@/lib/aviso-de-pedido-atualizado";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const lerPedidoDoInsert = vi.fn<() => Promise<unknown>>();
let evento: ((payload: unknown) => Promise<void>) | undefined;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        single: () => lerPedidoDoInsert(),
      };
      return consulta;
    },
    channel: () => {
      const canal = {
        on: (_tipo: string, _filtro: unknown, handler: typeof evento) => {
          evento = handler;
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-cartao-na-hora" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(
  id: string,
  payment_status: string,
  status: string,
  updated_at = "2026-11-28T10:00:00Z",
) {
  return {
    id,
    payment_status,
    payment_method: "online",
    status,
    canal: "online",
    customer_name: "Cliente Fictícia",
    created_at: "2026-11-28T10:00:00Z",
    updated_at,
    items: [],
  };
}

let recebidos: Array<Record<string, any>>;
let atuais: ReturnType<typeof useOrders>;
function Sonda() {
  const retorno = useOrders(true, true, {
    onRealtimeEvent: (payload) => recebidos.push(payload),
  });
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

/** Quantos avisos o painel daria para o que chegou (mesma régua de
 *  AdminOrdersView: INSERT por `deveAvisarPedidoNovo`, UPDATE por
 *  `tipoDoAvisoDoPedido`). */
function avisosDoPainel() {
  return recebidos.flatMap((payload) => {
    if (payload.eventType === "INSERT") {
      return deveAvisarPedidoNovo(payload.new) ? ["novo"] : [];
    }
    if (payload.eventType === "UPDATE") {
      const tipo = tipoDoAvisoDoPedido(payload);
      return tipo ? [tipo] : [];
    }
    return [];
  });
}

async function emitirUpdate(novo: Record<string, unknown>) {
  await act(async () => {
    await evento!({ eventType: "UPDATE", old: { id: novo.id }, new: novo });
  });
}

describe("useOrders — cartão aprovado na hora: o pedido novo avisa pago, não 'foi atualizado'", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  async function montarComFiltro(filtro: string) {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, filtro, "", undefined, undefined, false);
    });
    expect(evento).toBeDefined();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    evento = undefined;
    recebidos = [];
    esquecerAcaoPropriaDoPedido("p-antigo");
    esquecerAcaoPropriaDoPedido("p-novo");
    rpc.mockReset();
    lerPedidoDoInsert.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome !== "get_admin_orders_paged") {
        throw new Error(`RPC inesperada: ${nome}`);
      }
      return {
        abortSignal: () =>
          Promise.resolve({
            data: {
              data: [
                linha("p-antigo", "pago", "pending", "2026-11-27T09:00:00Z"),
              ],
              total_count: 1,
            },
            error: null,
          }),
      };
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
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
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("o pagamento chega enquanto o INSERT ainda busca o pedido: um aviso só, de pagamento confirmado", async () => {
    await montarComFiltro("all");
    let soltarLeitura: (v: unknown) => void = () => {};
    lerPedidoDoInsert.mockImplementation(
      () =>
        new Promise((r) => {
          soltarLeitura = r;
        }),
    );

    let insertTerminou: Promise<void> = Promise.resolve();
    await act(async () => {
      insertTerminou = evento!({
        eventType: "INSERT",
        new: linha("p-novo", "aguardando", "pending"),
      });
      await Promise.resolve();
    });
    await emitirUpdate(
      linha("p-novo", "pago", "pending", "2026-11-28T10:00:02Z"),
    );

    const doPagamento = recebidos.find((p) => p.eventType === "UPDATE");
    expect(doPagamento?.old).toMatchObject({
      id: "p-novo",
      payment_status: "aguardando",
    });
    expect(tipoDoAvisoDoPedido(doPagamento!)).toBe("pagamento");

    await act(async () => {
      soltarLeitura({
        data: linha("p-novo", "aguardando", "pending"),
        error: null,
      });
      await insertTerminou;
    });
    // O pedido entrou na lista já pago (o UPDATE do meio do voo vale).
    expect(atuais.orders.find((p) => p.id === "p-novo")?.paymentStatus).toBe(
      "pago",
    );
    expect(avisosDoPainel()).toEqual(["pagamento"]);
  });

  it("pedido novo fora do filtro da lojista (não entra na lista): o pagamento avisa como pago, e o passo seguinte não repete o pagamento", async () => {
    await montarComFiltro("delivered");
    lerPedidoDoInsert.mockResolvedValue({
      data: linha("p-novo", "aguardando", "pending"),
      error: null,
    });

    await act(async () => {
      await evento!({
        eventType: "INSERT",
        new: linha("p-novo", "aguardando", "pending"),
      });
    });
    expect(atuais.orders.some((p) => p.id === "p-novo")).toBe(false);

    await emitirUpdate(
      linha("p-novo", "pago", "pending", "2026-11-28T10:00:02Z"),
    );
    await emitirUpdate(
      linha("p-novo", "pago", "processing", "2026-11-28T10:05:00Z"),
    );

    expect(avisosDoPainel()).toEqual(["pagamento", "status"]);
  });

  it("a lembrança do pedido novo vence: passado o prazo, o aviso volta a ser o neutro", async () => {
    await montarComFiltro("delivered");
    lerPedidoDoInsert.mockResolvedValue({
      data: linha("p-novo", "aguardando", "pending"),
      error: null,
    });
    await act(async () => {
      await evento!({
        eventType: "INSERT",
        new: linha("p-novo", "aguardando", "pending"),
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    });
    await emitirUpdate(
      linha("p-novo", "pago", "pending", "2026-11-28T10:06:00Z"),
    );

    expect(avisosDoPainel()).toEqual(["generico"]);
  });

  it("controle: pedido antigo que a tela não tem, atualizado de verdade, continua com o aviso neutro 'foi atualizado'", async () => {
    await montarComFiltro("all");

    await emitirUpdate(
      linha("p-fora-da-pagina", "pago", "shipping", "2026-11-28T10:00:00Z"),
    );

    const chegou = recebidos[recebidos.length - 1]!;
    expect(chegou.old).toEqual({ id: "p-fora-da-pagina" });
    expect(tipoDoAvisoDoPedido(chegou)).toBe("generico");
  });

  it("controle: pedido que já está na lista continua comparado com a versão da lista", async () => {
    await montarComFiltro("all");

    await emitirUpdate(
      linha("p-antigo", "pago", "processing", "2026-11-28T10:00:00Z"),
    );

    const chegou = recebidos[recebidos.length - 1]!;
    expect(chegou.old).toMatchObject({ status: "pending" });
    expect(tipoDoAvisoDoPedido(chegou)).toBe("status");
  });
});

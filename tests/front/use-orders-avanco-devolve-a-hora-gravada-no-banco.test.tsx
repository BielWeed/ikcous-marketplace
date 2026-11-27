// @vitest-environment jsdom
/**
 * Lote 502: o aviso de status à cliente (`avisarOClienteDoStatus`) carimba a
 * ordem com a hora em que o BANCO gravou a mudança, e não com o relógio do
 * aparelho da lojista (que pode estar adiantado). A ficha
 * (AdminOrdersView.handleStatusChange) só sabe essa hora pelo que
 * `updateOrderStatus` devolve: aqui se prova que ele devolve o `updated_at` da
 * linha que a RPC gravou — e `null` quando não há como saber (a resposta se
 * perdeu e a gravação foi confirmada por releitura), caso em que o aviso cai
 * no relógio local, como sempre.
 *
 * Mesma sonda de use-orders-avanco-gravado-sem-resposta-avisa.test.tsx.
 */
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
      const canal: any = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "usuario-hora-do-banco" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
import { PRAZO_DO_AVANCO_DE_STATUS_MS, useOrders } from "@/hooks/useOrders";
import type { OrderStatus } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(id: string, status = "pending") {
  return {
    id,
    status,
    updated_at: "2026-11-27T10:00:00Z",
    created_at: "2026-11-27T09:00:00Z",
    user_id: "cliente-1",
    customer_name: "Cliente Teste",
    items: [],
    payment_method: "cash",
    payment_status: null,
    cancelled_after_shipping: false,
  };
}
type Resposta = { data: unknown; error: unknown };

let atuais: ReturnType<typeof useOrders>;
/** O que o banco tem de verdade (lido pela releitura). */
let statusNoBanco: string;
let gravacao: () => Promise<Resposta>;
let releitura: () => Promise<Resposta>;
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

const ID = "PED-1";

const gravacoes = () =>
  rpc.mock.calls.filter(([nome]) => nome === "avancar_status_do_pedido");

/** Clica e devolve o desfecho (a chamada termina dentro do `act`). */
async function avancar(
  status: OrderStatus,
  statusEsperado?: OrderStatus,
): Promise<{ ok: boolean; erro: unknown; valor: unknown }> {
  const desfecho = {
    ok: false,
    erro: null as unknown,
    valor: undefined as unknown,
  };
  await act(async () => {
    const promessa = atuais
      .updateOrderStatus(ID, status, undefined, false, statusEsperado)
      .then(
        (valor: unknown) => {
          desfecho.ok = true;
          desfecho.valor = valor;
        },
        (erro: unknown) => {
          desfecho.erro = erro;
        },
      );
    // Prazo da gravação + prazo da conferência: o suficiente para qualquer
    // espera pendurada terminar.
    await vi.advanceTimersByTimeAsync(PRAZO_DO_AVANCO_DE_STATUS_MS * 2);
    await promessa;
  });
  return desfecho;
}

describe("Avançar/cancelar status: devolve a hora gravada no banco", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    statusNoBanco = "pending";
    gravacao = async () => ({ data: null, error: null });
    releitura = async () => ({ data: { status: statusNoBanco }, error: null });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) =>
      nome === "get_admin_orders_paged"
        ? {
            abortSignal: () =>
              Promise.resolve({
                data: { data: [linha(ID, statusNoBanco)], total_count: 1 },
                error: null,
              }),
          }
        : gravacao(),
    );
    from.mockReset();
    from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: () => releitura() }) }),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
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
      await atuais.loadOrders(0, 12, "all");
    });
    vi.clearAllMocks();
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

  it("avanço gravado: devolve o updated_at da linha que a RPC devolveu", async () => {
    gravacao = async () => {
      statusNoBanco = "processing";
      return {
        data: {
          id: ID,
          status: "processing",
          updated_at: "2026-11-27T12:00:00.123456+00:00",
        },
        error: null,
      };
    };

    const r = await avancar("processing");

    expect(r.erro).toBeNull();
    expect(r.valor).toEqual({
      gravadoNoBancoEm: "2026-11-27T12:00:00.123456+00:00",
    });
    expect(gravacoes()).toHaveLength(1);
  });

  it("cancelamento pelo painel (pedido sem cobrança online): também devolve a hora do banco", async () => {
    gravacao = async () => {
      statusNoBanco = "cancelled";
      return {
        data: {
          id: ID,
          status: "cancelled",
          updated_at: "2026-11-27T13:00:00Z",
        },
        error: null,
      };
    };

    const r = await avancar("cancelled");

    expect(r.erro).toBeNull();
    expect(
      rpc.mock.calls.some(([nome]) => nome === "cancelar_pedido_do_painel"),
    ).toBe(true);
    expect(r.valor).toEqual({ gravadoNoBancoEm: "2026-11-27T13:00:00Z" });
  });

  it("RPC que responde sem a linha: devolve null (o aviso cai no relógio local)", async () => {
    gravacao = async () => {
      statusNoBanco = "processing";
      return { data: null, error: null };
    };

    const r = await avancar("processing");

    expect(r.erro).toBeNull();
    expect(r.valor).toEqual({ gravadoNoBancoEm: null });
  });

  it("resposta perdida, gravação confirmada pela releitura: devolve null, nunca uma hora inventada", async () => {
    gravacao = () => {
      statusNoBanco = "processing";
      return new Promise(() => {});
    };

    const r = await avancar("processing");

    expect(r.erro).toBeNull();
    expect(r.valor).toEqual({ gravadoNoBancoEm: null });
  });
});

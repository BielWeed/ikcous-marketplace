// @vitest-environment jsdom
/**
 * Lote 553: depois que a edge confirma o cancelamento, o hook fazia uma
 * leitura curta do banco (prazo de 5 s) só para pegar a hora gravada — o
 * carimbo do aviso à cliente — e SÓ ENTÃO devolvia. A ficha do painel
 * (`AdminOrdersView.handleStatusChange`) espera esse retorno para trocar o
 * status: com rede lenta, o toast "Pedido cancelado." já tinha saído e a
 * ficha seguia no status antigo, com o botão em "Processando", por até 5 s.
 *
 * Agora o cancelamento provado devolve na hora; a hora do banco vem DEPOIS,
 * como promessa em `gravadoNoBancoEm`, que só o aviso à cliente espera.
 *
 * Mesma sonda de use-orders-hora-do-banco-quando-a-resposta-nao-traz-a-linha.
 */
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
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
  useAuth: () => ({ user: { id: "usuario-lote-553" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
import { useOrders } from "@/hooks/useOrders";
import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HORA_DO_BANCO = "2026-11-27T12:34:56.789012+00:00";
const ID_ONLINE = "PED-ONLINE-553";

function linha(id: string, status: string) {
  return {
    id,
    status,
    updated_at: "2026-11-27T10:00:00Z",
    created_at: "2026-11-27T09:00:00Z",
    user_id: "cliente-1",
    customer_name: "Cliente Teste",
    items: [],
    payment_method: "online",
    payment_status: "pago",
    cancelled_after_shipping: false,
  };
}
type Resposta = { data: unknown; error: unknown };

let atuais: ReturnType<typeof useOrders>;
let releitura: () => Promise<Resposta>;
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

/** Dispara o cancelamento e avança só `ms` do relógio (a edge responde na
 *  hora). Devolve o estado da chamada nesse instante. */
async function cancelarEAvancar(ms: number) {
  const desfecho = {
    terminou: false,
    erro: null as unknown,
    valor: undefined as unknown,
  };
  await act(async () => {
    atuais.updateOrderStatus(ID_ONLINE, "cancelled").then(
      (valor: unknown) => {
        desfecho.terminou = true;
        desfecho.valor = valor;
      },
      (erro: unknown) => {
        desfecho.terminou = true;
        desfecho.erro = erro;
      },
    );
    await vi.advanceTimersByTimeAsync(ms);
  });
  return desfecho;
}

function horaQueChega(valor: unknown): unknown {
  return (valor as { gravadoNoBancoEm?: unknown } | undefined)
    ?.gravadoNoBancoEm;
}

describe("Cancelar pela edge não segura a ficha esperando a hora do banco", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    releitura = async () => ({
      data: { status: "cancelled", updated_at: HORA_DO_BANCO },
      error: null,
    });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) =>
      nome === "get_admin_orders_paged"
        ? {
            abortSignal: () =>
              Promise.resolve({
                data: {
                  data: [linha(ID_ONLINE, "shipping")],
                  total_count: 1,
                },
                error: null,
              }),
          }
        : { abortSignal: () => Promise.resolve({ data: [], error: null }) },
    );
    from.mockReset();
    from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: () => releitura() }) }),
    }));
    invoke.mockReset();
    invoke.mockImplementation(async () => ({
      data: { cancelamento: "cancelado" },
      error: null,
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
      await vi.advanceTimersByTimeAsync(6000);
    });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("leitura da hora pendurada: o cancelamento devolve na hora e a ficha já mostra cancelado", async () => {
    releitura = () => new Promise(() => {});

    // Bem menos que os 5 s do prazo da leitura.
    const r = await cancelarEAvancar(50);

    // A edge já confirmou (o toast saiu): o que falta é só a chamada voltar.
    expect(toast.success).toHaveBeenCalledWith("Pedido cancelado.");
    expect(r.terminou).toBe(true);
    expect(r.erro).toBeNull();
    expect(atuais.orders.find((o) => o.id === ID_ONLINE)?.status).toBe(
      "cancelled",
    );
    // A hora do banco segue chegando por fora: o prazo curto a encerra vazia.
    const hora = horaQueChega(r.valor);
    expect(hora).toBeInstanceOf(Promise);
    let entregue: unknown = "ainda não";
    (hora as Promise<unknown>).then((h) => {
      entregue = h;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
    });
    expect(entregue).toBeNull();
  });

  it("leitura lenta que responde: a hora do banco chega depois, pela promessa", async () => {
    let responder: (r: Resposta) => void = () => {};
    releitura = () =>
      new Promise((resolver) => {
        responder = resolver;
      });

    const r = await cancelarEAvancar(50);

    expect(r.terminou).toBe(true);
    responder({
      data: { status: "cancelled", updated_at: HORA_DO_BANCO },
      error: null,
    });
    await expect(horaQueChega(r.valor)).resolves.toBe(HORA_DO_BANCO);
  });
});

// @vitest-environment jsdom
//
// A lojista toca em "Avançar" com a tela mostrando "Em Separação". O hook relê
// o status no servidor antes de gravar e acha "Em Trânsito" (outro aparelho
// já avançou): corrige a tela e avisa "Este pedido mudou". Só que, enquanto a
// releitura estava no ar, o outro aparelho FINALIZOU o pedido e o evento de
// tempo real chegou à tela. A resposta da releitura (mais velha que o evento)
// era aplicada por cima e o pedido já "Finalizado" voltava a "Em Trânsito" no
// painel — com o banco certo; só a tela regredia até a próxima leitura.
//
// Regra provada aqui: o status relido só é aplicado se nenhum UPDATE mais novo
// DESSE pedido foi aplicado desde que a releitura começou. O aviso "Este pedido
// mudou" e o `ErroPedidoMudou` não mudam.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, OrderStatus } from "@/types";

const rpc = vi.fn();
let evento: ((payload: unknown) => Promise<void>) | undefined;

/** A releitura fica segurada até o teste soltar (rede lenta). */
let soltarReleitura: ((status: string) => void) | undefined;
let releituraPedida: Promise<void>;
let avisarReleituraPedida: () => void;

function builderDaReleitura() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(() => {
    avisarReleituraPedida();
    return new Promise((resolve) => {
      soltarReleitura = (status: string) =>
        resolve({ data: { status }, error: null });
    });
  });
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
    functions: { invoke: vi.fn() },
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => builderDaReleitura(),
    channel: () => {
      const canal = {
        on: (_tipo: string, _filtro: unknown, handler: typeof evento) => {
          evento = handler;
          return canal;
        },
        subscribe: () => canal,
        unsubscribe: () => {},
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "fila-do-pedido"),
    dismiss: vi.fn(),
  },
}));

const usuarioAdmin = { id: "lojista-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAdmin, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const T0 = "2026-11-13T10:00:00Z";
const T_ANTES = "2026-11-13T09:00:00Z";
const T_DEPOIS = "2026-11-13T11:00:00Z";

function linha(id: string, status: OrderStatus, updated_at = T0) {
  return {
    id,
    status,
    payment_status: "pago",
    customer_name: "Cliente Teste",
    created_at: "2026-11-13T08:00:00Z",
    updated_at,
    items: [],
  };
}

let host: HTMLDivElement;
let raiz: Root;
let onLineOriginal: boolean;

type Sonda = {
  pegarOrders: () => Order[];
  avancar: (id: string, status: OrderStatus) => Promise<unknown>;
};

async function montarSonda(
  pedidos: ReturnType<typeof linha>[],
): Promise<Sonda> {
  rpc.mockImplementation((nome: string) => {
    if (nome === "get_admin_orders_paged") {
      return {
        abortSignal: () =>
          Promise.resolve({
            data: { data: pedidos, total_count: pedidos.length },
            error: null,
          }),
      };
    }
    return Promise.resolve({ error: null });
  });
  const { useOrders } = await import("@/hooks/useOrders");
  let ordersAtuais: Order[] = [];
  let update: (id: string, status: OrderStatus) => Promise<void> =
    async () => {};
  let carregar: (
    page?: number,
    pageSize?: number,
    statusFilter?: string,
  ) => Promise<unknown> = async () => ({});
  function Componente() {
    const { orders, updateOrderStatus, loadOrders } = useOrders(true, true);
    useEffect(() => {
      ordersAtuais = orders;
      update = (id, status) => updateOrderStatus(id, status);
      carregar = loadOrders;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Componente />);
  });
  await act(async () => {
    await carregar(0, 20, "all");
  });
  expect(evento).toBeDefined();
  return {
    pegarOrders: () => ordersAtuais,
    avancar: (id, status) =>
      update(id, status).then(
        () => undefined,
        (erro: unknown) => erro,
      ),
  };
}

async function emitir(nova: ReturnType<typeof linha>) {
  await act(async () => {
    await evento!({ eventType: "UPDATE", new: nova, old: { id: nova.id } });
  });
}

/** Toca em Avançar e devolve a promessa do toque (embrulhada: uma promessa
 * devolta direto seria esperada pelo `await`), com a releitura já no ar. */
async function tocarEEsperarAReleitura(sonda: Sonda, id: string) {
  releituraPedida = new Promise<void>((resolve) => {
    avisarReleituraPedida = resolve;
  });
  let desfecho!: Promise<unknown>;
  await act(async () => {
    desfecho = sonda.avancar(id, "shipping");
    await releituraPedida;
  });
  return { desfecho };
}

async function soltar(status: string) {
  await act(async () => {
    soltarReleitura?.(status);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("updateOrderStatus (admin) — releitura atrasada não desfaz evento mais novo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    evento = undefined;
    soltarReleitura = undefined;
    const armazem = new Map<string, string>();
    onLineOriginal = navigator.onLine;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
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
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      // Libera o canal compartilhado antes do próximo teste.
      await vi.advanceTimersByTimeAsync(4001);
    });
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => onLineOriginal,
    });
  });

  const statusNaTela = (sonda: Sonda, id = "p1") =>
    sonda.pegarOrders().find((o) => o.id === id)?.status;

  it("controle: sem nada no meio, a tela passa para o status que o servidor tem", async () => {
    const { ErroPedidoMudou } = await import("@/hooks/useOrders");
    const sonda = await montarSonda([linha("p1", "processing")]);
    const { desfecho } = await tocarEEsperarAReleitura(sonda, "p1");
    await soltar("shipping");
    expect(await desfecho).toBeInstanceOf(ErroPedidoMudou);
    expect(statusNaTela(sonda)).toBe("shipping");
  });

  it("o pedido foi finalizado por outro aparelho durante a releitura: continua 'delivered', mesmo com o aviso e o erro de sempre", async () => {
    const { ErroPedidoMudou } = await import("@/hooks/useOrders");
    const sonda = await montarSonda([linha("p1", "processing")]);
    const { desfecho } = await tocarEEsperarAReleitura(sonda, "p1");

    await emitir(linha("p1", "delivered", T_DEPOIS));
    expect(statusNaTela(sonda)).toBe("delivered");

    await soltar("shipping");
    const erro = await desfecho;
    // O fluxo de aviso e o erro tipado não mudam...
    expect(erro).toBeInstanceOf(ErroPedidoMudou);
    expect(
      (erro as InstanceType<typeof ErroPedidoMudou>).statusVerdadeiro,
    ).toBe("shipping");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toContain(
      "Este pedido mudou",
    );
    // ...mas a tela não volta para o status velho.
    expect(statusNaTela(sonda)).toBe("delivered");
  });

  it("borda: evento de OUTRO pedido durante a releitura não impede a correção deste", async () => {
    const sonda = await montarSonda([
      linha("p1", "processing"),
      linha("p2", "pending"),
    ]);
    const { desfecho } = await tocarEEsperarAReleitura(sonda, "p1");
    await emitir(linha("p2", "processing", T_DEPOIS));
    await soltar("shipping");
    await desfecho;
    expect(statusNaTela(sonda, "p1")).toBe("shipping");
    expect(statusNaTela(sonda, "p2")).toBe("processing");
  });

  it("borda: evento ATRASADO (mais antigo que a tela) durante a releitura é descartado pela lista e não conta como mais novo", async () => {
    const sonda = await montarSonda([linha("p1", "processing")]);
    const { desfecho } = await tocarEEsperarAReleitura(sonda, "p1");
    await emitir(linha("p1", "pending", T_ANTES));
    expect(statusNaTela(sonda)).toBe("processing");
    await soltar("shipping");
    await desfecho;
    expect(statusNaTela(sonda)).toBe("shipping");
  });

  it("borda: evento que chegou ANTES de a releitura começar não bloqueia a correção", async () => {
    const sonda = await montarSonda([linha("p1", "processing")]);
    await emitir(linha("p1", "processing", T_DEPOIS));
    const { desfecho } = await tocarEEsperarAReleitura(sonda, "p1");
    await soltar("shipping");
    await desfecho;
    expect(statusNaTela(sonda)).toBe("shipping");
  });
});

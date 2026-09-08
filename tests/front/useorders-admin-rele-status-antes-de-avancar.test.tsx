// @vitest-environment jsdom
//
// L-9 front (brief `lider-avancar-rele-o-pedido-0809`, 08/09/2026): a
// lojista está com a ficha do pedido aberta mostrando "Preparando"; o
// cliente cancela pelo app nesse instante; a lojista clica "Avançar" com a
// tela velha. Antes desta correção, `updateOrderStatus` (useOrders.ts)
// chamava a RPC `update_order_status_atomic` direto, sem conferir se o
// status em memória ainda batia com o do servidor — a RPC não valida o
// status ANTIGO para admin (só restringe destino para não-admin), então o
// pedido cancelado voltava a vivo.
//
// Este arquivo prova o HOOK de verdade (não um dublê) via uma sonda —
// mesmo padrão de cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx
// e pedidos-offline-toast-honesto.test.tsx: este projeto não tem
// @testing-library/react, então o hook se alcança por um componente que
// expõe `orders`/`updateOrderStatus` por efeito.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, OrderStatus } from "@/types";

const rpc = vi.fn();
const from = vi.fn();

/** Controla o que a releitura (`select("status").eq("id", …).single()`)
 * devolve — cada teste ajusta antes de chamar `updateOrderStatus`. */
let respostaDaReleitura: { data: { status: string } | null; error: unknown };

function builderDaReleitura() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve(respostaDaReleitura));
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc,
    from: (...args: unknown[]) => from(...args),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const usuarioAdmin = { id: "lojista-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAdmin, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(status: OrderStatus): Order {
  return {
    id: "pedido-1",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status,
    paymentStatus: "pago",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
  };
}

/** Linha crua mínima que `mapOrderFromDB` aceita — mesmo padrão de
 * `linhaCanceladaFake` em cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx. */
function linhaCrua(pedido: Order) {
  return {
    id: pedido.id,
    status: pedido.status,
    created_at: pedido.createdAt,
    updated_at: pedido.updatedAt,
  };
}

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;
let onLineOriginal: boolean;

type AtualizaStatus = (
  id: string,
  status: OrderStatus,
  notes?: string,
  silent?: boolean,
) => Promise<void>;

let linhasParaCarga: unknown[] = [];
let chamadasUpdateOrderStatus: any[] = [];

/** Instala um `rpc` que sempre sabe responder `get_admin_orders_paged` (com
 * `linhasParaCarga`, ajustável por teste) e delega `update_order_status_atomic`
 * a `handlerUpdate` — evita a fragilidade de `mockImplementationOnce`
 * quando `fetchPedidosCancelados` dispara uma SEGUNDA chamada de
 * `get_admin_orders_paged` depois de um cancelamento bem-sucedido
 * (critério 4: a RPC de cancelar É chamada, e o sucesso dela recarrega o
 * balde de cancelados — comportamento de produção, não algo que este
 * arquivo testa, mas que não pode derrubar o teste por um mock incompleto). */
function instalarRpc(
  handlerUpdate: (args: any) => Promise<{ error: unknown }> = async () => ({
    error: null,
  }),
) {
  chamadasUpdateOrderStatus = [];
  rpc.mockImplementation((nome: string, args: any) => {
    if (nome === "get_admin_orders_paged") {
      return {
        abortSignal: () =>
          Promise.resolve({
            data: {
              data: linhasParaCarga,
              total_count: linhasParaCarga.length,
            },
            error: null,
          }),
      };
    }
    if (nome === "update_order_status_atomic") {
      chamadasUpdateOrderStatus.push(args);
      return handlerUpdate(args);
    }
    return Promise.resolve({ error: null });
  });
}

/** Monta a sonda ADMIN (`enabled=true, isAdmin=true` — mesma combinação de
 * `montarSondaAdmin` em cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx)
 * e carrega `pedido` pelo caminho REAL que o hook expõe (`loadOrders`, RPC
 * `get_admin_orders_paged`) — nunca por injeção direta no módulo. Uma
 * chamada de `loadOrders` dispara um re-render (o `useEffect` da sonda
 * roda de novo e rebina `update`/`ordersAtuais` à closure NOVA, fechada
 * sobre o `orders` que acabou de chegar — mesmo motivo do docstring de
 * `montarSondaAdmin` no arquivo de referência: `updateOrderStatus` tem
 * `orders` nas próprias dependências). */
async function montarSondaAdmin(pedido: Order): Promise<{
  pegarOrders: () => Order[];
  updateOrderStatus: AtualizaStatus;
}> {
  linhasParaCarga = [linhaCrua(pedido)];

  const { useOrders: useOrdersImportado } = await import("@/hooks/useOrders");

  let ordersAtuais: Order[] = [];
  let update: AtualizaStatus = async () => {};
  let carregar: (
    page?: number,
    pageSize?: number,
    statusFilter?: string,
  ) => Promise<{ orders: Order[]; total: number }> = async () => ({
    orders: [],
    total: 0,
  });

  function Sonda() {
    const { orders, updateOrderStatus, loadOrders } = useOrdersImportado(
      true,
      true,
    );
    useEffect(() => {
      ordersAtuais = orders;
      update = updateOrderStatus;
      carregar = loadOrders;
    });
    return null;
  }

  await act(async () => {
    raiz.render(<Sonda />);
  });

  await act(async () => {
    await carregar(0, 20, "open");
  });

  return {
    pegarOrders: () => ordersAtuais,
    updateOrderStatus: (id, status, notes, silent) =>
      update(id, status, notes, silent),
  };
}

describe("updateOrderStatus (admin) relê o status no servidor antes de gravar — L-9 front", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    from.mockImplementation(() => builderDaReleitura());
    respostaDaReleitura = { data: { status: "processing" }, error: null };
    instalarRpc();
    armazem = new Map();
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
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.info).mockClear();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => onLineOriginal,
    });
  });

  it("critério 1 — servidor devolve status DIFERENTE (cancelled): a RPC não é chamada, o estado local vira 'cancelled', toast de aviso com 'Cancelado', e a função rejeita com o erro tipado", async () => {
    const { ErroPedidoMudou } = await import("@/hooks/useOrders");
    respostaDaReleitura = { data: { status: "cancelled" }, error: null };

    const { pegarOrders, updateOrderStatus } = await montarSondaAdmin(
      pedidoFake("processing"),
    );

    let erroCapturado: unknown;
    await act(async () => {
      try {
        await updateOrderStatus("pedido-1", "shipping");
      } catch (e) {
        erroCapturado = e;
      }
    });

    expect(erroCapturado).toBeInstanceOf(ErroPedidoMudou);
    expect(chamadasUpdateOrderStatus).toHaveLength(0);
    expect(pegarOrders().find((o) => o.id === "pedido-1")?.status).toBe(
      "cancelled",
    );
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toContain(
      "Cancelado",
    );
    // A armadilha (item 2 do brief): nenhum toast.error empilhado por cima.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("critério 2 — servidor CONFIRMA o status em memória (processing): a RPC é chamada uma vez com p_new_status/p_silent corretos, comportamento de hoje preservado", async () => {
    respostaDaReleitura = { data: { status: "processing" }, error: null };

    const { updateOrderStatus } = await montarSondaAdmin(
      pedidoFake("processing"),
    );

    await act(async () => {
      await updateOrderStatus("pedido-1", "shipping", undefined, true);
    });

    expect(chamadasUpdateOrderStatus).toHaveLength(1);
    expect(chamadasUpdateOrderStatus[0]).toMatchObject({
      p_order_id: "pedido-1",
      p_new_status: "shipping",
      p_silent: true,
    });
  });

  it("critério 3 — a releitura FALHA (erro de rede/RLS): a RPC não é chamada, sem update otimista, toast avisando que não conseguiu conferir", async () => {
    respostaDaReleitura = {
      data: null,
      error: { message: "Failed to fetch" },
    };

    const { pegarOrders, updateOrderStatus } = await montarSondaAdmin(
      pedidoFake("processing"),
    );

    const { ErroReleituraDeStatusFalhou } = await import("@/hooks/useOrders");
    let erroCapturado: unknown;
    await act(async () => {
      try {
        await updateOrderStatus("pedido-1", "shipping");
      } catch (e) {
        erroCapturado = e;
      }
    });

    expect(erroCapturado).toBeInstanceOf(ErroReleituraDeStatusFalhou);
    expect(chamadasUpdateOrderStatus).toHaveLength(0);
    // "Não sei" nunca vira "pode avançar": o status em memória continua
    // 'processing', o clique não mudou nada.
    expect(pegarOrders().find((o) => o.id === "pedido-1")?.status).toBe(
      "processing",
    );
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toContain(
      "conferir",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("critério 4 — admin CANCELANDO: sem releitura (o servidor já guarda esse caminho) — `from` não é chamado, a RPC é chamada normalmente", async () => {
    const { updateOrderStatus } = await montarSondaAdmin(
      pedidoFake("processing"),
    );
    from.mockClear();

    await act(async () => {
      await updateOrderStatus("pedido-1", "cancelled");
    });

    expect(from).not.toHaveBeenCalled();
    expect(chamadasUpdateOrderStatus).toHaveLength(1);
    expect(chamadasUpdateOrderStatus[0]).toMatchObject({
      p_new_status: "cancelled",
    });
  });

  it("critério 6 — offline: cai na fila do localStorage como hoje, sem releitura (`from` não é chamado, RPC não é chamada)", async () => {
    const { updateOrderStatus } = await montarSondaAdmin(
      pedidoFake("processing"),
    );
    from.mockClear();
    chamadasUpdateOrderStatus = [];

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });

    await act(async () => {
      await updateOrderStatus("pedido-1", "shipping");
    });

    expect(from).not.toHaveBeenCalled();
    expect(chamadasUpdateOrderStatus).toHaveLength(0);
    const fila = JSON.parse(
      armazem.get("orders_offline_updates_queue") || "[]",
    );
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ orderId: "pedido-1", status: "shipping" });
    expect(toast.info).toHaveBeenCalledTimes(1);
  });
});

describe("updateOrderStatus (CLIENTE, isAdmin=false) cancelando — sem releitura, como hoje", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    from.mockImplementation(() => builderDaReleitura());
    respostaDaReleitura = { data: { status: "processing" }, error: null };
    instalarRpc();
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

  it("critério 5 — cliente cancela o próprio pedido: `from` não é chamado (o guard só entra para admin), a RPC é chamada", async () => {
    armazem.set(
      "ikcous_orders_cache_lojista-1",
      JSON.stringify([pedidoFake("processing")]),
    );

    const { useOrders } = await import("@/hooks/useOrders");
    let update: AtualizaStatus = async () => {};
    function SondaCliente() {
      const { updateOrderStatus } = useOrders(false, false);
      useEffect(() => {
        update = updateOrderStatus;
      });
      return null;
    }
    await act(async () => {
      raiz.render(<SondaCliente />);
    });

    await act(async () => {
      await update("pedido-1", "cancelled");
    });

    expect(from).not.toHaveBeenCalled();
    expect(chamadasUpdateOrderStatus).toHaveLength(1);
  });
});

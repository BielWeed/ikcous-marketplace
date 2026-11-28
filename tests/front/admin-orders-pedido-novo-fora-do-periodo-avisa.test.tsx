// @vitest-environment jsdom
//
// O período de datas da lista de Pedidos fica salvo no aparelho e não vence.
// Às 23:40 a lojista filtra o dia 27/11; à meia-noite entram pedidos do dia
// 28. O aviso "Novo pedido recebido!" saía, mas o pedido não entrava na lista
// (fora do período) e o F5 não resolvia: parecia travado. Agora o aviso de um
// pedido fora do período diz por que ele não aparece e traz "Ver todos", que
// limpa as datas. A regra de QUANDO avisar não muda, e o período nunca é
// apagado sozinho. Casco no molde de painel-aviso-de-pedido-atualizado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const ID_DO_PEDIDO = "pedido-c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";

const { eventoRealtime } = vi.hoisted(() => ({
  eventoRealtime: {
    atual: undefined as ((payload: unknown) => void) | undefined,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

vi.mock("@/hooks/useNumerosDosPedidos", () => ({
  useNumerosDosPedidos: () => ({
    paraPreparar: null,
    aguardandoPagamento: null,
    aCaminho: null,
    abertosComPagamentoAConferir: null,
    pedirRecarga: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrders", async () => {
  const { ErroPedidoMudou } =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ErroPedidoMudou,
    useOrders: (
      _ativo: boolean,
      _admin: boolean,
      opcoes?: { onRealtimeEvent?: (payload: unknown) => void },
    ) => {
      eventoRealtime.atual = opcoes?.onRealtimeEvent;
      return {
        orders: [] as Order[],
        loadOrders: vi.fn(async () => ({ orders: [], total: 0 })),
        updateOrderStatus: vi.fn(async () => {}),
        totalOrders: 0,
        isLoaded: true,
        loading: false,
      };
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorQueNaoObserva {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// 00:10 de 28/11 em Brasília (03:10 em UTC): fora do dia 27/11.
const DO_DIA_28 = "2026-11-28T03:10:00.000Z";
// 23:50 de 27/11 em Brasília (02:50 do dia 28 em UTC): DENTRO do dia 27/11.
const DO_DIA_27_A_NOITE = "2026-11-28T02:50:00.000Z";

describe("Pedidos — aviso de pedido novo fora do período filtrado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.stubGlobal("ResizeObserver", ObservadorQueNaoObserva);
    vi.stubGlobal("IntersectionObserver", ObservadorQueNaoObserva);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montarComPeriodo(start: string, end: string) {
    armazem.set("admin_orders_date_range", JSON.stringify({ start, end }));
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperar(20);
    });
    vi.mocked(toast.info).mockClear();
  }

  function chegaPedido(criadoEm: string) {
    return act(async () => {
      eventoRealtime.atual?.({
        eventType: "INSERT",
        new: {
          id: ID_DO_PEDIDO,
          status: "pending",
          canal: "online",
          payment_method: "pix",
          payment_status: "pago",
          created_at: criadoEm,
        },
      });
    });
  }

  it("pedido fora do período: o aviso diz por que ele não aparece e oferece 'Ver todos'", async () => {
    await montarComPeriodo("2026-11-27", "2026-11-27");

    await chegaPedido(DO_DIA_28);

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "Novo pedido recebido! #3884BE. Ele não aparece na lista porque você está vendo só os pedidos de 27/11.",
      expect.objectContaining({
        duration: 10_000,
        action: expect.objectContaining({ label: "Ver todos" }),
      }),
    );
  });

  it("'Ver todos' limpa as datas, e o período só sai pelo clique", async () => {
    await montarComPeriodo("2026-11-27", "2026-11-27");
    await chegaPedido(DO_DIA_28);

    // O aviso sozinho não apaga o período.
    expect(JSON.parse(armazem.get("admin_orders_date_range") ?? "{}")).toEqual({
      start: "2026-11-27",
      end: "2026-11-27",
    });

    const opcoes = vi.mocked(toast.info).mock.calls[0][1] as unknown as {
      action: { onClick: () => void };
    };
    await act(async () => {
      opcoes.action.onClick();
    });

    expect(JSON.parse(armazem.get("admin_orders_date_range") ?? "{}")).toEqual({
      start: "",
      end: "",
    });
    expect(armazem.get("admin_orders_current_page")).toBe("0");
  });

  it.each([
    ["2026-11-20", "2026-11-27", "de 20/11 a 27/11"],
    ["2026-11-27", "", "a partir de 27/11"],
    ["", "2026-11-27", "até 27/11"],
  ])(
    "período %s – %s fala do recorte do jeito que a lojista o montou",
    async (inicio, fim, trecho) => {
      // Antes do início ou depois do fim: fora do período nos três casos.
      const criadoEm = inicio ? "2026-11-10T15:00:00.000Z" : DO_DIA_28;
      await montarComPeriodo(inicio, fim);

      await chegaPedido(criadoEm);

      expect(toast.info).toHaveBeenCalledWith(
        `Novo pedido recebido! #3884BE. Ele não aparece na lista porque você está vendo só os pedidos ${trecho}.`,
        expect.objectContaining({
          action: expect.objectContaining({ label: "Ver todos" }),
        }),
      );
    },
  );

  it("pedido dentro do período: continua o aviso de sempre, com 'Ver'", async () => {
    await montarComPeriodo("2026-11-27", "2026-11-27");

    await chegaPedido(DO_DIA_27_A_NOITE);

    expect(toast.info).toHaveBeenCalledWith(
      "Novo pedido recebido! #3884BE",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Ver" }),
      }),
    );
  });

  it("sem período filtrado: o aviso de sempre", async () => {
    await montarComPeriodo("", "");

    await chegaPedido(DO_DIA_28);

    expect(toast.info).toHaveBeenCalledWith(
      "Novo pedido recebido! #3884BE",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Ver" }),
      }),
    );
  });
});

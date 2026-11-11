// @vitest-environment jsdom
//
// r136-d: o CANCELAMENTO enfileirado offline era reenviado ao reconectar SEM
// conferir a etapa que a lojista via ao cancelar. Se outro aparelho entregou o
// pedido nesse meio-tempo, o cancelamento velho entrava: `update_order_status_atomic`
// deixa o admin cancelar de qualquer etapa e, de `delivered` não presencial,
// carimba `cancelled_after_shipping`. O avanço enfileirado já relê o servidor e
// compara com `statusEsperado`; o cancelamento agora faz o mesmo — e a fila
// legada (item sem `statusEsperado`, já gravada no aparelho) continua saindo
// como antes.
import { useOrders } from "@/hooks/useOrders";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ data: null; error: unknown }>>(),
);
const fromMock = vi.hoisted(() => vi.fn());

/** Status devolvido pela releitura, por pedido (`.eq("id", …)`). */
let releituraPorPedido: Map<
  string,
  { data: { status: string } | null; error: unknown }
>;

function builderDaReleitura() {
  let id = "";
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((_coluna: string, valor: string) => {
    id = valor;
    return builder;
  });
  builder.single = vi.fn(() =>
    Promise.resolve(
      releituraPorPedido.get(id) ?? {
        data: { status: "processing" },
        error: null,
      },
    ),
  );
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
    rpc: rpcMock,
    from: (...args: unknown[]) => fromMock(...args),
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
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão do projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const chave = "orders_offline_updates_queue:lojista-1";
const toastId = "sincronizacao-fila-offline";
const MENSAGEM_DE_DESCARTE =
  "Fila de pedidos atualizada. Algumas alterações não se aplicam mais ao estado atual dos pedidos.";

function cancelamento(orderId: string, statusEsperado?: string) {
  return {
    orderId,
    status: "cancelled",
    silent: false,
    ...(statusEsperado === undefined ? {} : { statusEsperado }),
    timestamp: 1,
  };
}

function Sonda() {
  useOrders(true, true);
  return null;
}

describe("useOrders — cancelamento offline confere a etapa antes de enviar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const armazenamento = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => armazenamento.get(key) ?? null,
      setItem: (key: string, value: string) => armazenamento.set(key, value),
      removeItem: (key: string) => armazenamento.delete(key),
      clear: () => armazenamento.clear(),
    });
    localStorage.clear();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    fromMock.mockReset();
    fromMock.mockImplementation(() => builderDaReleitura());
    releituraPorPedido = new Map();
    vi.mocked(toast.loading).mockReturnValue(toastId);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function montar() {
    await act(async () => {
      raiz.render(<Sonda />);
    });
  }

  async function reconectar() {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(1000);
    });
  }

  it.each(["delivered", "shipping", "cancelled"])(
    "descarta o cancelamento quando o pedido já está %s no servidor (a lojista via 'processing')",
    async (statusAtual) => {
      releituraPorPedido.set("pedido-A", {
        data: { status: statusAtual },
        error: null,
      });
      localStorage.setItem(
        chave,
        JSON.stringify([cancelamento("pedido-A", "processing")]),
      );

      await montar();
      await reconectar();

      // O que dói: o cancelamento velho NUNCA chega à RPC.
      expect(rpcMock).not.toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalledWith("marketplace_orders");
      expect(localStorage.getItem(chave)).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith(MENSAGEM_DE_DESCARTE, {
        id: toastId,
      });

      // Idempotência: reconectar de novo não reenvia nada (item já saiu).
      await reconectar();
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it("controle: com o servidor ainda em 'processing', envia o cancelamento", async () => {
    releituraPorPedido.set("pedido-A", {
      data: { status: "processing" },
      error: null,
    });
    localStorage.setItem(
      chave,
      JSON.stringify([cancelamento("pedido-A", "processing")]),
    );

    await montar();
    await reconectar();

    expect(fromMock).toHaveBeenCalledWith("marketplace_orders");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("update_order_status_atomic", {
      p_order_id: "pedido-A",
      p_new_status: "cancelled",
      p_notes: null,
      p_silent: false,
    });
    expect(localStorage.getItem(chave)).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      "Todas as atualizações de status de pedidos foram sincronizadas!",
      { id: toastId },
    );
  });

  it("compatibilidade: item SEM statusEsperado (fila já gravada) segue sendo enviado, sem releitura", async () => {
    // Mesmo com o servidor em 'delivered', o item legado sai como hoje: a
    // fila antiga não sabe qual etapa a lojista via.
    releituraPorPedido.set("pedido-A", {
      data: { status: "delivered" },
      error: null,
    });
    localStorage.setItem(chave, JSON.stringify([cancelamento("pedido-A")]));

    await montar();
    await reconectar();

    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("update_order_status_atomic", {
      p_order_id: "pedido-A",
      p_new_status: "cancelled",
      p_notes: null,
      p_silent: false,
    });
    expect(localStorage.getItem(chave)).toBeNull();
  });

  it("limite: cancelar de propósito um pedido que a lojista via 'delivered' continua valendo quando o servidor ainda está 'delivered'", async () => {
    releituraPorPedido.set("pedido-A", {
      data: { status: "delivered" },
      error: null,
    });
    localStorage.setItem(
      chave,
      JSON.stringify([cancelamento("pedido-A", "delivered")]),
    );

    await montar();
    await reconectar();

    expect(rpcMock).toHaveBeenCalledWith("update_order_status_atomic", {
      p_order_id: "pedido-A",
      p_new_status: "cancelled",
      p_notes: null,
      p_silent: false,
    });
    expect(localStorage.getItem(chave)).toBeNull();
  });

  it("limite: releitura falhou — o cancelamento NÃO sai e fica na fila (não sei nunca vira pode cancelar)", async () => {
    releituraPorPedido.set("pedido-A", {
      data: null,
      error: { message: "Failed to fetch" },
    });
    const item = cancelamento("pedido-A", "processing");
    localStorage.setItem(chave, JSON.stringify([item]));

    await montar();
    await reconectar();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(chave) ?? "null")).toEqual([item]);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("limite: releitura sem linha — o cancelamento NÃO sai e fica na fila", async () => {
    releituraPorPedido.set("pedido-A", { data: null, error: null });
    const item = cancelamento("pedido-A", "processing");
    localStorage.setItem(chave, JSON.stringify([item]));

    await montar();
    await reconectar();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(chave) ?? "null")).toEqual([item]);
  });

  it("fila mista: o descarte de um pedido não derruba o cancelamento válido de outro", async () => {
    releituraPorPedido.set("pedido-A", {
      data: { status: "delivered" },
      error: null,
    });
    releituraPorPedido.set("pedido-B", {
      data: { status: "pending" },
      error: null,
    });
    localStorage.setItem(
      chave,
      JSON.stringify([
        cancelamento("pedido-A", "processing"),
        cancelamento("pedido-B", "pending"),
      ]),
    );

    await montar();
    await reconectar();

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "update_order_status_atomic",
      expect.objectContaining({ p_order_id: "pedido-B" }),
    );
    expect(localStorage.getItem(chave)).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(MENSAGEM_DE_DESCARTE, {
      id: toastId,
    });
  });
});

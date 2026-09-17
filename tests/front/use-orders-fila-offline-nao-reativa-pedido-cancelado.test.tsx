// @vitest-environment jsdom
//
// useOrders-196: a fila offline aplicava um AVANÇO de status por cima de um
// cancelamento feito nesse meio-tempo. `update_order_status_atomic` não
// valida a transição para admin (só restringe destino para NÃO-admin —
// migration 2026110000000, mesma regra de `validateStatusUpdate` acima no
// próprio arquivo), então "pending -> processing" enfileirado offline
// REATIVAVA um pedido que o cliente cancelou enquanto a lojista estava sem
// rede — com o estoque já devolvido por `devolver_estoque` e nenhum aviso
// além de "sincronizadas!". A correção relê o status do pedido no servidor
// ANTES de aplicar cada item de AVANÇO da fila (mesma regra do L-9 em
// `updateOrderStatus`, alguns milhares de linhas abaixo) e descarta o item —
// reaproveitando o MESMO toast honesto que a RPC já usa para descartes
// terminais — quando o pedido já está cancelled/delivered. Cancelar
// (status === "cancelled") fica de fora da releitura: não reativa nada e já
// é o caminho terminal guardado pela própria RPC do lado não-admin.
import { useOrders } from "@/hooks/useOrders";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ data: null; error: unknown }>>(),
);
const fromMock = vi.hoisted(() => vi.fn());

/** Controla o que a releitura (`select("status").eq("id", …).single()`)
 * devolve — cada teste ajusta antes de reconectar. */
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

const chave = "orders_offline_updates_queue";
const toastId = "sincronizacao-fila-offline";
const itemDeAvanco = {
  orderId: "pedido-A",
  status: "processing",
  silent: false,
  timestamp: 1,
};

function Sonda({ enabled = true }: { enabled?: boolean }) {
  useOrders(enabled, true);
  return null;
}

describe("useOrders — a fila offline não reativa pedido cancelado/entregue", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
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
    respostaDaReleitura = { data: { status: "pending" }, error: null };
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

  it.each(["cancelled", "delivered"])(
    "descarta o avanço enfileirado quando o pedido já está %s no servidor",
    async (statusAtual) => {
      respostaDaReleitura = { data: { status: statusAtual }, error: null };
      localStorage.setItem(chave, JSON.stringify([itemDeAvanco]));

      await montar();
      await reconectar();

      // A releitura aconteceu — mas a RPC NUNCA foi chamada: sem isto, o
      // teste passaria mesmo se alguém apagasse a checagem e a RPC apenas
      // recusasse (o que ela não faz, para admin).
      expect(fromMock).toHaveBeenCalledWith("marketplace_orders");
      expect(rpcMock).not.toHaveBeenCalled();
      expect(localStorage.getItem(chave)).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith(
        "Fila de pedidos atualizada. Algumas alterações não se aplicam mais ao estado atual dos pedidos.",
        { id: toastId },
      );
    },
  );

  it("aplica o avanço normalmente quando o pedido continua aberto", async () => {
    respostaDaReleitura = { data: { status: "pending" }, error: null };
    localStorage.setItem(chave, JSON.stringify([itemDeAvanco]));

    await montar();
    await reconectar();

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("update_order_status_atomic", {
      p_order_id: "pedido-A",
      p_new_status: "processing",
      p_notes: null,
      p_silent: false,
    });
    expect(localStorage.getItem(chave)).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      "Todas as atualizações de status de pedidos foram sincronizadas!",
      { id: toastId },
    );
  });

  it("cancelar pela fila não relê o servidor (não reativa nada, RPC já guarda esse caminho)", async () => {
    const itemDeCancelamento = {
      orderId: "pedido-B",
      status: "cancelled",
      silent: false,
      timestamp: 1,
    };
    localStorage.setItem(chave, JSON.stringify([itemDeCancelamento]));

    await montar();
    await reconectar();

    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("update_order_status_atomic", {
      p_order_id: "pedido-B",
      p_new_status: "cancelled",
      p_notes: null,
      p_silent: false,
    });
  });

  it("não confirmando o status atual, mantém o item na fila para tentar de novo (não sei nunca vira pode avançar)", async () => {
    respostaDaReleitura = { data: null, error: { message: "Failed to fetch" } };
    localStorage.setItem(chave, JSON.stringify([itemDeAvanco]));

    await montar();
    await reconectar();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(chave) ?? "null")).toEqual([
      itemDeAvanco,
    ]);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

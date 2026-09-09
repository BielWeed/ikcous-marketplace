// @vitest-environment jsdom
import { mesclarFilaOfflineAposPassada, useOrders } from "@/hooks/useOrders";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() =>
  vi.fn<
    (
      nome: string,
      parametros: unknown,
    ) => Promise<{ data: null; error: unknown }>
  >(),
);
const { authState, fromMock, adminOrdersMock, channelMock } = vi.hoisted(() => {
  const consulta = Object.assign(
    Promise.resolve({ data: [], error: null, count: 0 }),
    {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
    },
  );
  return {
    authState: { user: null as { id: string } | null, isAdmin: false },
    fromMock: vi.fn(() => consulta),
    adminOrdersMock: vi.fn((_parametros: unknown) =>
      Object.assign(
        Promise.resolve({ data: { data: [], total_count: 0 }, error: null }),
        { abortSignal: vi.fn().mockReturnThis() },
      ),
    ),
    channelMock: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, parametros: unknown) =>
      nome === "get_admin_orders_paged"
        ? adminOrdersMock(parametros)
        : rpcMock(nome, parametros),
    from: fromMock,
    channel: channelMock,
    removeChannel: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
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
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão do projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const chave = "orders_offline_updates_queue";
const toastId = "sincronizacao-fila-offline";
const item1 = {
  orderId: "pedido-1",
  status: "cancelled",
  silent: false,
  timestamp: 1,
};

function Sonda({ enabled = true }: { enabled?: boolean }) {
  useOrders(enabled, authState.isAdmin);
  return null;
}

function rpcPendente() {
  let concluir: (resultado: { data: null; error: unknown }) => void = () => {};
  const promessa = new Promise<{ data: null; error: unknown }>((resolve) => {
    concluir = resolve;
  });
  return { promessa, concluir };
}

describe("mescla da fila offline após uma passada", () => {
  it("preserva o item novo e remove apenas a versão processada", () => {
    const novo = { ...item1, orderId: "pedido-2" };
    expect(
      mesclarFilaOfflineAposPassada(
        [item1, novo],
        new Map([[item1.orderId, 1]]),
        [],
      ),
    ).toEqual([novo]);
  });

  it("preserva a versão mais nova do mesmo pedido", () => {
    const novo = { ...item1, timestamp: 2, notes: "nova alteração" };
    expect(
      mesclarFilaOfflineAposPassada([novo], new Map([[item1.orderId, 1]]), []),
    ).toEqual([novo]);
  });

  it.each([undefined, null, {}, "JSON quebrado", 42])(
    "recupera a reserva se a fila fresca for inválida: %j",
    (filaFresca) => {
      expect(
        mesclarFilaOfflineAposPassada(filaFresca, new Map(), [item1]),
      ).toEqual([item1]);
    },
  );

  it("respeita fila vazia válida e ignora itens sem orderId string", () => {
    expect(mesclarFilaOfflineAposPassada([], new Map(), [item1])).toEqual([]);
    expect(
      mesclarFilaOfflineAposPassada(
        [null, undefined, 3, {}, { orderId: 1 }, item1],
        new Map(),
        [],
      ),
    ).toEqual([item1]);
  });

  it("remove versões processadas iguais, antigas ou sem timestamp numérico", () => {
    expect(
      mesclarFilaOfflineAposPassada(
        [
          item1,
          { ...item1, timestamp: 0 },
          { ...item1, timestamp: undefined },
          { ...item1, timestamp: "2" },
        ],
        new Map([[item1.orderId, 1]]),
        [],
      ),
    ).toEqual([]);
  });

  it("preserva a versão fresca de uma falha transitória", () => {
    const novo = {
      ...item1,
      notes: "atualizada durante a falha",
      timestamp: 2,
    };
    expect(mesclarFilaOfflineAposPassada([novo], new Map(), [item1])).toEqual([
      novo,
    ]);
  });
});

describe("useOrders — a fila offline não engole item novo", () => {
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
    authState.user = null;
    authState.isAdmin = false;
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
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

  it.each([false, true])(
    "recarrega a lista após descarte terminal sem escrita no banco (admin: %s)",
    async (isAdmin) => {
      authState.user = { id: "cliente-1" };
      authState.isAdmin = isAdmin;
      localStorage.setItem(chave, JSON.stringify([item1]));
      rpcMock.mockResolvedValue({
        data: null,
        error: {
          code: "P0001",
          message: "Este pedido não pode mais ser cancelado por você.",
        },
      });
      await montar();
      fromMock.mockClear();
      adminOrdersMock.mockClear();

      await reconectar();

      expect(rpcMock).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(chave)).toBeNull();
      expect(toast.info).toHaveBeenCalled();
      if (isAdmin) {
        expect(adminOrdersMock).toHaveBeenCalledWith({
          p_search: "",
          p_status: "all",
          p_start_date: "",
          p_end_date: "",
          p_page: 0,
          p_page_size: 10,
          p_payment_status: "all",
        });
        expect(fromMock).not.toHaveBeenCalled();
      } else {
        expect(fromMock).toHaveBeenCalledWith("marketplace_orders");
        expect(adminOrdersMock).not.toHaveBeenCalled();
      }
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "não recarrega a lista se só houve falha transitória (admin: %s)",
    async (isAdmin) => {
      authState.user = { id: "cliente-1" };
      authState.isAdmin = isAdmin;
      localStorage.setItem(chave, JSON.stringify([item1]));
      rpcMock.mockResolvedValue({ data: null, error: { status: 500 } });
      await montar();
      fromMock.mockClear();
      adminOrdersMock.mockClear();

      await reconectar();

      expect(rpcMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(localStorage.getItem(chave) ?? "null")).toEqual([
        item1,
      ]);
      expect(fromMock).not.toHaveBeenCalled();
      expect(adminOrdersMock).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "recarrega após duas passadas sem escrita e descarte terminal na primeira: %s",
    async (terminalNaPrimeira) => {
      authState.user = { id: "cliente-1" };
      const primeira = rpcPendente();
      const terminal = {
        code: "P0001",
        message: "Este pedido não pode mais ser cancelado por você.",
      };
      rpcMock.mockReturnValueOnce(primeira.promessa);
      rpcMock.mockImplementation(async (_nome, parametros) => ({
        data: null,
        error:
          !terminalNaPrimeira &&
          (parametros as { p_order_id: string }).p_order_id === "pedido-2"
            ? terminal
            : { status: 500 },
      }));
      localStorage.setItem(chave, JSON.stringify([item1]));
      await montar();
      fromMock.mockClear();
      const item2 = { ...item1, orderId: "pedido-2", timestamp: Date.now() };
      try {
        await reconectar();
        localStorage.setItem(chave, JSON.stringify([item1, item2]));
      } finally {
        await act(async () => {
          primeira.concluir({
            data: null,
            error: terminalNaPrimeira ? terminal : { status: 500 },
          });
          await primeira.promessa;
        });
      }

      expect(fromMock).toHaveBeenCalledWith("marketplace_orders");
      expect(JSON.parse(localStorage.getItem(chave) ?? "null")).toEqual([
        terminalNaPrimeira ? item2 : item1,
      ]);
    },
  );

  it.each([false, true])(
    "processa o item que entrou durante a RPC e preserva só ele se falhar: %s",
    async (falhaNoSegundo) => {
      const primeira = rpcPendente();
      rpcMock.mockReturnValueOnce(primeira.promessa);
      if (falhaNoSegundo) rpcMock.mockRejectedValueOnce({ status: 500 });
      localStorage.setItem(chave, JSON.stringify([item1]));
      await montar();
      let item2 = { ...item1, orderId: "pedido-2", timestamp: 0 };
      try {
        await reconectar();
        expect(rpcMock).toHaveBeenCalledTimes(1);
        item2 = { ...item2, timestamp: Date.now() };
        localStorage.setItem(chave, JSON.stringify([item1, item2]));
      } finally {
        await act(async () => {
          primeira.concluir({ data: null, error: null });
          await primeira.promessa;
        });
      }
      expect(rpcMock).toHaveBeenNthCalledWith(2, "update_order_status_atomic", {
        p_order_id: "pedido-2",
        p_new_status: "cancelled",
        p_notes: null,
        p_silent: false,
      });
      expect(JSON.parse(localStorage.getItem(chave) ?? "null")).toEqual(
        falhaNoSegundo ? [item2] : null,
      );
      if (!falhaNoSegundo) expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it("preserva o item novo sem chamar a RPC enquanto a rede está caída", async () => {
    const primeira = rpcPendente();
    rpcMock.mockReturnValueOnce(primeira.promessa);
    localStorage.setItem(chave, JSON.stringify([item1]));
    await montar();
    const item2 = { ...item1, orderId: "pedido-2", timestamp: Date.now() };
    try {
      await reconectar();
      localStorage.setItem(chave, JSON.stringify([item1, item2]));
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    } finally {
      await act(async () => {
        primeira.concluir({ data: null, error: null });
        await primeira.promessa;
      });
    }
    expect(JSON.parse(localStorage.getItem(chave) ?? "null")).toEqual([item2]);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("sincroniza a versão mais nova do mesmo pedido numa segunda passada", async () => {
    const primeira = rpcPendente();
    rpcMock.mockReturnValueOnce(primeira.promessa);
    localStorage.setItem(chave, JSON.stringify([item1]));
    await montar();
    try {
      await reconectar();
      localStorage.setItem(
        chave,
        JSON.stringify([
          { ...item1, notes: "nova versão", timestamp: Date.now() },
        ]),
      );
    } finally {
      await act(async () => {
        primeira.concluir({ data: null, error: null });
        await primeira.promessa;
      });
    }
    expect(rpcMock).toHaveBeenNthCalledWith(2, "update_order_status_atomic", {
      p_order_id: "pedido-1",
      p_new_status: "cancelled",
      p_notes: "nova versão",
      p_silent: false,
    });
    expect(localStorage.getItem(chave)).toBeNull();
  });

  it("compartilha a promessa durante a segunda passada e não abre uma terceira", async () => {
    const primeira = rpcPendente();
    const segunda = rpcPendente();
    rpcMock.mockReturnValueOnce(primeira.promessa);
    rpcMock.mockReturnValueOnce(segunda.promessa);
    localStorage.setItem(chave, JSON.stringify([item1]));
    await montar();
    const item2 = { ...item1, orderId: "pedido-2" };
    const item3 = { ...item1, orderId: "pedido-3" };
    try {
      await reconectar();
      localStorage.setItem(chave, JSON.stringify([item1, item2]));
      await act(async () => {
        primeira.concluir({ data: null, error: null });
        await primeira.promessa;
      });
      await reconectar();
      expect(rpcMock).toHaveBeenCalledTimes(2);
      localStorage.setItem(chave, JSON.stringify([item2, item3]));
    } finally {
      await act(async () => {
        primeira.concluir({ data: null, error: null });
        segunda.concluir({ data: null, error: null });
        await primeira.promessa;
        await segunda.promessa;
      });
    }
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(chave) ?? "null")).toEqual([item3]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("recupera a falha transitória em memória se o JSON se corromper durante a RPC", async () => {
    const primeira = rpcPendente();
    rpcMock.mockReturnValueOnce(primeira.promessa);
    localStorage.setItem(chave, JSON.stringify([item1]));
    await montar();
    try {
      await reconectar();
      localStorage.setItem(chave, "{JSON quebrado");
    } finally {
      await act(async () => {
        primeira.concluir({ data: null, error: { status: 500 } });
        await primeira.promessa;
      });
    }
    expect(JSON.parse(localStorage.getItem(chave) ?? "null")).toEqual([item1]);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("avisa tanto o descarte terminal quanto a falha transitória", async () => {
    localStorage.setItem(
      chave,
      JSON.stringify([item1, { ...item1, orderId: "pedido-2" }]),
    );
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "Pedido não encontrado." },
    });
    rpcMock.mockRejectedValueOnce({ status: 500 });
    await montar();
    await reconectar();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("1 alterações de pedidos"),
      { id: toastId },
    );
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("1 alterações não se aplicam mais"),
      { id: toastId },
    );
  });
});

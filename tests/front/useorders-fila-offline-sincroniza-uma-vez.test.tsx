// @vitest-environment jsdom
import { erroDeSincronizacaoEhTerminal, useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ data: null; error: unknown }>>(),
);

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
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
const item = { orderId: "pedido-offline", status: "cancelled", silent: false };

function Sonda({ enabled = true }: { enabled?: boolean }) {
  useOrders(enabled, false);
  return null;
}

describe("classificação de erro da sincronização", () => {
  it("reconhece pedido não encontrado como erro terminal", () => {
    expect(
      erroDeSincronizacaoEhTerminal({
        code: "P0001",
        message: "Pedido não encontrado.",
      }),
    ).toBe(true);
  });

  it.each([
    { message: "Apenas pedidos pendentes podem ser cancelados pelo usuário." },
    new Error("Este pedido não pode mais ser cancelado por você."),
    { message: "Este pedido não pode ser cancelado." },
    { code: "23514" },
  ])("reconhece o estado terminal: %j", (erro) => {
    expect(erroDeSincronizacaoEhTerminal(erro)).toBe(true);
  });

  it.each([
    null,
    undefined,
    {},
    "Failed to fetch",
    new TypeError("Failed to fetch"),
    { status: 500, message: "Internal Server Error" },
    { code: "P0001" },
    { code: "P0001", message: "Não autenticado" },
    { code: "42501", message: "permission denied" },
    { message: 503 },
  ])("preserva erro desconhecido ou transitório: %j", (erro) => {
    expect(erroDeSincronizacaoEhTerminal(erro)).toBe(false);
  });
});

describe("useOrders — a fila offline sincroniza uma vez", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
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

  async function montar(instancias = 1, enabled = true) {
    await act(async () => {
      raiz.render(
        Array.from({ length: instancias }, (_, indice) => (
          <Sonda key={indice} enabled={enabled} />
        )),
      );
    });
  }

  async function reconectar() {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(1000);
    });
  }

  it.each([2, 6])(
    "%i instâncias compartilham a RPC pendente por item",
    async (instancias) => {
      localStorage.setItem(chave, JSON.stringify([item]));
      let concluir: (() => void) | undefined;
      const pendente = new Promise<{ data: null; error: null }>((resolve) => {
        concluir = () => resolve({ data: null, error: null });
      });
      rpcMock.mockReturnValue(pendente);
      await montar(instancias);
      try {
        await reconectar();
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(supabase.rpc).toHaveBeenCalledWith(
          "update_order_status_atomic",
          {
            p_order_id: "pedido-offline",
            p_new_status: "cancelled",
            p_notes: null,
            p_silent: false,
          },
        );
      } finally {
        await act(async () => {
          concluir?.();
          await pendente;
        });
      }
      expect(localStorage.getItem(chave)).toBeNull();
      await reconectar();
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith(
        "Todas as atualizações de status de pedidos foram sincronizadas!",
        { id: toastId },
      );
      expect(toast.info).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      code: "P0001",
      message: "Este pedido não pode mais ser cancelado por você.",
    },
    {
      code: "P0001",
      message: "Apenas pedidos pendentes podem ser cancelados pelo usuário.",
    },
    { code: "23514", message: "check constraint violated" },
  ])(
    "descarta erro terminal $message sem repetir falha na reconexão",
    async (error) => {
      localStorage.setItem(chave, JSON.stringify([item]));
      rpcMock.mockResolvedValue({ data: null, error });
      await montar();
      await reconectar();
      expect(localStorage.getItem(chave)).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledTimes(1);
      expect(toast.info).toHaveBeenCalledWith(
        "Fila de pedidos atualizada. Algumas alterações não se aplicam mais ao estado atual dos pedidos.",
        { id: toastId },
      );
      await reconectar();
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it.each([
    new TypeError("Failed to fetch"),
    { status: 503, message: "Service Unavailable" },
    {},
    { code: "P0001", message: "Não autenticado" },
  ])(
    "mantém erro transitório %j e libera a próxima tentativa",
    async (error) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      localStorage.setItem(chave, JSON.stringify([item]));
      rpcMock.mockRejectedValueOnce(error);
      await montar();
      await reconectar();
      expect(JSON.parse(localStorage.getItem(chave) ?? "null")).toEqual([item]);
      expect(toast.error).toHaveBeenCalledTimes(1);
      await reconectar();
      expect(supabase.rpc).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem(chave)).toBeNull();
    },
  );

  it("enabled=false sincroniza a fila ao voltar online fora da aba Pedidos", async () => {
    localStorage.setItem(chave, JSON.stringify([item]));
    await montar(1, false);
    await reconectar();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(chave)).toBeNull();
  });
});

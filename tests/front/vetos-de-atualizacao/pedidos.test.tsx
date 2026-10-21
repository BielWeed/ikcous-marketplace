// @vitest-environment jsdom
import { useOrders } from "@/hooks/useOrders";
import {
  assinarOperacoesSensiveis,
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adiar } from "./apoio";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    // L10: a sessão é conferida antes de cada envio.
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
    // L10: o hook agora tem usuário, então a carga normal de pedidos também
    // roda — estes dublês só a deixam inofensiva.
    functions: { invoke: vi.fn() },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            abortSignal: () => Promise.resolve({ data: [], error: null }),
          }),
          single: () => Promise.resolve({ data: { total: 100 }, error: null }),
        }),
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  // L10: a fila offline é por usuário — sem sessão nada é enviado.
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: false }),
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

const chave = "orders_offline_updates_queue:lojista-1";
const toastId = "sincronizacao-fila-offline";
const item = { orderId: "pedido-offline", status: "cancelled", silent: false };

let gancho: ReturnType<typeof useOrders>;
function Sonda({ enabled = true }: { enabled?: boolean }) {
  const api = useOrders(enabled, false);
  useEffect(() => {
    gancho = api;
  }, [api]);
  return null;
}

describe("pedidos vetam a atualização durante envio e fila offline", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
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

  const dados = {
    items: [{ productId: "produto-teste", quantity: 1 }],
    totalAmount: 10,
    shippingCost: 0,
    paymentMethod: "dinheiro",
    customer: { name: "Pessoa de teste", whatsapp: "" },
  };

  it.each([false, true])(
    "envio pendente veta e libera ao terminar (erro=%s)",
    async (erro) => {
      await montar();
      const envio = adiar<{ data: string | null; error: null }>();
      rpcMock.mockReturnValue(envio.promessa);
      let resultado!: Promise<unknown>;
      try {
        await act(async () => {
          resultado = gancho
            .createOrder(dados, { comPagamentoOnline: true })
            .catch((e: unknown) => e);
        });
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual(["envio-de-pedido"]);
      } finally {
        await act(async () => {
          if (erro) envio.rejeitar(new Error("falha simulada"));
          else envio.resolver({ data: "pedido-teste", error: null });
          await resultado;
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  it.each([false, true])(
    "fila pendente veta e libera ao terminar (erro=%s)",
    async (erro) => {
      localStorage.setItem(chave, JSON.stringify([item]));
      const envio = adiar<{ data: null; error: null }>();
      rpcMock.mockReturnValue(envio.promessa);
      await montar();
      try {
        await reconectar();
        expect(rpcMock).toHaveBeenCalledTimes(1);
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual([
          "fila-offline-de-pedidos",
        ]);
      } finally {
        await act(async () => {
          if (erro) envio.rejeitar(new Error("falha simulada"));
          else envio.resolver({ data: null, error: null });
          await vi.advanceTimersByTimeAsync(0);
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
      if (erro) expect(localStorage.getItem(chave)).not.toBeNull();
      else expect(localStorage.getItem(chave)).toBeNull();
    },
  );

  it("uma marca cobre os dois itens sem janela livre entre as RPCs", async () => {
    localStorage.setItem(
      chave,
      JSON.stringify([item, { ...item, orderId: "outro-pedido" }]),
    );
    const primeiro = adiar<{ data: null; error: null }>();
    const segundo = adiar<{ data: null; error: null }>();
    rpcMock
      .mockReturnValueOnce(primeiro.promessa)
      .mockReturnValueOnce(segundo.promessa);
    await montar();
    const estados: boolean[] = [];
    const desassinar = assinarOperacoesSensiveis(() =>
      estados.push(haOperacaoSensivel()),
    );
    try {
      await reconectar();
      expect(haOperacaoSensivel()).toBe(true);
      await act(async () => {
        primeiro.resolver({ data: null, error: null });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(rpcMock).toHaveBeenCalledTimes(2);
      expect(haOperacaoSensivel()).toBe(true);
      expect(estados).toEqual([true]);
    } finally {
      await act(async () => {
        primeiro.resolver({ data: null, error: null });
        segundo.resolver({ data: null, error: null });
        await vi.advanceTimersByTimeAsync(0);
      });
      desassinar();
    }
    expect(estados).toEqual([true, false]);
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("desmonte libera a marca da fila sem aguardar rede", async () => {
    const envio = adiar<{ data: null; error: null }>();
    localStorage.setItem(chave, JSON.stringify([item]));
    await montar();
    rpcMock.mockReturnValue(envio.promessa);
    try {
      await reconectar();
      expect(haOperacaoSensivel()).toBe(true);
      act(() => raiz.unmount());
      expect(haOperacaoSensivel()).toBe(false);
    } finally {
      await act(async () => {
        envio.resolver({ data: null, error: null });
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("envio de pedido em andamento mantém a marca mesmo após desmontar", async () => {
    // A RPC já saiu: recarregar agora perderia a resposta do pedido. A marca
    // só cai no finally do próprio envio, não no desmonte do componente.
    const envio = adiar<{ data: string; error: null }>();
    await montar();
    rpcMock.mockReturnValue(envio.promessa);
    let resultado: Promise<unknown> | undefined;
    try {
      await act(async () => {
        resultado = gancho
          .createOrder(dados, { comPagamentoOnline: true })
          .catch(() => {});
      });
      expect(haOperacaoSensivel()).toBe(true);
      act(() => raiz.unmount());
      expect(haOperacaoSensivel()).toBe(true);
    } finally {
      await act(async () => {
        envio.resolver({ data: "pedido-teste", error: null });
        await resultado;
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("desmontar antes do timer não deixa envio nem marca tardia", async () => {
    localStorage.setItem(chave, JSON.stringify([item]));
    await montar();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
      raiz.unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("finally de envio desmontado não libera o envio da nova instância (cada envio tem a sua marca)", async () => {
    await montar();
    const antigo = adiar<{ data: string; error: null }>();
    const novo = adiar<{ data: string; error: null }>();
    rpcMock
      .mockReturnValueOnce(antigo.promessa)
      .mockReturnValueOnce(novo.promessa);
    let resultadoAntigo: Promise<unknown> | undefined;
    let resultadoNovo: Promise<unknown> | undefined;
    try {
      await act(async () => {
        resultadoAntigo = gancho.createOrder(dados, {
          comPagamentoOnline: true,
        });
      });
      expect(haOperacaoSensivel()).toBe(true);
      act(() => raiz.render(null));
      expect(haOperacaoSensivel()).toBe(true);
      await montar();
      await act(async () => {
        resultadoNovo = gancho.createOrder(dados, { comPagamentoOnline: true });
      });
      expect(haOperacaoSensivel()).toBe(true);
      await act(async () => {
        antigo.resolver({ data: "pedido-antigo", error: null });
        await resultadoAntigo;
      });
      expect(haOperacaoSensivel()).toBe(true);
    } finally {
      await act(async () => {
        antigo.resolver({ data: "pedido-antigo", error: null });
        novo.resolver({ data: "pedido-novo", error: null });
        await resultadoAntigo;
        await resultadoNovo;
      });
    }
    expect(haOperacaoSensivel()).toBe(false);
  });
});

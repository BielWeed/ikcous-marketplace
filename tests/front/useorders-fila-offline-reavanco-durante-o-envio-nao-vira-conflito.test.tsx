// @vitest-environment jsdom
//
// r188-b: a lojista avanca o MESMO pedido de novo (sem internet) enquanto o
// avanco anterior ainda esta sendo enviado (a conexao voltou, a RPC esta em
// voo, a conexao cai de novo). O item novo da fila reaproveita, por desenho, o
// `statusEsperado` do item antigo (pending): "avancos offline seguintes mudam
// so o destino, nao a ultima origem confirmada". So que o envio antigo
// (pending -> processing) TERMINA com sucesso, e a origem confirmada passa a
// ser `processing`. Sem acertar o esperado do item novo, a proxima passada
// relia `processing !== pending` e o descartava como conflito: a ultima acao da
// lojista ("Enviado") sumia da fila e o pedido ficava "Em preparacao".
import { mesclarFilaOfflineAposPassada, useOrders } from "@/hooks/useOrders";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RespostaRpc = { data: null; error: unknown };

const rpcMock = vi.hoisted(() =>
  vi.fn<(nome: string, parametros: unknown) => Promise<RespostaRpc>>(),
);
const fromMock = vi.hoisted(() => vi.fn());

/** O que o servidor tem agora, por pedido (a releitura devolve isto). */
let statusNoServidor: Map<string, string>;

function builderDaReleitura() {
  let id = "";
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((_coluna: string, valor: string) => {
    id = valor;
    return builder;
  });
  builder.single = vi.fn(() =>
    Promise.resolve({
      data: { status: statusNoServidor.get(id) ?? "pending" },
      error: null,
    }),
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
    rpc: (nome: string, parametros: unknown) => rpcMock(nome, parametros),
    from: (...args: unknown[]) => fromMock(...args),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
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
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico — padrao do projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const chave = "orders_offline_updates_queue:lojista-1";
const toastId = "sincronizacao-fila-offline";

const avancoA = {
  orderId: "pedido-p",
  status: "processing",
  silent: false,
  statusEsperado: "pending",
  timestamp: 1,
};
const avancoB = {
  orderId: "pedido-p",
  status: "shipping",
  silent: false,
  statusEsperado: "pending",
  timestamp: 2,
};
const outroPedido = {
  orderId: "pedido-q",
  status: "processing",
  silent: false,
  statusEsperado: "pending",
  timestamp: 2,
};

describe("mesclarFilaOfflineAposPassada — origem confirmada pelo envio que acabou de sair", () => {
  const processados = new Map([["pedido-p", 1]]);

  it("o item mais novo do mesmo pedido ganha como esperado o destino gravado", () => {
    const entrada = { ...avancoB };
    const final = mesclarFilaOfflineAposPassada(
      [entrada],
      processados,
      [],
      new Map([["pedido-p", "processing"]]),
    );
    expect(final).toEqual([{ ...avancoB, statusEsperado: "processing" }]);
    // Devolve uma COPIA: o objeto lido do storage nao e mutado.
    expect(entrada.statusEsperado).toBe("pending");
    expect(final[0]).not.toBe(entrada);
  });

  it("sem o 4o parametro o comportamento e o de sempre (nao-regressao)", () => {
    expect(
      mesclarFilaOfflineAposPassada([avancoA, avancoB], processados, []),
    ).toEqual([avancoB]);
    expect(
      mesclarFilaOfflineAposPassada(
        [avancoB],
        processados,
        [],
        new Map<string, string>(),
      ),
    ).toEqual([avancoB]);
  });

  it("item legado, sem statusEsperado, e preservado sem inventar esperado", () => {
    const { statusEsperado: _esperado, ...legado } = avancoB;
    const final = mesclarFilaOfflineAposPassada(
      [legado],
      processados,
      [],
      new Map([["pedido-p", "processing"]]),
    );
    expect(final).toEqual([legado]);
    expect(final[0]).not.toHaveProperty("statusEsperado");
  });

  it("item de outro pedido fica intacto", () => {
    const final = mesclarFilaOfflineAposPassada(
      [avancoB, outroPedido],
      processados,
      [],
      new Map([["pedido-p", "processing"]]),
    );
    expect(final).toEqual([
      { ...avancoB, statusEsperado: "processing" },
      outroPedido,
    ]);
    expect(final[1]).toBe(outroPedido);
  });

  it("pedido que nao teve envio gravado nesta passada fica intacto", () => {
    expect(
      mesclarFilaOfflineAposPassada(
        [avancoB],
        new Map(),
        [],
        new Map([["pedido-q", "processing"]]),
      ),
    ).toEqual([avancoB]);
  });

  it("a versao ja enviada continua saindo da fila (so a mais nova e ajustada)", () => {
    expect(
      mesclarFilaOfflineAposPassada(
        [avancoA],
        processados,
        [],
        new Map([["pedido-p", "processing"]]),
      ),
    ).toEqual([]);
  });

  it("fila fresca invalida continua devolvendo a reserva como esta", () => {
    expect(
      mesclarFilaOfflineAposPassada(
        null,
        processados,
        [avancoB],
        new Map([["pedido-p", "processing"]]),
      ),
    ).toEqual([avancoB]);
  });
});

let ultimoRetornoDoHook: ReturnType<typeof useOrders> | null = null;

function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    ultimoRetornoDoHook = retorno;
  });
  return null;
}

function rpcPendente() {
  let concluir: (resultado: RespostaRpc) => void = () => {};
  const promessa = new Promise<RespostaRpc>((resolve) => {
    concluir = resolve;
  });
  return { promessa, concluir };
}

function filaGravada(): Array<Record<string, unknown>> {
  return JSON.parse(localStorage.getItem(chave) ?? "null") ?? [];
}

describe("useOrders — avancar de novo durante o envio nao vira conflito", () => {
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
    statusNoServidor = new Map([["pedido-p", "pending"]]);
    vi.mocked(toast.loading).mockReturnValue(toastId);
    ultimoRetornoDoHook = null;
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

  /** A lojista avanca o mesmo pedido de novo, SEM internet, pelo caminho real
   *  do hook (e nao escrevendo na fila a mao). */
  async function avancarDeNovoOffline() {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      await ultimoRetornoDoHook?.updateOrderStatus(
        "pedido-p",
        "shipping",
        undefined,
        true,
        "processing",
      );
    });
  }

  it.each([false, true])(
    "avanco novo no meio do envio: a fila guarda o esperado novo e a proxima passada o envia (conexao voltou antes do fim: %s)",
    async (internetVoltaAntesDoFim) => {
      const envioDeA = rpcPendente();
      rpcMock.mockReturnValueOnce(envioDeA.promessa);
      localStorage.setItem(chave, JSON.stringify([avancoA]));
      await montar();
      await reconectar();
      expect(rpcMock).toHaveBeenCalledTimes(1);

      // Durante o envio de A, o MESMO pedido e avancado de novo, offline.
      await avancarDeNovoOffline();
      const guardado = filaGravada();
      expect(guardado).toHaveLength(1);
      expect(guardado[0]).toMatchObject({
        orderId: "pedido-p",
        status: "shipping",
        // por desenho, herdado do item antigo...
        statusEsperado: "pending",
      });

      // ...e o envio de A termina COM SUCESSO.
      if (internetVoltaAntesDoFim) {
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      }
      statusNoServidor.set("pedido-p", "processing");
      await act(async () => {
        envioDeA.concluir({ data: null, error: null });
        await envioDeA.promessa;
        await vi.advanceTimersByTimeAsync(1000);
      });

      if (!internetVoltaAntesDoFim) {
        // A origem confirmada agora e o destino que acabou de ser gravado.
        expect(filaGravada()).toEqual([
          expect.objectContaining({
            orderId: "pedido-p",
            status: "shipping",
            statusEsperado: "processing",
          }),
        ]);
        expect(rpcMock).toHaveBeenCalledTimes(1);
        await reconectar();
      }

      // A releitura confere (processing === processing) e a RPC sai, sem descarte.
      expect(rpcMock).toHaveBeenCalledTimes(2);
      expect(rpcMock).toHaveBeenNthCalledWith(2, "avancar_status_do_pedido", {
        p_order_id: "pedido-p",
        p_status_esperado: "processing",
        p_new_status: "shipping",
        p_notes: null,
      });
      expect(localStorage.getItem(chave)).toBeNull();
      expect(toast.info).not.toHaveBeenCalledWith(
        expect.stringContaining("mudou de situação"),
        expect.anything(),
      );
      expect(toast.info).not.toHaveBeenCalledWith(
        expect.stringContaining("não se aplicam mais"),
        expect.anything(),
      );
    },
  );

  it("o envio de A falha (transitorio): o avanco novo segue com o esperado que tinha", async () => {
    const envioDeA = rpcPendente();
    rpcMock.mockReturnValueOnce(envioDeA.promessa);
    localStorage.setItem(chave, JSON.stringify([avancoA]));
    await montar();
    await reconectar();

    await avancarDeNovoOffline();
    await act(async () => {
      envioDeA.concluir({ data: null, error: { status: 500 } });
      await envioDeA.promessa;
    });

    // Nada foi gravado no servidor: a origem continua sendo `pending`.
    expect(filaGravada()).toEqual([
      expect.objectContaining({
        status: "shipping",
        statusEsperado: "pending",
      }),
    ]);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // E o envio seguinte (pending -> shipping, um envio so) confere e sai.
    await reconectar();
    expect(rpcMock).toHaveBeenNthCalledWith(2, "avancar_status_do_pedido", {
      p_order_id: "pedido-p",
      p_status_esperado: "pending",
      p_new_status: "shipping",
      p_notes: null,
    });
  });

  it("o envio de A e descartado como terminal (outro aparelho mudou): o avanco novo segue com o esperado que tinha", async () => {
    const envioDeA = rpcPendente();
    rpcMock.mockReturnValueOnce(envioDeA.promessa);
    localStorage.setItem(chave, JSON.stringify([avancoA]));
    await montar();
    await reconectar();

    await avancarDeNovoOffline();
    await act(async () => {
      envioDeA.concluir({
        data: null,
        error: { message: "pedido_status_mudou: o pedido mudou" },
      });
      await envioDeA.promessa;
    });

    expect(filaGravada()).toEqual([
      expect.objectContaining({
        status: "shipping",
        statusEsperado: "pending",
      }),
    ]);
  });

  it("A era um cancelamento: o esperado novo e 'cancelled' e o avanco seguinte e recusado pela conferencia", async () => {
    const cancelamentoA = {
      orderId: "pedido-p",
      status: "cancelled",
      silent: false,
      statusEsperado: "pending",
      timestamp: 1,
    };
    const envioDeA = rpcPendente();
    rpcMock.mockReturnValueOnce(envioDeA.promessa);
    localStorage.setItem(chave, JSON.stringify([cancelamentoA]));
    await montar();
    await reconectar();
    expect(rpcMock).toHaveBeenNthCalledWith(1, "update_order_status_atomic", {
      p_order_id: "pedido-p",
      p_new_status: "cancelled",
      p_notes: null,
      p_silent: false,
    });

    await avancarDeNovoOffline();
    statusNoServidor.set("pedido-p", "cancelled");
    await act(async () => {
      envioDeA.concluir({ data: null, error: null });
      await envioDeA.promessa;
    });
    expect(filaGravada()).toEqual([
      expect.objectContaining({
        status: "shipping",
        statusEsperado: "cancelled",
      }),
    ]);

    // Um pedido morto nunca e reativado: a conferencia descarta, sem RPC.
    await reconectar();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(chave)).toBeNull();
  });
});

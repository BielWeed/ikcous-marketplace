// @vitest-environment jsdom
/**
 * "Marcar como recebido" com a resposta ATRASADA: a lojista toca em "Recebi" e,
 * antes de a resposta chegar, o outro aparelho DESFAZ o recebimento (o evento ao
 * vivo traz o pedido já sem pagamento e mais novo). A resposta antiga, que ainda
 * diz "recebido", era espalhada sobre o pedido atual e a tela voltava a mostrar
 * "pago" -- com o banco dizendo o contrário.
 *
 * Regra provada aqui: o retorno só é aplicado ao pedido que ainda é o que a
 * ação viu (mesma versão `updatedAt` de quando partiu). Se chegou uma versão
 * mais nova, a mais nova vale. A função continua devolvendo o que o banco
 * respondeu (contrato com quem chama).
 */
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
let evento: ((payload: unknown) => Promise<void>) | undefined;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    channel: () => {
      const canal: any = {
        on: (_tipo: string, _filtro: unknown, handler: typeof evento) => {
          evento = handler;
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "usuario-rec" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
import { useOrders } from "@/hooks/useOrders";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ANTES = "2026-11-12T10:00:00Z";
const DEPOIS = "2026-11-12T10:05:00Z";
const RECEBIDO = {
  payment_status: "recebido_na_entrega",
  pagamento_recebido_em: "2026-11-12T10:01:00Z",
  pagamento_recebido_por: "lojista-1",
};

function linha(
  id: string,
  updated_at = ANTES,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    status: "processing",
    updated_at,
    created_at: "2026-11-12T09:00:00Z",
    user_id: "usuario-rec",
    customer_name: "Cliente Teste",
    items: [],
    payment_method: "cash",
    payment_status: null,
    cancelled_after_shipping: false,
    ...extra,
  };
}
type Resposta = { data: unknown; error: unknown };
function adiada() {
  let concluir!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    concluir = resolve;
  });
  return { promessa, concluir };
}

let atuais: ReturnType<typeof useOrders>;
let linhasDoServidor: ReturnType<typeof linha>[] = [];
let canceladosDoServidor: ReturnType<typeof linha>[] = [];
let gravacao: () => Promise<Resposta>;
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}
async function emitir(novaLinha: ReturnType<typeof linha>) {
  expect(evento).toBeDefined();
  await act(async () => {
    await evento!({ eventType: "UPDATE", new: novaLinha, old: {} });
  });
}
const pedido = (id: string) => atuais.orders.find((o) => o.id === id);

describe("Recebi com resposta atrasada não desfaz o que chegou depois", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    evento = undefined;
    canceladosDoServidor = [];
    gravacao = async () => ({ data: null, error: null });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) =>
      nome === "get_admin_orders_paged"
        ? {
            abortSignal: () =>
              Promise.resolve({
                data: {
                  data: linhasDoServidor,
                  total_count: linhasDoServidor.length,
                },
                error: null,
              }),
          }
        : nome === "get_admin_orders_cancelados_recentes"
          ? {
              abortSignal: () =>
                Promise.resolve({
                  data: {
                    data: canceladosDoServidor,
                    total_count: canceladosDoServidor.length,
                    fora_da_janela: 0,
                  },
                  error: null,
                }),
            }
          : gravacao(),
    );
    from.mockReset();
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: null }) }),
      }),
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
  });
  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      await vi.advanceTimersByTimeAsync(4001);
    });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  async function abrirComPedido(p: ReturnType<typeof linha>) {
    linhasDoServidor = [p];
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, "all");
    });
  }
  /** Toca no botão com a resposta segurada; `durante` roda enquanto ela está no ar. */
  async function marcar(
    id: string,
    recebido: boolean,
    resposta: Resposta,
    durante: () => Promise<void>,
  ) {
    const envio = adiada();
    gravacao = () => envio.promessa;
    let devolvido!: Promise<unknown>;
    await act(async () => {
      devolvido = atuais.registrarPagamentoRecebido(id, recebido);
    });
    await durante();
    await act(async () => {
      envio.concluir(resposta);
    });
    return devolvido;
  }

  it("o outro aparelho desfez no meio: a resposta antiga 'recebido' não volta a pintar 'pago'", async () => {
    await abrirComPedido(linha("RC-1"));
    const devolvido = await marcar(
      "RC-1",
      true,
      { data: RECEBIDO, error: null },
      async () => {
        // O outro aparelho desfaz: o pedido chega sem pagamento e mais novo.
        await emitir(linha("RC-1", DEPOIS));
      },
    );
    expect(pedido("RC-1")?.paymentStatus).toBeFalsy();
    expect(pedido("RC-1")?.pagamentoRecebidoEm).toBeFalsy();
    // O contrato não muda: quem chamou recebe o que o banco respondeu.
    expect(devolvido).toMatchObject({ payment_status: "recebido_na_entrega" });
  });

  it("a cópia guardada no aparelho também não volta a 'pago' (remontar a tela lê dela)", async () => {
    await abrirComPedido(linha("RC-7"));
    await marcar("RC-7", true, { data: RECEBIDO, error: null }, async () => {
      await emitir(linha("RC-7", DEPOIS));
    });
    // O evento ao vivo não regrava a cópia; é a resposta antiga que a tocaria.
    await act(async () => {
      raiz.unmount();
      await vi.advanceTimersByTimeAsync(4001);
    });
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    expect(pedido("RC-7")?.paymentStatus).not.toBe("recebido_na_entrega");
  });

  it("o painel de cancelados também não volta a 'pago' quando a releitura dele já trouxe versão mais nova", async () => {
    const cancelado = (v: string, extra = {}) =>
      linha("RC-8", v, { status: "cancelled", ...extra });
    canceladosDoServidor = [cancelado(ANTES)];
    await abrirComPedido(cancelado(ANTES));
    await act(async () => {
      await atuais.buscarTambemCanceladosAntigos();
    });
    expect(atuais.pedidosCancelados).toHaveLength(1);
    await marcar("RC-8", true, { data: RECEBIDO, error: null }, async () => {
      canceladosDoServidor = [cancelado(DEPOIS)];
      await act(async () => {
        await atuais.buscarTambemCanceladosAntigos();
      });
    });
    expect(atuais.pedidosCancelados[0]?.paymentStatus).toBeFalsy();
  });

  it("borda: o eco do próprio 'Recebi' chegando antes da resposta mantém o pedido recebido", async () => {
    await abrirComPedido(linha("RC-2"));
    await marcar("RC-2", true, { data: RECEBIDO, error: null }, async () => {
      await emitir(linha("RC-2", DEPOIS, RECEBIDO));
    });
    expect(pedido("RC-2")?.paymentStatus).toBe("recebido_na_entrega");
  });

  it("borda: desfazer com a resposta atrasada não apaga um 'recebido' mais novo", async () => {
    await abrirComPedido(linha("RC-3", ANTES, RECEBIDO));
    await marcar(
      "RC-3",
      false,
      {
        data: {
          payment_status: null,
          pagamento_recebido_em: null,
          pagamento_recebido_por: null,
        },
        error: null,
      },
      async () => {
        // Outro aparelho voltou a marcar como recebido, mais novo.
        await emitir(linha("RC-3", DEPOIS, RECEBIDO));
      },
    );
    expect(pedido("RC-3")?.paymentStatus).toBe("recebido_na_entrega");
  });

  it("controle: sem nada no meio, a resposta é aplicada ao pedido", async () => {
    await abrirComPedido(linha("RC-4"));
    await marcar("RC-4", true, { data: RECEBIDO, error: null }, async () => {});
    expect(pedido("RC-4")?.paymentStatus).toBe("recebido_na_entrega");
    expect(pedido("RC-4")?.pagamentoRecebidoPor).toBe("lojista-1");
  });

  it("controle: evento de OUTRO pedido no meio não impede a resposta de valer", async () => {
    linhasDoServidor = [linha("RC-5"), linha("RC-6")];
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, "all");
    });
    await marcar("RC-5", true, { data: RECEBIDO, error: null }, async () => {
      await emitir(linha("RC-6", DEPOIS));
    });
    expect(pedido("RC-5")?.paymentStatus).toBe("recebido_na_entrega");
    expect(pedido("RC-6")?.paymentStatus).toBeFalsy();
  });
});

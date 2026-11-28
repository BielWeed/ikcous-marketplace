// @vitest-environment jsdom
/**
 * Lote 528: o aviso de status à cliente (`avisarOClienteDoStatus`) carimba a
 * ordem com a hora em que o BANCO gravou a mudança — e só cai no relógio do
 * aparelho da lojista quando `updateOrderStatus` devolve `gravadoNoBancoEm`
 * vazio. Havia três caminhos em que a mudança estava gravada e a hora chegava
 * vazia, e o aviso saía com o relógio local (que pode estar adiantado: o aviso
 * errado vencia o certo na bandeja da cliente):
 *   (a) cancelamento pela edge (pedido online): a resposta da edge não traz
 *       `updated_at`;
 *   (b) avanço que ficou sem resposta e é reconhecido na tentativa seguinte,
 *       pela releitura antes de gravar;
 *   (c) avanço cujo prazo estourou mas a conferência mostra que gravou.
 * Em todos, agora, a hora vem da leitura do banco. Aqui o relógio local está
 * ANOS adiantado, para que qualquer hora tirada de `Date.now()` apareça.
 *
 * Mesma sonda de use-orders-avanco-devolve-a-hora-gravada-no-banco.test.tsx.
 */
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    channel: () => {
      const canal: any = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "usuario-lote-528" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
import {
  PRAZO_DO_AVANCO_DE_STATUS_MS,
  PRAZO_DO_CANCELAMENTO_MS,
  useOrders,
} from "@/hooks/useOrders";
import type { OrderStatus } from "@/types";
import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** O relógio do aparelho da lojista: anos à frente do banco. */
const RELOGIO_ADIANTADO = new Date("2031-01-01T00:00:00Z");
/** A hora que o banco gravou. */
const HORA_DO_BANCO = "2026-11-27T12:34:56.789012+00:00";

function linha(id: string, status: string, pagamento: "cash" | "online") {
  return {
    id,
    status,
    updated_at: "2026-11-27T10:00:00Z",
    created_at: "2026-11-27T09:00:00Z",
    user_id: "cliente-1",
    customer_name: "Cliente Teste",
    items: [],
    payment_method: pagamento,
    payment_status: pagamento === "online" ? "pago" : null,
    cancelled_after_shipping: false,
  };
}
type Resposta = { data: unknown; error: unknown };

let atuais: ReturnType<typeof useOrders>;
/** O que o banco tem de verdade (lido por qualquer releitura). */
let statusNoBanco: string;
let horaNoBanco: string;
let gravacao: () => Promise<Resposta>;
let releitura: () => Promise<Resposta>;
let respostaDaEdge: () => Promise<Resposta>;
/** As colunas que cada leitura de `marketplace_orders` pediu. */
let colunasLidas: string[];
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

const ID_DINHEIRO = "PED-DINHEIRO";
const ID_ONLINE = "PED-ONLINE";

/** Chama e devolve o desfecho (a chamada termina dentro do `act`). */
async function mudar(
  id: string,
  status: OrderStatus,
  statusEsperado?: OrderStatus,
): Promise<{ ok: boolean; erro: unknown; valor: unknown }> {
  const desfecho = {
    ok: false,
    erro: null as unknown,
    valor: undefined as unknown,
  };
  await act(async () => {
    const promessa = atuais
      .updateOrderStatus(id, status, undefined, false, statusEsperado)
      .then(
        (valor: unknown) => {
          desfecho.ok = true;
          desfecho.valor = valor;
        },
        (erro: unknown) => {
          desfecho.erro = erro;
        },
      );
    // Prazo mais longo (o do cancelamento) + folga para as conferências.
    await vi.advanceTimersByTimeAsync(
      PRAZO_DO_CANCELAMENTO_MS + PRAZO_DO_AVANCO_DE_STATUS_MS * 2,
    );
    await promessa;
  });
  return desfecho;
}

describe("Hora do banco no aviso: os caminhos em que a resposta não traz a linha", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(RELOGIO_ADIANTADO);
    vi.clearAllMocks();
    statusNoBanco = "pending";
    horaNoBanco = HORA_DO_BANCO;
    colunasLidas = [];
    gravacao = async () => ({ data: null, error: null });
    releitura = async () => ({
      data: { status: statusNoBanco, updated_at: horaNoBanco },
      error: null,
    });
    respostaDaEdge = async () => ({
      data: { cancelamento: "cancelado" },
      error: null,
    });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) =>
      nome === "get_admin_orders_paged"
        ? {
            abortSignal: () =>
              Promise.resolve({
                data: {
                  data: [
                    linha(ID_DINHEIRO, "pending", "cash"),
                    linha(ID_ONLINE, "processing", "online"),
                  ],
                  total_count: 2,
                },
                error: null,
              }),
          }
        : nome === "get_admin_orders_cancelados_recentes"
          ? { abortSignal: () => Promise.resolve({ data: [], error: null }) }
          : gravacao(),
    );
    from.mockReset();
    from.mockImplementation(() => ({
      select: (colunas: string) => {
        colunasLidas.push(colunas);
        return { eq: () => ({ single: () => releitura() }) };
      },
    }));
    invoke.mockReset();
    invoke.mockImplementation(() => respostaDaEdge());
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
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, "all");
    });
    vi.clearAllMocks();
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

  describe("(a) cancelamento pela edge", () => {
    it("cancelou: devolve o updated_at que o banco gravou, nunca o relógio local", async () => {
      respostaDaEdge = async () => {
        statusNoBanco = "cancelled";
        return { data: { cancelamento: "cancelado" }, error: null };
      };

      const r = await mudar(ID_ONLINE, "cancelled");

      expect(r.erro).toBeNull();
      expect(invoke).toHaveBeenCalledWith(
        "criar-pagamento",
        expect.objectContaining({
          body: expect.objectContaining({ metodo: "cancelar" }),
        }),
      );
      expect(r.valor).toEqual({ gravadoNoBancoEm: HORA_DO_BANCO });
      expect(colunasLidas.some((c) => c.includes("updated_at"))).toBe(true);
    });

    it("borda: a leitura da hora falha — o cancelamento continua provado e a hora volta vazia (relógio local, como antes)", async () => {
      respostaDaEdge = async () => {
        statusNoBanco = "cancelled";
        return { data: { cancelamento: "cancelado" }, error: null };
      };
      releitura = async () => ({
        data: null,
        error: { message: "falhou", code: "" },
      });

      const r = await mudar(ID_ONLINE, "cancelled");

      expect(r.erro).toBeNull();
      expect(r.valor).toEqual({ gravadoNoBancoEm: null });
      expect(toast.success).toHaveBeenCalledWith("Pedido cancelado.");
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("borda: a leitura da hora fica pendurada — o prazo curto a encerra e a hora volta vazia", async () => {
      respostaDaEdge = async () => {
        statusNoBanco = "cancelled";
        return { data: { cancelamento: "cancelado" }, error: null };
      };
      releitura = () => new Promise(() => {});

      const r = await mudar(ID_ONLINE, "cancelled");

      expect(r.erro).toBeNull();
      expect(r.valor).toEqual({ gravadoNoBancoEm: null });
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("borda: a leitura lança de forma síncrona — o cancelamento provado não vira erro", async () => {
      respostaDaEdge = async () => {
        statusNoBanco = "cancelled";
        return { data: { cancelamento: "cancelado" }, error: null };
      };
      from.mockImplementation(() => {
        throw new TypeError("from indisponível");
      });

      const r = await mudar(ID_ONLINE, "cancelled");

      expect(r.erro).toBeNull();
      expect(r.valor).toEqual({ gravadoNoBancoEm: null });
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("borda: o banco já não está cancelado na leitura — a hora não é a do cancelamento, volta vazia", async () => {
      respostaDaEdge = async () => ({
        data: { cancelamento: "cancelado" },
        error: null,
      });
      statusNoBanco = "processing";

      const r = await mudar(ID_ONLINE, "cancelled");

      expect(r.erro).toBeNull();
      expect(r.valor).toEqual({ gravadoNoBancoEm: null });
    });

    it("já estava cancelado: devolve a hora do banco como no cancelamento novo (a ficha ainda avisa a cliente) e diz que já estava", async () => {
      // A 1ª tentativa pode ter gravado sem resposta (prazo de 30 s, rede
      // caiu na volta) e sem aviso nenhum: a 2ª é a que recebe `jaEstava`,
      // e é ela que tem de avisar a cliente, com a hora do banco.
      statusNoBanco = "cancelled";
      respostaDaEdge = async () => ({
        data: { cancelamento: "cancelado", jaEstava: true },
        error: null,
      });

      const r = await mudar(ID_ONLINE, "cancelled");

      expect(r.erro).toBeNull();
      expect(r.valor).toEqual({
        gravadoNoBancoEm: HORA_DO_BANCO,
        jaEstava: true,
      });
      expect(colunasLidas.some((c) => c.includes("updated_at"))).toBe(true);
      expect(toast.success).toHaveBeenCalledWith(
        "Este pedido já estava cancelado.",
      );
    });
  });

  describe("(b) avanço sem resposta reconhecido pela releitura da tentativa seguinte", () => {
    it("devolve o updated_at relido, nunca o relógio local", async () => {
      // 1ª tentativa: a gravação fica pendurada e a conferência ainda não vê
      // a etapa nova (a gravação chega ao banco depois).
      gravacao = () => new Promise(() => {});
      const primeira = await mudar(ID_DINHEIRO, "processing");
      expect(primeira.ok).toBe(false);

      // A gravação perdida passou; a 2ª tentativa relê e reconhece.
      statusNoBanco = "processing";
      const segunda = await mudar(ID_DINHEIRO, "processing", "pending");

      expect(segunda.erro).toBeNull();
      expect(segunda.valor).toEqual({ gravadoNoBancoEm: HORA_DO_BANCO });
      // Reconhecida pela releitura: nenhuma segunda gravação.
      expect(
        rpc.mock.calls.filter(([nome]) => nome === "avancar_status_do_pedido"),
      ).toHaveLength(1);
    });
  });

  describe("(c) avanço cujo prazo estourou, mas que gravou", () => {
    it("prazo estourado: devolve o updated_at da conferência, nunca o relógio local", async () => {
      gravacao = () => {
        statusNoBanco = "processing";
        return new Promise(() => {});
      };

      const r = await mudar(ID_DINHEIRO, "processing");

      expect(r.erro).toBeNull();
      expect(r.valor).toEqual({ gravadoNoBancoEm: HORA_DO_BANCO });
    });

    it("rede caiu na volta (erro sem código): também devolve a hora da conferência", async () => {
      gravacao = async () => {
        statusNoBanco = "processing";
        return { data: null, error: { message: "Failed to fetch" } };
      };

      const r = await mudar(ID_DINHEIRO, "processing");

      expect(r.erro).toBeNull();
      expect(r.valor).toEqual({ gravadoNoBancoEm: HORA_DO_BANCO });
    });

    it('controle: a conferência não vê a etapa — continua falhando como antes ("não sei" nunca vira "gravou")', async () => {
      gravacao = () => new Promise(() => {});

      const r = await mudar(ID_DINHEIRO, "processing");

      expect(r.ok).toBe(false);
    });
  });
});

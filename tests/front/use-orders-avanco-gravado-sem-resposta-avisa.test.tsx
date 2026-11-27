// @vitest-environment jsdom
/**
 * Avançar status (lojista) quando o banco GRAVA mas a resposta se perde (rede
 * caiu, prazo da tela estourou). Antes: a tela voltava à etapa antiga, mostrava
 * erro, e o aviso à cliente (`avisarOClienteDoStatus`, que a ficha só dispara
 * quando `updateOrderStatus` RESOLVE) nunca saía. Tentar de novo caía em
 * `ErroPedidoMudou` (o servidor já estava na etapa) e também não avisava.
 *
 * O contrato com a ficha (AdminOrdersView.handleStatusChange) é o de sempre:
 * resolveu = gravou e a cliente é avisada; rejeitou = não avisa. Por isso aqui
 * basta provar QUANDO `updateOrderStatus` resolve e quando rejeita.
 *
 * Mesma sonda de use-orders-avancar-status-com-prazo.test.tsx.
 */
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
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
  useAuth: () => ({ user: { id: "usuario-sem-resposta" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
import {
  ErroPedidoMudou,
  MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA,
  PRAZO_DO_AVANCO_DE_STATUS_MS,
  VALIDADE_DA_MARCA_DO_AVANCO_MS,
  useOrders,
} from "@/hooks/useOrders";
import type { OrderStatus } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(id: string, status = "pending") {
  return {
    id,
    status,
    updated_at: "2026-11-27T10:00:00Z",
    created_at: "2026-11-27T09:00:00Z",
    user_id: "cliente-1",
    customer_name: "Cliente Teste",
    items: [],
    payment_method: "cash",
    payment_status: null,
    cancelled_after_shipping: false,
  };
}
type Resposta = { data: unknown; error: unknown };

let atuais: ReturnType<typeof useOrders>;
/** O que o banco tem de verdade (lido pela releitura). */
let statusNoBanco: string;
let gravacao: () => Promise<Resposta>;
let releitura: () => Promise<Resposta>;
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

const FALHA_DE_REDE = {
  message: "TypeError: Failed to fetch",
  details: "",
  hint: "",
  code: "",
};
const ID = "PED-1";

const gravacoes = () =>
  rpc.mock.calls.filter(([nome]) => nome === "avancar_status_do_pedido");
/** A releitura de ANTES da gravação responde; a conferência depois, não. */
function redeCaiDepoisDaPrimeiraLeitura() {
  let leituras = 0;
  releitura = () =>
    leituras++ === 0
      ? Promise.resolve({ data: { status: statusNoBanco }, error: null })
      : new Promise(() => {});
}
const statusNaTela = () => atuais.orders.find((o) => o.id === ID)?.status;

/** Clica e devolve o desfecho (a chamada termina dentro do `act`). */
async function avancar(
  status: OrderStatus,
  statusEsperado?: OrderStatus,
): Promise<{ ok: boolean; erro: unknown }> {
  const desfecho = { ok: false, erro: null as unknown };
  await act(async () => {
    const promessa = atuais
      .updateOrderStatus(ID, status, undefined, false, statusEsperado)
      .then(
        () => {
          desfecho.ok = true;
        },
        (erro: unknown) => {
          desfecho.erro = erro;
        },
      );
    // Prazo da gravação + prazo da conferência: o suficiente para qualquer
    // espera pendurada terminar.
    await vi.advanceTimersByTimeAsync(PRAZO_DO_AVANCO_DE_STATUS_MS * 2);
    await promessa;
  });
  return desfecho;
}

describe("Avançar status: gravou no banco, mas a resposta se perdeu", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    statusNoBanco = "pending";
    gravacao = async () => ({ data: null, error: null });
    releitura = async () => ({ data: { status: statusNoBanco }, error: null });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) =>
      nome === "get_admin_orders_paged"
        ? {
            abortSignal: () =>
              Promise.resolve({
                data: { data: [linha(ID, statusNoBanco)], total_count: 1 },
                error: null,
              }),
          }
        : gravacao(),
    );
    from.mockReset();
    from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: () => releitura() }) }),
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

  it("(a) prazo estourou mas o banco gravou: vira SUCESSO (resolve, aviso verde, tela na etapa nova) — a ficha avisa a cliente", async () => {
    gravacao = () => {
      statusNoBanco = "processing"; // gravou; a resposta é que não volta
      return new Promise(() => {});
    };

    const r = await avancar("processing");

    expect(r.erro).toBeNull();
    expect(r.ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Status atualizado com sucesso");
    expect(toast.error).not.toHaveBeenCalled();
    expect(statusNaTela()).toBe("processing");
    expect(gravacoes()).toHaveLength(1);
  });

  it("(a) rede caiu na volta ('Failed to fetch', sem código) mas o banco gravou: também vira sucesso", async () => {
    gravacao = async () => {
      statusNoBanco = "processing";
      return { data: null, error: FALHA_DE_REDE };
    };

    const r = await avancar("processing");

    expect(r.ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Status atualizado com sucesso");
    expect(toast.error).not.toHaveBeenCalled();
    expect(statusNaTela()).toBe("processing");
  });

  it("(c) controle: sem resposta e o banco NÃO gravou — continua o erro honesto de hoje e a tela volta", async () => {
    gravacao = () => new Promise(() => {});

    const r = await avancar("processing");

    expect(r.ok).toBe(false);
    expect((r.erro as Error).message).toBe(
      MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA,
    );
    expect(toast.error).toHaveBeenCalledWith(
      MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA,
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(statusNaTela()).toBe("pending");
  });

  it("(c) recusa de verdade do servidor (com código) nem confere de novo: erro de sempre, mesmo que o banco esteja na etapa pedida por outra pessoa", async () => {
    gravacao = async () => {
      statusNoBanco = "processing"; // outro aparelho avançou (e avisou)
      return {
        data: null,
        error: {
          code: "P0001",
          message: "pedido_status_mudou: O pedido mudou de situação",
        },
      };
    };

    const r = await avancar("processing");

    expect(r.ok).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    // só a releitura de ANTES da gravação
    expect(from).toHaveBeenCalledTimes(1);

    // tela velha tenta de novo: o banco já está lá, mas o avanço não era
    // nosso — continua o aviso "mudou", sem sucesso (a cliente não recebe
    // um segundo aviso)
    vi.clearAllMocks();
    const r2 = await avancar("processing", "pending");
    expect(r2.erro).toBeInstanceOf(ErroPedidoMudou);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("(b) a conferência também não respondeu; o banco gravou depois — a nova tentativa vira SUCESSO sem gravar de novo", async () => {
    gravacao = () => new Promise(() => {});
    redeCaiDepoisDaPrimeiraLeitura(); // a conferência também fica sem resposta

    const r = await avancar("processing", "pending");
    expect(r.ok).toBe(false);
    expect(statusNaTela()).toBe("pending");

    // a rede volta; a gravação perdida tinha passado
    statusNoBanco = "processing";
    releitura = async () => ({ data: { status: statusNoBanco }, error: null });
    vi.clearAllMocks();

    const r2 = await avancar("processing", "pending");

    expect(r2.erro).toBeNull();
    expect(r2.ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Status atualizado com sucesso");
    expect(toast.warning).not.toHaveBeenCalled();
    expect(statusNaTela()).toBe("processing");
    expect(gravacoes()).toHaveLength(0);
  });

  it("(b)+(c) nova tentativa com o banco em OUTRA etapa (alguém cancelou): erro 'mudou' de hoje, sem sucesso", async () => {
    gravacao = () => new Promise(() => {});
    redeCaiDepoisDaPrimeiraLeitura();
    await avancar("processing", "pending");

    statusNoBanco = "cancelled";
    releitura = async () => ({ data: { status: statusNoBanco }, error: null });
    vi.clearAllMocks();

    const r2 = await avancar("processing", "pending");

    expect(r2.erro).toBeInstanceOf(ErroPedidoMudou);
    expect((r2.erro as ErroPedidoMudou).statusVerdadeiro).toBe("cancelled");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("(d) nunca duas vezes: depois do sucesso recuperado, outra tentativa da tela velha volta a ser 'mudou'", async () => {
    gravacao = () => new Promise(() => {});
    redeCaiDepoisDaPrimeiraLeitura();
    await avancar("processing", "pending");

    statusNoBanco = "processing";
    releitura = async () => ({ data: { status: statusNoBanco }, error: null });
    const r2 = await avancar("processing", "pending");
    expect(r2.ok).toBe(true);

    vi.clearAllMocks();
    const r3 = await avancar("processing", "pending");

    expect(r3.erro).toBeInstanceOf(ErroPedidoMudou);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("(d) a marca vale por 2 min: a tentativa DENTRO do prazo ainda vira sucesso", async () => {
    gravacao = () => new Promise(() => {});
    redeCaiDepoisDaPrimeiraLeitura();
    await avancar("processing", "pending");

    statusNoBanco = "processing";
    releitura = async () => ({ data: { status: statusNoBanco }, error: null });
    await act(async () => {
      // a 1ª tentativa já avançou o relógio; somado, ainda dentro dos 2 min
      await vi.advanceTimersByTimeAsync(
        VALIDADE_DA_MARCA_DO_AVANCO_MS - PRAZO_DO_AVANCO_DE_STATUS_MS * 2,
      );
    });
    vi.clearAllMocks();

    const r2 = await avancar("processing", "pending");

    expect(r2.ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Status atualizado com sucesso");
  });

  it("(d) marca vencida (outro aparelho pode ter avançado e avisado): a tentativa horas depois dá 'mudou' e não avisa", async () => {
    // a gravação do tablet nem chegou ao servidor; a marca fica
    gravacao = () => new Promise(() => {});
    redeCaiDepoisDaPrimeiraLeitura();
    await avancar("processing", "pending");

    // o celular avança (e avisa a cliente); o tablet volta muito depois
    statusNoBanco = "processing";
    releitura = async () => ({ data: { status: statusNoBanco }, error: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VALIDADE_DA_MARCA_DO_AVANCO_MS + 1);
    });
    vi.clearAllMocks();

    const r2 = await avancar("processing", "pending");

    expect(r2.erro).toBeInstanceOf(ErroPedidoMudou);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(gravacoes()).toHaveLength(0);
  });

  it("(d) relógio do aparelho voltou 1 dia: a marca não revive — 'mudou' e sem aviso", async () => {
    gravacao = () => new Promise(() => {});
    redeCaiDepoisDaPrimeiraLeitura();
    await avancar("processing", "pending");

    statusNoBanco = "processing";
    releitura = async () => ({ data: { status: statusNoBanco }, error: null });
    vi.setSystemTime(Date.now() - 24 * 60 * 60 * 1000);
    vi.clearAllMocks();

    const r2 = await avancar("processing", "pending");

    expect(r2.erro).toBeInstanceOf(ErroPedidoMudou);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(gravacoes()).toHaveLength(0);
  });

  it("(d) nunca duas vezes: o sucesso confirmado na hora não deixa marca para uma tentativa seguinte", async () => {
    gravacao = () => {
      statusNoBanco = "processing";
      return new Promise(() => {});
    };
    const r = await avancar("processing", "pending");
    expect(r.ok).toBe(true);

    vi.clearAllMocks();
    const r2 = await avancar("processing", "pending");

    expect(r2.erro).toBeInstanceOf(ErroPedidoMudou);
    expect(toast.success).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
/**
 * Avançar status (lojista) com rede "pendurada": a conexão abre e não
 * responde. Sem prazo, a RPC `avancar_status_do_pedido` (ou
 * `update_order_status_atomic`, no cancelamento que não passa pela edge) e a
 * releitura do status que vem antes dela nunca terminavam, o `finally` da
 * ficha nunca rodava e o botão ficava em "Processando" para sempre.
 *
 * O prazo só encerra a ESPERA DA TELA: a gravação segue no servidor e pode ter
 * dado certo. Por isso a frase NÃO afirma que falhou: diz que não sabe e manda
 * conferir o pedido. A regra não muda: uma única gravação (nada de reenvio
 * automático), a mesma RPC com os mesmos argumentos, e o otimista é desfeito
 * (o eco do servidor, se a gravação tiver passado, corrige a tela).
 *
 * Mesma sonda de avancar-pedido-que-falha-nao-apaga-o-que-chegou-do-servidor.
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
  useAuth: () => ({ user: { id: "usuario-prazo" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
import {
  MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA,
  PRAZO_DO_AVANCO_DE_STATUS_MS,
  useOrders,
} from "@/hooks/useOrders";
import { ehConsultaSemResposta } from "@/lib/prazo-da-requisicao";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ANTES = "2026-10-16T10:00:00Z";

function linha(id: string, status = "pending") {
  return {
    id,
    status,
    updated_at: ANTES,
    created_at: "2026-10-16T09:00:00Z",
    user_id: "usuario-prazo",
    customer_name: "Cliente Teste",
    items: [],
    payment_method: "cash",
    payment_status: null,
    cancelled_after_shipping: false,
  };
}
type Resposta = { data: unknown; error: unknown };
function pagina(linhas: ReturnType<typeof linha>[]): Resposta {
  return { data: { data: linhas, total_count: linhas.length }, error: null };
}

let atuais: ReturnType<typeof useOrders>;
let linhasDoServidor: ReturnType<typeof linha>[] = [];
let gravacao: () => Promise<Resposta>;
let releitura: (id: string) => Promise<Resposta>;
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

const gravacoesDeStatus = () =>
  rpc.mock.calls.filter(
    ([nome]) =>
      nome === "avancar_status_do_pedido" ||
      nome === "update_order_status_atomic",
  );

/** Clica e devolve o que a chamada fará (resolve ou rejeita). */
function clicar(id: string, status: "processing" | "cancelled") {
  const desfecho: { settled: boolean; erro: unknown } = {
    settled: false,
    erro: null,
  };
  const promessa = atuais.updateOrderStatus(id, status).then(
    () => {
      desfecho.settled = true;
    },
    (erro: unknown) => {
      desfecho.settled = true;
      desfecho.erro = erro;
    },
  );
  return { desfecho, promessa };
}

describe("Avançar status: a espera da tela tem prazo", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gravacao = async () => ({ data: null, error: null });
    releitura = async (id) => ({
      data: linhasDoServidor.find((l) => l.id === id) ?? linha(id),
      error: null,
    });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) =>
      nome === "get_admin_orders_paged"
        ? { abortSignal: () => Promise.resolve(pagina(linhasDoServidor)) }
        : gravacao(),
    );
    from.mockReset();
    from.mockImplementation(() => ({
      select: () => ({
        eq: (_campo: string, id: string) => ({
          single: () => releitura(id),
        }),
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
  async function abrirComPedido(pedido: ReturnType<typeof linha>) {
    linhasDoServidor = [pedido];
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, "all");
    });
  }
  const statusDe = (id: string) =>
    atuais.orders.find((o) => o.id === id)?.status;

  it("a RPC de avançar nunca responde: depois do prazo a chamada TERMINA (o botão volta), com frase honesta, otimista desfeito e uma única gravação", async () => {
    await abrirComPedido(linha("PZ-1"));
    gravacao = () => new Promise(() => {}); // pendurada para sempre

    let clique!: ReturnType<typeof clicar>;
    await act(async () => {
      clique = clicar("PZ-1", "processing");
      await vi.advanceTimersByTimeAsync(PRAZO_DO_AVANCO_DE_STATUS_MS - 1);
    });
    // um instante antes do prazo: ainda "Processando", tela já mostra o otimista
    expect(clique.desfecho.settled).toBe(false);
    expect(statusDe("PZ-1")).toBe("processing");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await clique.promessa;
    });

    expect(clique.desfecho.settled).toBe(true);
    expect(ehConsultaSemResposta(clique.desfecho.erro)).toBe(true);
    expect((clique.desfecho.erro as Error).message).toBe(
      MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA,
    );
    // não afirma que falhou: diz que não sabe e manda conferir o pedido
    expect(MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA).toMatch(
      /não conseguimos confirmar/i,
    );
    expect(MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA).toMatch(/confira o pedido/i);
    expect(MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA).not.toMatch(
      /não foi possível atualizar/i,
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA,
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(statusDe("PZ-1")).toBe("pending");
    // a mesma RPC, uma vez só, com os argumentos de sempre (nenhum reenvio)
    expect(gravacoesDeStatus()).toHaveLength(1);
    expect(gravacoesDeStatus()[0]).toEqual([
      "avancar_status_do_pedido",
      {
        p_order_id: "PZ-1",
        p_status_esperado: "pending",
        p_new_status: "processing",
        p_notes: null,
      },
    ]);
  });

  it("cancelar pelo painel (RPC update_order_status_atomic, sem edge) também tem prazo", async () => {
    await abrirComPedido(linha("PZ-2"));
    gravacao = () => new Promise(() => {});

    let clique!: ReturnType<typeof clicar>;
    await act(async () => {
      clique = clicar("PZ-2", "cancelled");
      await vi.advanceTimersByTimeAsync(PRAZO_DO_AVANCO_DE_STATUS_MS);
      await clique.promessa;
    });

    expect(clique.desfecho.settled).toBe(true);
    expect(ehConsultaSemResposta(clique.desfecho.erro)).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(
      MENSAGEM_AVANCO_DE_STATUS_SEM_RESPOSTA,
    );
    expect(statusDe("PZ-2")).toBe("pending");
    expect(gravacoesDeStatus()).toHaveLength(1);
    expect(gravacoesDeStatus()[0]?.[0]).toBe("update_order_status_atomic");
  });

  it("borda: a resposta que chega ANTES do prazo vale (sucesso), e passar do prazo depois não desfaz nada", async () => {
    await abrirComPedido(linha("PZ-3"));
    let responder!: (r: Resposta) => void;
    gravacao = () =>
      new Promise<Resposta>((resolve) => {
        responder = resolve;
      });

    let clique!: ReturnType<typeof clicar>;
    await act(async () => {
      clique = clicar("PZ-3", "processing");
      await vi.advanceTimersByTimeAsync(PRAZO_DO_AVANCO_DE_STATUS_MS - 1000);
    });
    expect(clique.desfecho.settled).toBe(false);

    await act(async () => {
      responder({ data: null, error: null });
      await clique.promessa;
    });
    expect(clique.desfecho.erro).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Status atualizado com sucesso");
    expect(statusDe("PZ-3")).toBe("processing");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DO_AVANCO_DE_STATUS_MS * 2);
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(statusDe("PZ-3")).toBe("processing");
    expect(gravacoesDeStatus()).toHaveLength(1);
  });

  it("borda: a RPC responde com erro de verdade (antes do prazo): segue a frase de sempre, não a de 'sem resposta'", async () => {
    await abrirComPedido(linha("PZ-4"));
    gravacao = async () => ({ data: null, error: new Error("Falha simulada") });

    let clique!: ReturnType<typeof clicar>;
    await act(async () => {
      clique = clicar("PZ-4", "processing");
      await clique.promessa;
    });
    expect(clique.desfecho.settled).toBe(true);
    expect(ehConsultaSemResposta(clique.desfecho.erro)).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível atualizar o status do pedido agora. Tente novamente em instantes.",
    );
    expect(statusDe("PZ-4")).toBe("pending");
  });

  it("borda: a releitura do status (antes de gravar) pendurada também termina, e NADA é gravado", async () => {
    await abrirComPedido(linha("PZ-5"));
    releitura = () => new Promise(() => {});

    let clique!: ReturnType<typeof clicar>;
    await act(async () => {
      clique = clicar("PZ-5", "processing");
      await vi.advanceTimersByTimeAsync(PRAZO_DO_AVANCO_DE_STATUS_MS);
      await clique.promessa;
    });

    expect(clique.desfecho.settled).toBe(true);
    // falha FECHADA: sem confirmar o status real, nem otimista nem RPC
    expect(gravacoesDeStatus()).toHaveLength(0);
    expect(statusDe("PZ-5")).toBe("pending");
    expect(toast.warning).toHaveBeenCalledWith(
      "Não foi possível conferir o pedido agora.",
      expect.anything(),
    );
  });
});

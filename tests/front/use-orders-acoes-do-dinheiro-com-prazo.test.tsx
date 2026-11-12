// @vitest-environment jsdom
/**
 * Achado 13 — as ações do lojista que mexem em dinheiro e em estoque
 * ("Marcar como recebido", desfazer o recebimento e "O produto voltou") com
 * rede "pendurada": a conexão abre e não responde. Sem prazo o botão ficava
 * em "Registrando..." desligado, o app mantinha a operação como sensível (e
 * adiava a atualização obrigatória) e a lojista só saía recarregando, sem
 * saber se o dinheiro/estoque tinha sido gravado.
 *
 * O prazo só encerra a ESPERA DA TELA: a gravação segue no servidor e pode ter
 * dado certo. Por isso a frase NÃO afirma que falhou (diz que não há resposta
 * e manda conferir), o botão solta, a lista é relida e a resposta tardia NÃO
 * vira aviso nem mexe na tela. Repetir o toque é seguro: as duas RPCs são
 * idempotentes no banco (ja_estava / ja_confirmado, sob FOR UPDATE) e aqui o
 * hook não reenvia nada sozinho.
 *
 * Mesma sonda de use-orders-avancar-status-com-prazo.
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
import { useOrders } from "@/hooks/useOrders";
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import {
  MENSAGEM_ACAO_DO_PEDIDO_SEM_RESPOSTA,
  PRAZO_DAS_ACOES_DO_PEDIDO_MS,
  ehConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE = "Sem resposta da rede. Confira o pedido antes de tentar de novo.";

type Resposta = { data: unknown; error: unknown };

function linha(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: "pending",
    updated_at: "2026-10-16T10:00:00Z",
    created_at: "2026-10-16T09:00:00Z",
    user_id: "usuario-prazo",
    customer_name: "Cliente Teste",
    items: [],
    payment_method: "cash",
    payment_status: null,
    cancelled_after_shipping: false,
    ...extra,
  };
}

let atuais: ReturnType<typeof useOrders>;
let linhasDoServidor: ReturnType<typeof linha>[] = [];
let gravacao: (nome: string) => Promise<Resposta>;
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

const chamadasDe = (nome: string) => rpc.mock.calls.filter(([n]) => n === nome);

/** Dispara a ação e devolve como ela terminou (resolve ou rejeita). */
function disparar(acao: () => Promise<unknown>) {
  const desfecho: { settled: boolean; erro: unknown } = {
    settled: false,
    erro: null,
  };
  const promessa = acao().then(
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

describe("Ações do lojista que gravam: a espera da tela tem prazo", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gravacao = async () => ({ data: null, error: null });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_admin_orders_paged") {
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: linhasDoServidor,
                total_count: linhasDoServidor.length,
              },
              error: null,
            }),
        };
      }
      if (nome === "get_admin_orders_cancelados_recentes") {
        return {
          abortSignal: () =>
            Promise.resolve({
              data: { data: [], total_count: 0, fora_da_janela: 0 },
              error: null,
            }),
        };
      }
      return gravacao(nome);
    });
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
  async function abrirComPedido(pedido: ReturnType<typeof linha>) {
    linhasDoServidor = [pedido];
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, "all");
    });
    rpc.mockClear();
  }
  const pagamentoDe = (id: string) =>
    atuais.orders.find((o) => o.id === id)?.paymentStatus;

  it("a frase é exatamente a combinada e não afirma que falhou", () => {
    expect(MENSAGEM_ACAO_DO_PEDIDO_SEM_RESPOSTA).toBe(FRASE);
    expect(FRASE).not.toMatch(/não foi possível|não foi feito|falhou/i);
    expect(PRAZO_DAS_ACOES_DO_PEDIDO_MS).toBe(20_000);
  });

  it("Marcar como recebido pendurado: depois do prazo o botão solta, com a frase honesta, sem marcar como pago, e a atualização deixa de esperar", async () => {
    await abrirComPedido(linha("R-1"));
    gravacao = () => new Promise(() => {}); // pendurada para sempre

    let clique!: ReturnType<typeof disparar>;
    await act(async () => {
      clique = disparar(() => atuais.registrarPagamentoRecebido("R-1", true));
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS - 1);
    });
    // um instante antes do prazo: ainda "Registrando", operação sensível ligada
    expect(clique.desfecho.settled).toBe(false);
    expect(haOperacaoSensivel()).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await clique.promessa;
    });

    expect(clique.desfecho.settled).toBe(true);
    expect(ehConsultaSemResposta(clique.desfecho.erro)).toBe(true);
    expect((clique.desfecho.erro as Error).message).toBe(FRASE);
    // um aviso só, com a frase; NUNCA "não foi possível registrar"
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(FRASE);
    expect(toast.success).not.toHaveBeenCalled();
    // não pinta o pedido como recebido, e solta a trava da atualização
    expect(pagamentoDe("R-1")).toBeFalsy();
    expect(haOperacaoSensivel()).toBe(false);
    // uma única gravação, nenhum reenvio automático
    expect(chamadasDe("registrar_pagamento_recebido")).toEqual([
      ["registrar_pagamento_recebido", { p_order_id: "R-1", p_recebido: true }],
    ]);
  });

  it("estourou o prazo: o pedido é relido (lista e painel de cancelados), porque a gravação pode ter passado", async () => {
    await abrirComPedido(linha("R-2"));
    gravacao = () => new Promise(() => {});

    await act(async () => {
      const clique = disparar(() =>
        atuais.registrarPagamentoRecebido("R-2", true),
      );
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS - 1);
      expect(chamadasDe("get_admin_orders_paged")).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await clique.promessa;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(chamadasDe("get_admin_orders_paged")).toHaveLength(1);
    expect(chamadasDe("get_admin_orders_cancelados_recentes")).toHaveLength(1);
  });

  it("borda: a resposta que chega DEPOIS do prazo não vira aviso nem mexe no pedido", async () => {
    await abrirComPedido(linha("R-3"));
    let responder!: (r: Resposta) => void;
    gravacao = () =>
      new Promise<Resposta>((resolve) => {
        responder = resolve;
      });

    await act(async () => {
      const clique = disparar(() =>
        atuais.registrarPagamentoRecebido("R-3", true),
      );
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
      await clique.promessa;
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    vi.mocked(toast.error).mockClear();

    await act(async () => {
      responder({
        data: {
          payment_status: "recebido_na_entrega",
          pagamento_recebido_em: "2026-10-16T12:00:00Z",
        },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(10);
    });
    // resposta tardia: nenhum toast novo, nenhum sucesso, pedido como estava
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(pagamentoDe("R-3")).toBeFalsy();
  });

  it("borda: apertar de novo depois do estouro manda UMA gravação nova com os mesmos argumentos, e vale o que o banco devolve (ja_estava)", async () => {
    await abrirComPedido(linha("R-4"));
    gravacao = () => new Promise(() => {});
    await act(async () => {
      const clique = disparar(() =>
        atuais.registrarPagamentoRecebido("R-4", true),
      );
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
      await clique.promessa;
    });
    expect(chamadasDe("registrar_pagamento_recebido")).toHaveLength(1);

    // O servidor tinha gravado: o segundo toque devolve ja_estava, sem mexer.
    gravacao = async () => ({
      data: {
        ok: true,
        ja_estava: true,
        payment_status: "recebido_na_entrega",
        pagamento_recebido_em: "2026-10-16T12:00:00Z",
        pagamento_recebido_por: "lojista-1",
      },
      error: null,
    });
    let segundo!: ReturnType<typeof disparar>;
    await act(async () => {
      segundo = disparar(() => atuais.registrarPagamentoRecebido("R-4", true));
      await segundo.promessa;
    });
    expect(segundo.desfecho.erro).toBeNull();
    const chamadas = chamadasDe("registrar_pagamento_recebido");
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]).toEqual(chamadas[0]);
    expect(pagamentoDe("R-4")).toBe("recebido_na_entrega");
  });

  it("desfazer o recebimento pendurado também tem prazo, com a mesma frase", async () => {
    await abrirComPedido(
      linha("R-5", { payment_status: "recebido_na_entrega" }),
    );
    gravacao = () => new Promise(() => {});
    let clique!: ReturnType<typeof disparar>;
    await act(async () => {
      clique = disparar(() => atuais.registrarPagamentoRecebido("R-5", false));
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
      await clique.promessa;
    });
    expect(clique.desfecho.settled).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(FRASE);
    expect(pagamentoDe("R-5")).toBe("recebido_na_entrega");
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("borda: a resposta que chega ANTES do prazo vale (sucesso) e o prazo que passa depois não desfaz nada", async () => {
    await abrirComPedido(linha("R-6"));
    let responder!: (r: Resposta) => void;
    gravacao = () =>
      new Promise<Resposta>((resolve) => {
        responder = resolve;
      });
    let clique!: ReturnType<typeof disparar>;
    await act(async () => {
      clique = disparar(() => atuais.registrarPagamentoRecebido("R-6", true));
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS - 1000);
    });
    await act(async () => {
      responder({
        data: {
          payment_status: "recebido_na_entrega",
          pagamento_recebido_em: "2026-10-16T12:00:00Z",
        },
        error: null,
      });
      await clique.promessa;
    });
    expect(clique.desfecho.erro).toBeNull();
    expect(pagamentoDe("R-6")).toBe("recebido_na_entrega");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS * 2);
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(pagamentoDe("R-6")).toBe("recebido_na_entrega");
    // sem erro nem prazo estourado: nenhuma releitura extra
    expect(chamadasDe("get_admin_orders_paged")).toHaveLength(0);
  });

  it("borda: erro DE VERDADE do servidor (antes do prazo) segue com a frase de sempre, não a de 'sem resposta'", async () => {
    await abrirComPedido(linha("R-7"));
    gravacao = async () => ({
      data: null,
      error: {
        code: "P0001",
        message: "Pedido cancelado não recebe pagamento.",
      },
    });
    let clique!: ReturnType<typeof disparar>;
    await act(async () => {
      clique = disparar(() => atuais.registrarPagamentoRecebido("R-7", true));
      await clique.promessa;
    });
    expect(ehConsultaSemResposta(clique.desfecho.erro)).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível registrar o pagamento recebido.",
      { description: "Pedido cancelado não recebe pagamento." },
    );
    expect(chamadasDe("get_admin_orders_paged")).toHaveLength(0);
  });

  it("O produto voltou pendurado: depois do prazo termina com a frase honesta, sem marcar o retorno, e relê os cancelados", async () => {
    await abrirComPedido(
      linha("P-1", { status: "cancelled", cancelled_after_shipping: true }),
    );
    gravacao = () => new Promise(() => {});
    let clique!: ReturnType<typeof disparar>;
    await act(async () => {
      clique = disparar(() => atuais.confirmarRetornoDoProduto("P-1"));
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS - 1);
      expect(clique.desfecho.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await clique.promessa;
    });
    expect(clique.desfecho.settled).toBe(true);
    expect(ehConsultaSemResposta(clique.desfecho.erro)).toBe(true);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(FRASE);
    expect(toast.success).not.toHaveBeenCalled();
    expect(
      atuais.orders.find((o) => o.id === "P-1")?.returnedToSellerAt,
    ).toBeFalsy();
    expect(chamadasDe("confirmar_retorno_do_produto")).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(chamadasDe("get_admin_orders_cancelados_recentes")).toHaveLength(1);
  });

  it("O produto voltou: a resposta tardia não vira aviso, e apertar de novo recebe ja_confirmado do banco", async () => {
    await abrirComPedido(
      linha("P-2", { status: "cancelled", cancelled_after_shipping: true }),
    );
    let responder!: (r: Resposta) => void;
    gravacao = () =>
      new Promise<Resposta>((resolve) => {
        responder = resolve;
      });
    await act(async () => {
      const clique = disparar(() => atuais.confirmarRetornoDoProduto("P-2"));
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
      await clique.promessa;
    });
    vi.mocked(toast.error).mockClear();
    await act(async () => {
      responder({ data: { ok: true, ja_confirmado: false }, error: null });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    gravacao = async () => ({
      data: {
        ok: true,
        ja_confirmado: true,
        returned_to_seller_at: "2026-10-16T12:00:00Z",
      },
      error: null,
    });
    await act(async () => {
      await atuais.confirmarRetornoDoProduto("P-2");
    });
    expect(chamadasDe("confirmar_retorno_do_produto")).toHaveLength(2);
    expect(toast.success).toHaveBeenCalledWith(
      "Este retorno já tinha sido confirmado antes. Nada mudou no estoque.",
    );
  });
});

// @vitest-environment jsdom
/**
 * "Avançar" que FALHA não pode apagar o que o servidor já contou sobre o MESMO
 * pedido enquanto a gravação estava no ar.
 *
 * O hook pinta o novo status na hora (atualização otimista) e, se a gravação
 * falha, desfaz. Até aqui o desfazer devolvia a CÓPIA INTEIRA do pedido tirada
 * antes do clique — o que protegia os OUTROS pedidos (ver C2, B), mas passava
 * por cima do próprio: o pagamento que o Mercado Pago confirmou, o cancelamento
 * que a cliente fez ou o status que outra pessoa da loja gravou no meio do
 * caminho sumiam da tela, e o painel mostrava o pedido como ele era antes — com
 * o status ERRADO e a data de pagamento perdida — até a próxima recarga.
 *
 * Regra provada aqui: o desfazer devolve SÓ o que a atualização otimista
 * escreveu (status e a marca de "já tinha saído"), e só se o pedido ainda está
 * como ela o deixou. Se chegou uma versão mais nova do servidor, a mais nova
 * vale. Sem reenvio: a gravação é tentada uma vez.
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
  useAuth: () => ({ user: { id: "usuario-av" }, isAdmin: true }),
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

const ANTES = "2026-10-16T10:00:00Z";
const DEPOIS = "2026-10-16T10:05:00Z";

function linha(
  id: string,
  status = "pending",
  updated_at = ANTES,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    status,
    updated_at,
    created_at: "2026-10-16T09:00:00Z",
    user_id: "usuario-av",
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
function pagina(linhas: ReturnType<typeof linha>[]): Resposta {
  return { data: { data: linhas, total_count: linhas.length }, error: null };
}

let atuais: ReturnType<typeof useOrders>;
let linhasDoServidor: ReturnType<typeof linha>[] = [];
let gravacao: () => Promise<Resposta>;
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}
async function emitir(eventType: string, novaLinha: ReturnType<typeof linha>) {
  expect(evento).toBeDefined();
  await act(async () => {
    await evento!({ eventType, new: novaLinha, old: {} });
  });
}

describe("Avançar que falha desfaz só o que ele mesmo escreveu", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    evento = undefined;
    gravacao = async () => ({ data: null, error: null });
    rpc.mockReset();
    rpc.mockImplementation((nome: string) =>
      nome === "get_admin_orders_paged"
        ? { abortSignal: () => Promise.resolve(pagina(linhasDoServidor)) }
        : gravacao(),
    );
    from.mockReset();
    // A releitura do status antes de avançar devolve o status que a tela
    // tinha: o servidor ainda concorda na hora do clique.
    from.mockImplementation(() => ({
      select: () => ({
        eq: (_campo: string, id: string) => ({
          single: () =>
            Promise.resolve({
              data: linhasDoServidor.find((l) => l.id === id) ?? linha(id),
              error: null,
            }),
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
  /** Clica em Avançar com a gravação segurada, deixa o servidor falar, e então falha. */
  async function avancarQueFalha(
    id: string,
    novoStatus: "processing" | "cancelled",
    durante: () => Promise<void>,
  ) {
    const envio = adiada();
    gravacao = () => envio.promessa;
    let resultado!: Promise<unknown>;
    await act(async () => {
      resultado = atuais
        .updateOrderStatus(id, novoStatus)
        .catch((erro: unknown) => erro);
    });
    // A tela já mostra o novo status (otimista) enquanto a gravação está no ar.
    expect(atuais.orders.find((o) => o.id === id)?.status).toBe(novoStatus);
    await durante();
    await act(async () => {
      envio.concluir({ data: null, error: new Error("Falha simulada") });
      await resultado;
    });
  }
  const gravacoesDeStatus = () =>
    rpc.mock.calls.filter(
      ([nome]) =>
        nome === "avancar_status_do_pedido" ||
        nome === "update_order_status_atomic",
    ).length;

  it("controle: sem nada no meio, a falha devolve o status de antes (e só tenta uma vez)", async () => {
    await abrirComPedido(linha("AV-1"));
    await avancarQueFalha("AV-1", "processing", async () => {});
    const pedido = atuais.orders.find((o) => o.id === "AV-1");
    expect(pedido?.status).toBe("pending");
    expect(gravacoesDeStatus()).toBe(1);
  });

  it("controle: cancelar um pedido enviado que falha desfaz também a marca de 'já tinha saído'", async () => {
    await abrirComPedido(linha("AV-2", "shipping"));
    await avancarQueFalha("AV-2", "cancelled", async () => {
      expect(
        atuais.orders.find((o) => o.id === "AV-2")?.cancelledAfterShipping,
      ).toBe(true);
    });
    const pedido = atuais.orders.find((o) => o.id === "AV-2");
    expect(pedido?.status).toBe("shipping");
    expect(pedido?.cancelledAfterShipping).toBe(false);
  });

  it("o pagamento que chegou no meio do caminho não some quando o Avançar falha", async () => {
    await abrirComPedido(linha("AV-3"));
    await avancarQueFalha("AV-3", "processing", async () => {
      // O Mercado Pago confirma o PIX; o servidor ainda está em 'pending'.
      await emitir(
        "UPDATE",
        linha("AV-3", "pending", DEPOIS, {
          payment_status: "pago",
          paid_at: DEPOIS,
        }),
      );
    });
    const pedido = atuais.orders.find((o) => o.id === "AV-3");
    expect(pedido?.paymentStatus).toBe("pago");
    expect(pedido?.status).toBe("pending");
    expect(gravacoesDeStatus()).toBe(1);
  });

  it("o cancelamento da cliente que chegou no meio do caminho continua valendo", async () => {
    await abrirComPedido(linha("AV-4"));
    await avancarQueFalha("AV-4", "processing", async () => {
      await emitir("UPDATE", linha("AV-4", "cancelled", DEPOIS));
    });
    // Antes: voltava para "pending" e a lojista via um pedido vivo que já estava cancelado.
    expect(atuais.orders.find((o) => o.id === "AV-4")?.status).toBe(
      "cancelled",
    );
  });

  it("se outra pessoa da loja já gravou o MESMO status, a falha não o troca por um velho", async () => {
    await abrirComPedido(linha("AV-5"));
    await avancarQueFalha("AV-5", "processing", async () => {
      // O servidor já está em 'processing' (gravado por outra aba): o status
      // otimista e o verdadeiro coincidem, mas a versão é mais nova.
      await emitir("UPDATE", linha("AV-5", "processing", DEPOIS));
    });
    expect(atuais.orders.find((o) => o.id === "AV-5")?.status).toBe(
      "processing",
    );
  });

  it("uma recarga que termina no meio do caminho também não é desfeita (nem a cópia guardada no aparelho)", async () => {
    await abrirComPedido(linha("AV-6"));
    await avancarQueFalha("AV-6", "processing", async () => {
      // Uma consulta nova termina com o pedido já pago e mais novo.
      linhasDoServidor = [
        linha("AV-6", "pending", DEPOIS, { payment_status: "pago" }),
      ];
      await act(async () => {
        await atuais.loadOrders(0, 12, "all");
      });
    });
    expect(atuais.orders.find((o) => o.id === "AV-6")?.paymentStatus).toBe(
      "pago",
    );
    // Remonta: o estado inicial vem do cache do módulo, sem nova consulta.
    await act(async () => {
      raiz.unmount();
      await vi.advanceTimersByTimeAsync(4001);
    });
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    const pedido = atuais.orders.find((o) => o.id === "AV-6");
    expect(pedido?.paymentStatus).toBe("pago");
    expect(pedido?.status).toBe("pending");
  });
});

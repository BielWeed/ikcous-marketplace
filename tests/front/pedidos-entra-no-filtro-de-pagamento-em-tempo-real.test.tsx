// @vitest-environment jsdom
// Achado 15: com status "Todos" e um filtro de pagamento ligado (Recusado,
// Estornado, Expirado, Pago após expirar...), o pedido que passa a ter esse
// pagamento em tempo real NÃO entrava na lista nem no total: a releitura só
// existia para o filtro "Pago" e para quem SAI do filtro. A lista agora é
// relida (mesmo debounce de 400 ms) quando um pedido de fora passa a ter o
// pagamento filtrado.
import { useOrders } from "@/hooks/useOrders";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let evento: ((payload: unknown) => Promise<void>) | undefined;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    channel: () => {
      const canal = {
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
  useAuth: () => ({ user: { id: "admin-entra-no-filtro" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(id: string, payment_status = "pago", status = "pending") {
  return {
    id,
    payment_status,
    status,
    customer_name: "Cliente Teste",
    created_at: "2026-10-16T10:00:00Z",
    updated_at: "2026-10-16T11:00:00Z",
    items: [],
  };
}

let atuais: ReturnType<typeof useOrders>;
let linhas: ReturnType<typeof linha>[];
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

async function emitir(
  nova: ReturnType<typeof linha>,
  anterior: Partial<ReturnType<typeof linha>> = {},
) {
  expect(evento).toBeDefined();
  await act(async () => {
    await evento!({ eventType: "UPDATE", new: nova, old: anterior });
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Pedidos — com status Todos e filtro de pagamento, quem passa a ter esse pagamento entra na lista e no total", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    evento = undefined;
    linhas = [];
    rpc.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome !== "get_admin_orders_paged") {
        throw new Error(`RPC inesperada: ${nome}`);
      }
      return {
        abortSignal: () =>
          Promise.resolve({
            data: { data: linhas, total_count: linhas.length },
            error: null,
          }),
      };
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
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
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      // Libera o canal compartilhado antes do próximo teste.
      await vi.advanceTimersByTimeAsync(4001);
    });
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function carregar(status: string, pagamento: string) {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(
        0,
        12,
        status,
        "",
        undefined,
        undefined,
        false,
        pagamento,
      );
    });
    rpc.mockClear();
  }

  it.each(["recusado", "estornado", "expirado", "pago_apos_expirar"])(
    "Todos + filtro '%s': pedido de fora passa a ter esse pagamento -> relê a lista uma vez e entra no total",
    async (pagamento) => {
      linhas = [linha("ja-esta", pagamento)];
      await carregar("all", pagamento);
      expect(atuais.orders.map((p) => p.id)).toEqual(["ja-esta"]);
      expect(atuais.totalOrders).toBe(1);

      // O servidor, agora, devolve também o pedido que acabou de entrar.
      linhas = [linha("novo", pagamento), linha("ja-esta", pagamento)];
      await emitir(linha("novo", pagamento), linha("novo", "aguardando"));
      await avancar(399);
      expect(rpc).not.toHaveBeenCalled();
      await avancar(1);
      expect(rpc).toHaveBeenCalledExactlyOnceWith(
        "get_admin_orders_paged",
        expect.objectContaining({
          p_status: "all",
          p_payment_status: pagamento,
        }),
      );
      expect(atuais.orders.map((p) => p.id)).toEqual(["novo", "ja-esta"]);
      expect(atuais.totalOrders).toBe(2);
    },
  );

  it("vale também sem a imagem anterior da linha (evento só com a versão nova)", async () => {
    linhas = [];
    await carregar("all", "recusado");
    linhas = [linha("novo", "recusado")];
    await emitir(linha("novo", "recusado"));
    await avancar(400);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(atuais.totalOrders).toBe(1);
  });

  it("rajada de pedidos que entram no filtro paga UMA releitura só", async () => {
    linhas = [];
    await carregar("all", "recusado");
    linhas = [linha("a", "recusado"), linha("b", "recusado")];
    await emitir(linha("a", "recusado"), linha("a", "aguardando"));
    await avancar(200);
    await emitir(linha("b", "recusado"), linha("b", "aguardando"));
    await avancar(399);
    expect(rpc).not.toHaveBeenCalled();
    await avancar(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(atuais.totalOrders).toBe(2);
  });

  it("não relê quando o pedido de fora passa a OUTRO pagamento (não é o do filtro)", async () => {
    linhas = [linha("ja-esta", "recusado")];
    await carregar("all", "recusado");
    await emitir(linha("outro", "pago"), linha("outro", "aguardando"));
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não relê quando o pagamento do pedido de fora NÃO mudou (só outro campo mudou)", async () => {
    linhas = [linha("ja-esta", "recusado")];
    await carregar("all", "recusado");
    await emitir(
      linha("outra-pagina", "recusado", "processing"),
      linha("outra-pagina", "recusado", "pending"),
    );
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não relê por pedido que já está na lista (a mescla local basta)", async () => {
    linhas = [linha("ja-esta", "recusado")];
    await carregar("all", "recusado");
    await emitir(
      linha("ja-esta", "recusado", "processing"),
      linha("ja-esta", "recusado", "pending"),
    );
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("status específico que o pedido não casa: não relê (ele não pertence a esta visão)", async () => {
    linhas = [];
    await carregar("pending", "recusado");
    // "processing" não é "pending": mesmo com o pagamento do filtro, fica de
    // fora desta visão.
    await emitir(
      linha("andamento", "recusado", "processing"),
      linha("andamento", "aguardando", "processing"),
    );
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem filtro de pagamento, pedido de fora que muda de pagamento não relê", async () => {
    linhas = [linha("a", "aguardando")];
    await carregar("all", "all");
    await emitir(linha("b", "recusado"), linha("b", "aguardando"));
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("filtro 'pago' (caso que já existia) continua relendo quando o pedido de fora vira pago", async () => {
    linhas = [];
    await carregar("all", "pago");
    linhas = [linha("novo", "pago")];
    await emitir(linha("novo", "pago"), linha("novo", "aguardando"));
    await avancar(400);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(atuais.totalOrders).toBe(1);
  });
});

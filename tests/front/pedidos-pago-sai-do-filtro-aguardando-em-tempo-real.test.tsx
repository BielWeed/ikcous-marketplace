// @vitest-environment jsdom
// Filtro de pagamento "aguardando" ligado: um pedido que passa a "pago" em
// tempo real sumia da página (corte no front) mas o total, o "1–12 de 15" e o
// CSV ficavam como antes, e o próximo pedido não entrava na vaga. A lista
// agora é relida (mesmo debounce do caso "pago" que entra) quando um pedido
// que está nela deixa o filtro de pagamento.
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
  useAuth: () => ({ user: { id: "admin-filtro-pago" }, isAdmin: true }),
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

describe("Pedidos — com filtro de pagamento ligado, quem muda de pagamento sai da lista e o total acompanha", () => {
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

  async function carregar(status = "all", pagamento = "pago") {
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

  it("filtro 'aguardando': pedido da lista passa a 'pago' -> relê a lista uma vez e o total acompanha", async () => {
    linhas = [
      linha("sai-do-filtro", "aguardando"),
      linha("fica", "aguardando"),
    ];
    await carregar("all", "aguardando");
    expect(atuais.orders.map((p) => p.id)).toEqual(["sai-do-filtro", "fica"]);
    expect(atuais.totalOrders).toBe(2);

    // O servidor, agora, só devolve quem segue aguardando.
    linhas = [linha("fica", "aguardando")];
    await emitir(
      linha("sai-do-filtro", "pago"),
      linha("sai-do-filtro", "aguardando"),
    );
    await avancar(399);
    expect(rpc).not.toHaveBeenCalled();
    await avancar(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_admin_orders_paged",
      expect.objectContaining({
        p_status: "all",
        p_payment_status: "aguardando",
      }),
    );
    expect(atuais.orders.map((p) => p.id)).toEqual(["fica"]);
    expect(atuais.totalOrders).toBe(1);
  });

  it("vale também sem a imagem anterior da linha (evento só com a versão nova)", async () => {
    linhas = [linha("sai-do-filtro", "aguardando")];
    await carregar("all", "aguardando");
    linhas = [];
    await emitir(linha("sai-do-filtro", "pago"));
    await avancar(400);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(atuais.totalOrders).toBe(0);
  });

  it("não relê quando o pedido segue no filtro (mudou só o status do pedido)", async () => {
    linhas = [linha("fica", "aguardando")];
    await carregar("all", "aguardando");
    await emitir(
      linha("fica", "aguardando", "processing"),
      linha("fica", "aguardando", "pending"),
    );
    await emitir(linha("fica", "aguardando", "processing"));
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não relê por pedido que nem está na lista (outra página)", async () => {
    linhas = [linha("fica", "aguardando")];
    await carregar("all", "aguardando");
    await emitir(
      linha("outra-pagina", "pago"),
      linha("outra-pagina", "aguardando"),
    );
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem filtro de pagamento, mudar o pagamento não relê (a lista inteira continua valendo)", async () => {
    linhas = [linha("a", "aguardando")];
    await carregar("all", "all");
    await emitir(linha("a", "pago"), linha("a", "aguardando"));
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });
});

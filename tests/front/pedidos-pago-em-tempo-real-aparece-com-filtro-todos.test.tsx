// @vitest-environment jsdom
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

describe("Pedidos — Todos + Pago recebe o pedido pelo realtime", () => {
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

  it("relê uma única vez após o debounce e mostra o pedido que acabou de ser pago", async () => {
    await carregar();
    expect(atuais.orders).toHaveLength(0);
    linhas = [linha("pedido-pago")];
    await emitir(linhas[0], linha("pedido-pago", "aguardando"));
    await avancar(200);
    // Eco na mesma janela: reagenda o mesmo debounce, sem nova leitura.
    await emitir(linhas[0]);
    await avancar(399);
    expect(rpc).not.toHaveBeenCalled();
    expect(atuais.orders).toHaveLength(0);
    await avancar(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_admin_orders_paged", {
      p_page: 0,
      p_page_size: 12,
      p_status: "all",
      p_payment_status: "pago",
      p_search: "",
      p_start_date: "",
      p_end_date: "",
      p_canal: "all",
    });
    expect(atuais.orders.map((pedido) => pedido.id)).toEqual(["pedido-pago"]);
    expect(atuais.orders[0].paymentStatus).toBe("pago");
    expect(atuais.totalOrders).toBe(1);
    // Um eco após a leitura, sem imagem anterior, também não cria laço.
    await emitir(linhas[0]);
    await avancar(2000);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("não relê por UPDATE sem mudança de pagamento", async () => {
    linhas = [linha("ja-pago")];
    await carregar();
    await emitir(linha("aguardando", "aguardando", "processing"));
    await emitir(linha("fora-da-pagina", "pago", "processing"), {
      payment_status: "pago",
    });
    await emitir(linha("ja-pago", "pago", "processing"));
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("preserva a recarga debounced quando um pedido entra em outro filtro de status", async () => {
    await carregar("processing", "all");
    linhas = [linha("em-separacao", "aguardando", "processing")];
    await emitir(linhas[0], linha("em-separacao", "aguardando"));
    await emitir(linhas[0], linha("em-separacao", "aguardando"));
    await avancar(399);
    expect(rpc).not.toHaveBeenCalled();
    await avancar(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "get_admin_orders_paged",
      expect.objectContaining({
        p_status: "processing",
        p_payment_status: "all",
      }),
    );
    expect(atuais.orders[0].id).toBe("em-separacao");
    await avancar(2000);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

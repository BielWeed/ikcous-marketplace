// @vitest-environment jsdom
// Filtro de STATUS específico ligado ("Em Separação"): um pedido que está em
// OUTRA página (fora da lista carregada) avança para "Em Trânsito" e sai do
// recorte. Nenhuma recarga era agendada: o total anunciado ficava 1 acima e o
// "Próximo" levava a uma página vazia/errada até a lojista recarregar.
//
// O `old` do UPDATE chega só com a chave primária (RLS ligada), então o
// "antes" quase nunca diz o status: sem ele, UPDATE de pedido que não está na
// lista e não casa o filtro agenda a MESMA recarga debounced do INSERT. Com
// ele, só relê quem de fato saiu do recorte.
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
  useAuth: () => ({ user: { id: "admin-saiu-do-recorte" }, isAdmin: true }),
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

function linha(id: string, status = "processing", payment_status = "pago") {
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
let totalNoServidor: number;
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

async function emitir(nova: ReturnType<typeof linha>, anterior: unknown) {
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

describe("Pedidos — pedido de outra página que sai do filtro de status acerta o total", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    evento = undefined;
    linhas = [];
    totalNoServidor = 0;
    rpc.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome !== "get_admin_orders_paged") {
        throw new Error(`RPC inesperada: ${nome}`);
      }
      return {
        abortSignal: () =>
          Promise.resolve({
            data: { data: linhas, total_count: totalNoServidor },
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

  async function carregar(
    status: string,
    opcoes: { busca?: string; pagamento?: string } = {},
  ) {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(
        0,
        12,
        status,
        opcoes.busca ?? "",
        undefined,
        undefined,
        false,
        opcoes.pagamento ?? "all",
      );
    });
    rpc.mockClear();
  }

  it("old só com o id (o que a RLS entrega): relê uma vez e o total desce", async () => {
    linhas = [linha("fica")];
    totalNoServidor = 15;
    await carregar("processing");
    expect(atuais.totalOrders).toBe(15);

    // O servidor, agora, já não conta quem avançou.
    totalNoServidor = 14;
    await emitir(linha("outra-pagina", "shipping"), { id: "outra-pagina" });
    await avancar(399);
    expect(rpc).not.toHaveBeenCalled();
    await avancar(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_admin_orders_paged",
      expect.objectContaining({ p_status: "processing" }),
    );
    expect(atuais.totalOrders).toBe(14);
  });

  it("rajada de pedidos de outras páginas saindo do recorte: UMA recarga só", async () => {
    linhas = [linha("fica")];
    totalNoServidor = 15;
    await carregar("processing");
    for (const id of ["a", "b", "c", "d", "e"]) {
      await emitir(linha(id, "shipping"), { id });
      await avancar(100);
    }
    await avancar(400);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("old com o status anterior que casa o filtro: relê (saiu do recorte)", async () => {
    linhas = [linha("fica")];
    totalNoServidor = 15;
    await carregar("processing");
    await emitir(
      linha("outra-pagina", "shipping"),
      linha("outra-pagina", "processing"),
    );
    await avancar(400);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("borda: old com status que já NÃO casava o filtro: nunca esteve no recorte, não relê", async () => {
    linhas = [linha("fica")];
    totalNoServidor = 15;
    await carregar("processing");
    await emitir(
      linha("outra-pagina", "delivered"),
      linha("outra-pagina", "shipping"),
    );
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("borda: filtro 'Todos' nunca relê por pedido de outra página", async () => {
    linhas = [linha("fica")];
    totalNoServidor = 15;
    await carregar("all");
    await emitir(linha("outra-pagina", "shipping"), { id: "outra-pagina" });
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("borda: com busca ligada e sem o status anterior, não relê (não dá para saber)", async () => {
    linhas = [linha("fica")];
    totalNoServidor = 1;
    await carregar("processing", { busca: "maria" });
    await emitir(linha("outra-pagina", "shipping"), { id: "outra-pagina" });
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("borda: com filtro de pagamento ligado e sem o status anterior, não relê", async () => {
    linhas = [linha("fica")];
    totalNoServidor = 1;
    await carregar("processing", { pagamento: "pago" });
    await emitir(linha("outra-pagina", "shipping"), { id: "outra-pagina" });
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("filtro 'Em aberto': pedido de outra página que sai (entregue) relê", async () => {
    linhas = [linha("fica", "pending")];
    totalNoServidor = 15;
    await carregar("open");
    await emitir(linha("outra-pagina", "delivered"), { id: "outra-pagina" });
    await avancar(400);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("filtro 'Em aberto' com o status anterior: de 'Novo' para 'Finalizado' relê; de 'Finalizado' para 'Finalizado' (mudou outro campo) não", async () => {
    linhas = [linha("fica", "pending")];
    totalNoServidor = 15;
    await carregar("open");
    await emitir(
      linha("outra-pagina", "delivered"),
      linha("outra-pagina", "pending"),
    );
    await avancar(400);
    expect(rpc).toHaveBeenCalledTimes(1);

    rpc.mockClear();
    // Já estava fora do "Em aberto" (finalizado): nada mudou para o recorte.
    await emitir(
      linha("outra-pagina-2", "delivered"),
      linha("outra-pagina-2", "delivered"),
    );
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
//
// useOrders-2867: depois de sincronizar a fila offline, a recarga do painel
// trocava silenciosamente a lista por uma consulta FIXA —
// `loadOrders(0, 10, "all", "", "", "", true)` — por cima do filtro, página
// e itemsPerPage=12 que a lojista estava vendo (AdminOrdersView.tsx). Este
// arquivo prova o HOOK de verdade (não um dublê da decisão isolada): mesmo
// padrão de useorders-admin-rele-status-antes-de-avancar.test.tsx — este
// projeto não tem @testing-library/react, então o hook se alcança por uma
// sonda que expõe `loadOrders` por efeito.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

// useOrders-196: a fila offline agora relê o status do pedido
// (`from("marketplace_orders").select("status").eq("id", …).single()`)
// antes de aplicar cada avanço — este dublê de `from` precisa devolver algo
// nesse formato, senão a releitura falha e o item nem chega a virar RPC,
// o que não é o que ESTE teste (useOrders-2867, filtro/página da recarga)
// está medindo. "pending" só precisa não ser cancelled/delivered.
function builderDaReleitura() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(() =>
    Promise.resolve({ data: { status: "pending" }, error: null }),
  );
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc,
    from: vi.fn(() => builderDaReleitura()),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const chave = "orders_offline_updates_queue";
const itemDaFila = {
  orderId: "pedido-A",
  status: "processing",
  silent: false,
};

/** Toda chamada de `get_admin_orders_paged` feita durante o teste, na ORDEM
 * em que aconteceram — é isso que prova qual consulta a recarga pós-sync
 * repetiu. */
let chamadasGetAdminOrdersPaged: any[] = [];

function instalarRpc() {
  chamadasGetAdminOrdersPaged = [];
  rpc.mockImplementation((nome: string, args: any) => {
    if (nome === "get_admin_orders_paged") {
      chamadasGetAdminOrdersPaged.push(args);
      return {
        abortSignal: () =>
          Promise.resolve({
            data: { data: [], total_count: 0 },
            error: null,
          }),
      };
    }
    if (nome === "update_order_status_atomic") {
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;

async function montarSondaAdmin(): Promise<{
  carregar: (
    page?: number,
    pageSize?: number,
    statusFilter?: string,
    searchQuery?: string,
    startDate?: string,
    endDate?: string,
  ) => Promise<unknown>;
}> {
  const { useOrders } = await import("@/hooks/useOrders");
  let carregar: (...args: any[]) => Promise<unknown> = async () => ({});

  function Sonda() {
    const { loadOrders } = useOrders(true, true);
    useEffect(() => {
      carregar = loadOrders;
    });
    return null;
  }

  await act(async () => {
    raiz.render(<Sonda />);
  });

  return { carregar };
}

describe("useOrders-2867 — sincronizar a fila offline preserva filtros e página do painel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    instalarRpc();
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => armazem.set(k, v),
      removeItem: (k: string) => armazem.delete(k),
      clear: () => armazem.clear(),
    });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    vi.mocked(toast.loading).mockReturnValue("toast-id");
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("repete a MESMA página/filtro/busca/período da última consulta do admin, em vez de 'Todos'/página 0/10 por página", async () => {
    const { carregar } = await montarSondaAdmin();

    // A lojista estava filtrando "Em Aberto" (page=2, pageSize=12, busca
    // "maria", período 2026-08-01..2026-08-18) — igual ao cenário do achado:
    // chips "Em Aberto", página salva e itemsPerPage=12 do AdminOrdersView.
    await act(async () => {
      await carregar(2, 12, "open", "maria", "2026-08-01", "2026-08-18");
    });
    chamadasGetAdminOrdersPaged = [];

    // Pedido avançou offline (foi para a fila); rede volta.
    armazem.set(chave, JSON.stringify([itemDaFila]));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(rpc).toHaveBeenCalledWith(
      "update_order_status_atomic",
      expect.objectContaining({ p_order_id: "pedido-A" }),
    );

    // O DEFEITO: a recarga pós-sync chamava get_admin_orders_paged com
    // p_page=0/p_page_size=10/p_status="all" — sobrescrevendo filtro e
    // página. A CORREÇÃO: repetir a última consulta.
    expect(chamadasGetAdminOrdersPaged).toHaveLength(1);
    expect(chamadasGetAdminOrdersPaged[0]).toMatchObject({
      p_page: 2,
      p_page_size: 12,
      p_status: "open",
      p_search: "maria",
      p_start_date: "2026-08-01",
      p_end_date: "2026-08-18",
    });
  });
});

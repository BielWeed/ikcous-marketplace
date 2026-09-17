// @vitest-environment jsdom
//
// pedidos-23/useOrders-cancelados-janela-e-colunas, item 5: o ramo
// "recarregar" do INSERT do painel admin (`handleRealtimeInsert`, dentro de
// useOrders.ts — pedido casa com o filtro mas a lojista não está na página
// 0, ou o filtro de pagamento está ativo) chamava `recarregarAposReconexaoRef`
// na hora, uma vez POR EVENTO. Uma rajada de pedidos PIX quase simultâneos —
// o cenário real que motivou este achado — virava uma rajada equivalente de
// `get_admin_orders_paged`. Este teste prova que N eventos dentro de uma
// janela curta agora pagam UMA recarga só, disparada só depois que a rajada
// termina (debounce trailing).
//
// Mock no mesmo molde de use-orders-cancelados-nao-baixa-o-banco-inteiro.test.tsx:
// sem @testing-library/react neste projeto, o hook se alcança por um
// componente que expõe a função via efeito, e o handler REAL do canal
// (`channel.on("postgres_changes", ...)`) é capturado para simular os
// INSERTs.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const fromMock = vi.fn();

let mockRealtimeOnHandler: ((payload: unknown) => unknown) | null = null;

function linhaPedidoFake(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "pending",
    customer_name: "Cliente Teste",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc,
    from: (...args: unknown[]) => fromMock(...args),
    channel: () => ({
      on: (
        _evento: string,
        _filtro: unknown,
        handler: (payload: unknown) => unknown,
      ) => {
        mockRealtimeOnHandler = handler;
        return { subscribe: () => ({}) };
      },
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" }, isAdmin: true }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;

function stubLocalStorage() {
  armazem = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
  });
}

type CarregaPagina = (
  page?: number,
  pageSize?: number,
  statusFilter?: string,
) => Promise<unknown>;

async function montarSondaAdmin(): Promise<{
  chamarLoadOrders: CarregaPagina;
}> {
  const { useOrders } = await import("@/hooks/useOrders");

  let carregar: CarregaPagina = async () => ({ orders: [], total: 0 });

  function Sonda() {
    // useOrders com enabled=true, isAdmin=true — o mesmo par que
    // AdminOrdersView.tsx usa.
    const { loadOrders } = useOrders(true, true);
    useEffect(() => {
      carregar = loadOrders;
    });
    return null;
  }

  await act(async () => {
    raiz.render(<Sonda />);
  });

  return {
    chamarLoadOrders: (page, pageSize, statusFilter) =>
      carregar(page, pageSize, statusFilter),
  };
}

describe("INSERT do painel admin com decisão 'recarregar' — debounce trailing (item 5, useOrders-cancelados-janela-e-colunas)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubLocalStorage();
    rpc.mockReset();
    fromMock.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uma rajada de 5 INSERTs que casam com o filtro, todos fora da página 0, paga UMA recarga só", async () => {
    let chamadasLoadOrders = 0;
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_admin_orders_paged") {
        chamadasLoadOrders += 1;
        return {
          abortSignal: () =>
            Promise.resolve({
              data: { data: [], total_count: 0 },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });
    // Cada INSERT dispara um SELECT pontual (`from("marketplace_orders")...
    // .single()`) para buscar o pedido completo antes de decidir — resolve
    // um pedido "pending" comum, que casa com o filtro "all" da consulta
    // guardada abaixo mas cai fora da página 0 (decisão "recarregar").
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: linhaPedidoFake("novo"), error: null }),
        }),
      }),
    }));

    const { chamarLoadOrders } = await montarSondaAdmin();
    expect(mockRealtimeOnHandler).toBeTruthy();

    // A lojista está na página 3, filtro "all" — todo pedido novo casa com
    // o filtro, mas nenhum é inserido direto na lista (decisão
    // "recarregar" em decidirRealtimeInsertAdmin, que olha `ultimaConsultaAdminRef`
    // preenchida por esta chamada).
    await act(async () => {
      await chamarLoadOrders(3, 12, "all");
    });
    // Zera a contagem depois da carga inicial de página — o teste mede só
    // o que a rajada de INSERT provoca.
    chamadasLoadOrders = 0;

    // Rajada de 5 INSERTs quase simultâneos (rajada de PIX) — nenhum
    // `await` entre eles, como pedidos que chegam em sequência apertada
    // pelo canal de realtime.
    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        mockRealtimeOnHandler!({
          eventType: "INSERT",
          new: { id: `novo-${i}` },
        });
      }
      // Deixa os 5 SELECTs pontuais (assíncronos) assentarem.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // O DEFEITO: sem debounce, cada um dos 5 eventos chamaria
    // `recarregarAposReconexaoRef` na hora — 5 chamadas de
    // `get_admin_orders_paged` para uma única rajada que mudou o total UMA
    // vez de verdade.
    expect(chamadasLoadOrders).toBe(0);

    // Passado o debounce (400ms, dentro da faixa 300–500ms pedida), a
    // recarga finalmente dispara — UMA vez só.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(chamadasLoadOrders).toBe(1);
  });
});

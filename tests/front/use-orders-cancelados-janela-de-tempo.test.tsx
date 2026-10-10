// @vitest-environment jsdom
//
// A VARREDURA DE CANCELADOS GANHA JANELA POR DATA DE CANCELAMENTO — frente
// pedidos-4 (tarefa useOrders-cancelados-janela-e-colunas, achado central de
// useOrders-1417 que sobrou da rodada b8800f8).
//
// O que esta suíte trava:
//   1. O CONTRATO NOVO da RPC: fetchPedidosCancelados fala com
//      get_admin_orders_cancelados_recentes (migration 20261164000000), com
//      janela de 90 dias POR PADRÃO e paginação fixa — este é o substituto
//      natural do antigo "seis argumentos" de
//      cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx, que
//      travava get_admin_orders_paged com p_status='cancelled' e SEM janela.
//   2. A HONESTIDADE do recorte: fora_da_janela (os cancelados anteriores à
//      janela, contados pelo servidor) vira estado exposto do hook — sem
//      isso, um estorno pendente de 6 meses atrás sumiria do painel em
//      silêncio (a lista de cancelados é lista de PENDÊNCIAS; o BLOQUEIA da
//      revisão de 17/09 foi exatamente sobre pendência invisível).
//   3. A ESCAPE HATCH: buscarTambemCanceladosAntigos refaz a varredura SEM
//      janela (p_dias: null explicitamente — omitir o argumento recairia no
//      default 90 do banco) e zera o contador.
//
// POR QUE A SONDA: mesmo padrão de
// cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx — este
// projeto não tem @testing-library/react; o hook se alcança por um
// componente que expõe o que interessa via efeito.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: [], error: null }),
          single: () =>
            Promise.resolve({ data: { status: "shipping" }, error: null }),
        }),
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const usuario = { id: "cliente-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Linha ENXUTA como a 20261164000000 devolve: SEM as chaves `items` e
// `address` — o mapper tem de tolerar a ausência (items vira []).
function linhaCanceladaEnxuta(id: string) {
  return {
    id,
    status: "cancelled",
    customer_name: "Cliente Enxuto",
    customer_data: { whatsapp: "34999999999" },
    total: 120,
    subtotal: 120,
    shipping: 0,
    discount: 0,
    payment_method: "pix",
    payment_status: "pago",
    cancelled_after_shipping: false,
    returned_to_seller_at: null,
    canal: "online",
    vendedor_id: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    cancelado_em: new Date(0).toISOString(),
  };
}

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;

async function montarSondaAdmin(): Promise<{
  chamarFetchPedidosCancelados: () => Promise<Order[]>;
  chamarBuscarTambemAntigos: () => Promise<Order[]>;
  pegarPedidosCancelados: () => Order[];
  pegarForaDaJanela: () => number;
}> {
  const { useOrders } = await import("@/hooks/useOrders");

  let fetchCancelados: () => Promise<Order[]> = async () => [];
  let buscarAntigos: () => Promise<Order[]> = async () => [];
  let cancelados: Order[] = [];
  let foraDaJanela = 0;

  function SondaAdmin() {
    const {
      fetchPedidosCancelados,
      buscarTambemCanceladosAntigos,
      pedidosCancelados,
      canceladosForaDaJanela,
    } = useOrders(true, true);
    useEffect(() => {
      fetchCancelados = fetchPedidosCancelados;
      buscarAntigos = buscarTambemCanceladosAntigos;
      cancelados = pedidosCancelados;
      foraDaJanela = canceladosForaDaJanela;
    });
    return null;
  }

  await act(async () => {
    raiz.render(<SondaAdmin />);
  });

  return {
    chamarFetchPedidosCancelados: () => fetchCancelados(),
    chamarBuscarTambemAntigos: () => buscarAntigos(),
    pegarPedidosCancelados: () => cancelados,
    pegarForaDaJanela: () => foraDaJanela,
  };
}

describe("fetchPedidosCancelados fala com a RPC enxuta de cancelados (20261164000000)", () => {
  beforeEach(() => {
    rpc.mockReset();
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
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("a primeira página pede a janela de 90 dias e a paginação fixa — o substituto do 'seis argumentos'", async () => {
    const chamadas: any[] = [];
    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "get_admin_orders_cancelados_recentes") {
        chamadas.push(args);
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: [linhaCanceladaEnxuta("p1")],
                total_count: 1,
                fora_da_janela: 0,
              },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });

    const { chamarFetchPedidosCancelados, pegarPedidosCancelados } =
      await montarSondaAdmin();
    await act(async () => {
      await chamarFetchPedidosCancelados();
    });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toEqual({
      p_dias: 90,
      p_page: 0,
      p_page_size: 200,
    });
    // A linha enxuta atravessa o mapper inteiro: itens ausentes viram [] e
    // o total continua chegando — o painel de cancelados não perde nada
    // que ele de fato leia.
    const pedido = pegarPedidosCancelados()[0];
    expect(pedido.id).toBe("p1");
    expect(pedido.items).toEqual([]);
    expect(pedido.total).toBe(120);
    expect(pedido.customer?.name).toBe("Cliente Enxuto");
  });

  it("fora_da_janela do servidor vira estado do hook — pendência antiga não some em silêncio", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_admin_orders_cancelados_recentes") {
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: [linhaCanceladaEnxuta("p1")],
                total_count: 1,
                fora_da_janela: 7,
              },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });

    const { chamarFetchPedidosCancelados, pegarForaDaJanela } =
      await montarSondaAdmin();
    await act(async () => {
      await chamarFetchPedidosCancelados();
    });

    expect(pegarForaDaJanela()).toBe(7);
  });

  it("buscarTambemCanceladosAntigos refaz SEM janela (p_dias null explícito) e zera o contador", async () => {
    const chamadas: any[] = [];
    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "get_admin_orders_cancelados_recentes") {
        chamadas.push(args);
        const semJanela = args.p_dias === null;
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: semJanela
                  ? [
                      linhaCanceladaEnxuta("recente"),
                      linhaCanceladaEnxuta("antigo"),
                    ]
                  : [linhaCanceladaEnxuta("recente")],
                total_count: semJanela ? 2 : 1,
                fora_da_janela: semJanela ? 0 : 1,
              },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });

    const {
      chamarFetchPedidosCancelados,
      chamarBuscarTambemAntigos,
      pegarForaDaJanela,
      pegarPedidosCancelados,
    } = await montarSondaAdmin();

    await act(async () => {
      await chamarFetchPedidosCancelados();
    });
    expect(pegarForaDaJanela()).toBe(1);

    await act(async () => {
      await chamarBuscarTambemAntigos();
    });

    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]).toEqual({
      p_dias: null,
      p_page: 0,
      p_page_size: 200,
    });
    expect(pegarForaDaJanela()).toBe(0);
    expect(pegarPedidosCancelados()).toHaveLength(2);
  });

  it("a segunda página existe no contrato novo como no velho — total_count maior que uma página acumula", async () => {
    const chamadas: any[] = [];
    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "get_admin_orders_cancelados_recentes") {
        chamadas.push(args);
        const linhas =
          args.p_page === 0
            ? Array.from({ length: 200 }, (_, i) =>
                linhaCanceladaEnxuta(`pg0-${i}`),
              )
            : Array.from({ length: 50 }, (_, i) =>
                linhaCanceladaEnxuta(`pg1-${i}`),
              );
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: linhas,
                total_count: 250,
                fora_da_janela: 0,
              },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });

    const { chamarFetchPedidosCancelados, pegarPedidosCancelados } =
      await montarSondaAdmin();
    await act(async () => {
      await chamarFetchPedidosCancelados();
    });

    expect(chamadas.map((a) => a.p_page)).toEqual([0, 1]);
    expect(pegarPedidosCancelados()).toHaveLength(250);
  });
});

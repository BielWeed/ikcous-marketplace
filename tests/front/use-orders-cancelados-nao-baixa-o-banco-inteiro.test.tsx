// @vitest-environment jsdom
//
// useOrders-1417 (revisão de 15/09/2026, frente "pedidos"): `fetchPedidosCancelados`
// (useOrders.ts) pagina TODOS os pedidos cancelados da loja pela mesma RPC
// pesada da lista principal (`get_admin_orders_paged`, com jsonb_agg de
// itens e endereço por pedido) — e refaz essa varredura INTEIRA a cada
// ativação da aba de Pedidos (`AdminOrdersView.tsx`, efeito `[active,
// fetchPedidosCancelados]`) e a cada cancelamento (a chamada direta de
// `updateOrderStatus` MAIS o eco do próprio realtime chegando pelo canal
// quase no mesmo instante — as duas disparam `fetchPedidosCancelados()`).
// Numa loja onde a maioria dos pedidos já está cancelada (87% medido em
// 15/09), isso é 8 chamadas RPC sequenciais toda vez que nada mudou.
//
// A CORREÇÃO NÃO PODE mudar o que a RPC recebe: o teste
// "os seis argumentos da primeira página são exatamente os fixos" em
// cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx trava
// p_search/p_status/p_start_date/p_end_date/p_page_size com igualdade
// exata, e não é deste arquivo que eu deveria mexer nele. O que dá para
// cortar, dentro de useOrders.ts, é a REPETIÇÃO: uma busca concluída há
// pouco tempo é servida do último resultado (sem RPC nenhuma) e uma busca
// já em voo é reaproveitada por quem chega enquanto ela ainda não voltou
// — em vez do comportamento antigo (abortar a que estava em voo e começar
// outra do zero), que ainda disparava DUAS levas de chamadas de rede.
//
// RODADA DE CORREÇÃO (15/09/2026, achados BLOQUEIA 1 e 2 da revisão de
// contexto limpo): a primeira versão da janela anti-redundância suprimia
// por RELÓGIO uma chamada que tinha sido disparada por um EVENTO real
// (outro cancelamento, ou uma escrita que o hook nem enxerga —
// `registrar_estorno_manual`, chamada direto da tela) e nunca agendava
// releitura nenhuma depois — a defasagem virava ILIMITADA, não de 5s. E
// reaproveitar uma busca já em voo por igual, sem checar SE ela nasceu
// antes ou depois do gatilho de quem chega, fazia o par
// cancelamento+eco continuar correto mas qualquer OUTRO evento durante o
// voo (cliente cancela, outra sessão admin cancela) sumir sem re-executar
// nada depois. Os dois testes novos abaixo (`describe`s "achado 1" e
// "achado 2") provam que isso está fechado; os dois de cima continuam
// provando que a REPETIÇÃO sem necessidade continua cortada.
//
// Mock no mesmo molde de cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx
// (`montarSondaAdmin`): sem @testing-library/react neste projeto, o hook se
// alcança por um componente que expõe a função via efeito. Os testes de
// achado 1/2 também precisam de `updateOrderStatus` e do handler REAL que
// `channel.on("postgres_changes", ...)` registra — mesmo padrão de captura
// do handler usado naquele arquivo (achado A da revisão de 26/08/2026).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, OrderStatus } from "@/types";

const rpc = vi.fn();

let mockRealtimeOnHandler: ((payload: unknown) => unknown) | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: [], error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
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

// `false` por padrão (mesmo padrão de cancelar-enviado-otimista-...test.tsx):
// só o describe do achado 2, abaixo, precisa do canal de realtime ligado
// para simular o cancelamento remoto/eco — e só ELE liga `isLeader`. Os
// outros describes deste arquivo mudariam de comportamento à toa se o
// canal fosse criado (`channel.on`) numa montagem que não olha para isto.
let mockIsLeader = false;
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: mockIsLeader }),
}));

vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linhaCanceladaFake(id: string) {
  return {
    id,
    status: "cancelled",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;

type BuscaCancelados = () => Promise<Order[]>;
type AtualizaStatusAdmin = (
  id: string,
  status: OrderStatus,
  notes?: string,
  silent?: boolean,
  statusEsperado?: OrderStatus,
) => Promise<void>;

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

async function montarSondaAdmin(): Promise<{
  chamarFetchPedidosCancelados: BuscaCancelados;
  chamarUpdateOrderStatus: AtualizaStatusAdmin;
  pegarPedidosCancelados: () => Order[];
}> {
  const { useOrders } = await import("@/hooks/useOrders");

  let buscar: BuscaCancelados = async () => [];
  let update: AtualizaStatusAdmin = async () => {};
  let cancelados: Order[] = [];

  function Sonda() {
    const { fetchPedidosCancelados, updateOrderStatus, pedidosCancelados } =
      useOrders(true, true);
    useEffect(() => {
      buscar = fetchPedidosCancelados;
      update = updateOrderStatus;
      cancelados = pedidosCancelados;
    });
    return null;
  }

  await act(async () => {
    raiz.render(<Sonda />);
  });

  return {
    chamarFetchPedidosCancelados: () => buscar(),
    chamarUpdateOrderStatus: (id, status, notes, silent, statusEsperado) =>
      update(id, status, notes, silent, statusEsperado),
    pegarPedidosCancelados: () => cancelados,
  };
}

describe("fetchPedidosCancelados não repete a varredura inteira sem necessidade (useOrders-1417)", () => {
  let chamadasGetAdminOrdersPaged: any[];

  beforeEach(() => {
    rpc.mockReset();
    chamadasGetAdminOrdersPaged = [];
    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "get_admin_orders_paged") {
        chamadasGetAdminOrdersPaged.push(args);
        return {
          abortSignal: () =>
            Promise.resolve({
              data: { data: [linhaCanceladaFake("p1")], total_count: 1 },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
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
  });

  it("duas ativações seguidas da aba (duas chamadas em sequência, uma logo depois da outra terminar) fazem UMA RPC só", async () => {
    const { chamarFetchPedidosCancelados } = await montarSondaAdmin();

    let primeiroResultado: unknown[] = [];
    let segundoResultado: unknown[] = [];
    await act(async () => {
      primeiroResultado = await chamarFetchPedidosCancelados();
    });
    await act(async () => {
      segundoResultado = await chamarFetchPedidosCancelados();
    });

    // O DEFEITO: sem a janela anti-redundância, esta segunda chamada
    // dispara `get_admin_orders_paged` de novo — mesmo sem nada ter
    // mudado desde a primeira, um instante atrás (a mesma reativação de
    // aba que o `useEffect([active, fetchPedidosCancelados])` de
    // AdminOrdersView.tsx dispara a cada troca de aba).
    expect(chamadasGetAdminOrdersPaged).toHaveLength(1);
    // E o resultado da segunda chamada continua sendo o mesmo (servido do
    // cache, não uma lista vazia por engano).
    expect(segundoResultado).toEqual(primeiroResultado);
    expect(segundoResultado).toHaveLength(1);
  });

  it("duas chamadas disparadas ao mesmo tempo (cancelamento local + eco quase simultâneo do próprio realtime) fazem UMA RPC só", async () => {
    const { chamarFetchPedidosCancelados } = await montarSondaAdmin();

    let resultados: unknown[][] = [];
    await act(async () => {
      // Sem `await` entre as duas — é exatamente o cenário do achado C: a
      // chamada direta de `updateOrderStatus` ao cancelar e o eco do
      // próprio realtime chegam quase no mesmo instante, nenhuma esperou a
      // outra terminar.
      resultados = await Promise.all([
        chamarFetchPedidosCancelados(),
        chamarFetchPedidosCancelados(),
      ]);
    });

    // O DEFEITO: o código antigo ABORTAVA a busca em voo e começava outra
    // do zero — a chamada de rede da primeira já tinha sido disparada, e a
    // segunda leva de páginas também. Reaproveitar a mesma promessa em voo
    // corta isso para UMA chamada real.
    expect(chamadasGetAdminOrdersPaged).toHaveLength(1);
    expect(resultados[0]).toEqual(resultados[1]);
    expect(resultados[0]).toHaveLength(1);
  });
});

describe("achado 1 (BLOQUEIA, rodada de correção 15/09/2026): a janela anti-redundância não pode travar o painel num retrato anterior ao evento", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rpc.mockReset();
    stubLocalStorage();
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

  it("uma escrita que o hook não enxerga (ex.: registrar_estorno_manual, chamada direto da tela) some da lista sozinha quando a janela acaba — a defasagem é de no máximo 5s, não ilimitada", async () => {
    // A "verdade" do banco muda por fora do hook (nenhuma chamada de
    // updateOrderStatus, nenhum evento de realtime — é exatamente
    // registrarEstornoFeito em AdminOrdersView.tsx:753, que chama a RPC
    // `registrar_estorno_manual` e só depois `fetchPedidosCancelados()`
    // sem argumento nenhum).
    let pedidoBAindaNaLista = true;
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_admin_orders_paged") {
        const linhas = pedidoBAindaNaLista
          ? [linhaCanceladaFake("pedido-A"), linhaCanceladaFake("pedido-B")]
          : [linhaCanceladaFake("pedido-A")];
        return {
          abortSignal: () =>
            Promise.resolve({
              data: { data: linhas, total_count: linhas.length },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });

    const { chamarFetchPedidosCancelados, pegarPedidosCancelados } =
      await montarSondaAdmin();

    // Primeira leitura: A e B, os dois em "devolver agora".
    await act(async () => {
      await chamarFetchPedidosCancelados();
    });
    expect(pegarPedidosCancelados().map((o) => o.id)).toEqual([
      "pedido-A",
      "pedido-B",
    ]);

    // ~3s depois (dentro da janela de 5s) a lojista clica "Registrar
    // estorno feito" em B: a RPC (fora do alcance do hook) já tirou B do
    // banco, e o clique chama fetchPedidosCancelados() de novo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    pedidoBAindaNaLista = false;
    await act(async () => {
      await chamarFetchPedidosCancelados();
    });

    // O DEFEITO (achado 1): sem uma releitura de arrasto agendada para o
    // fim da janela, o painel fica com B na tela ATÉ QUE outro gatilho
    // independente aconteça — ilimitado, não 5s. Avançando só o RESTANTE
    // da janela (pouco mais de 2s) o painel já tem que ter se corrigido
    // sozinho.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(pegarPedidosCancelados().map((o) => o.id)).toEqual(["pedido-A"]);
  });
});

describe("achado 2 (BLOQUEIA, rodada de correção 15/09/2026): uma busca já em voo não pode responder por um evento que só aconteceu DEPOIS dela ter começado", () => {
  beforeEach(() => {
    // Só este describe liga `isLeader` (mesmo padrão do describe "realtime
    // UPDATE (admin)" de cancelar-enviado-otimista-...test.tsx): é o que
    // faz `useOrders` de fato assinar `channel.on("postgres_changes", ...)`
    // em vez de só ouvir o BroadcastChannel de uma aba secundária. NÃO
    // zera `mockRealtimeOnHandler` a cada teste — o canal compartilhado
    // (`globalOrderSubscriptions`, módulo de useOrders.ts) só chama
    // `channel.on` na PRIMEIRA montagem admin deste arquivo; a segunda
    // reaproveita a mesma inscrição (refCount++), então zerar aqui deixaria
    // o segundo teste do describe sem handler nenhum para chamar.
    mockIsLeader = true;
    rpc.mockReset();
    stubLocalStorage();
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
    mockIsLeader = false;
  });

  it("um cancelamento (via realtime, de outra sessão) que chega enquanto uma varredura de reativação de aba está em voo dispara uma varredura de arrasto — o card não fica esquecido até a próxima ativação", async () => {
    let resolverPrimeiraChamada: (v: unknown) => void = () => {};
    const primeiraChamada = new Promise((resolve) => {
      resolverPrimeiraChamada = resolve;
    });
    let numeroDaChamada = 0;
    const chamadasGetAdminOrdersPaged: any[] = [];

    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "get_admin_orders_paged") {
        numeroDaChamada += 1;
        chamadasGetAdminOrdersPaged.push(args);
        if (numeroDaChamada === 1) {
          // A varredura de reativação de aba: fica pendente de propósito
          // — é o "em voo" do teste.
          return { abortSignal: () => primeiraChamada };
        }
        // Qualquer varredura seguinte já reflete o cancelamento de
        // pedido-B, que "aconteceu" enquanto a primeira estava em voo.
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: [linhaCanceladaFake("pedido-B")],
                total_count: 1,
              },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });

    const { chamarFetchPedidosCancelados, pegarPedidosCancelados } =
      await montarSondaAdmin();
    expect(mockRealtimeOnHandler).toBeTruthy();

    // Ativação da aba: dispara a varredura, que fica pendente (voo 1).
    let resultadoDaAtivacao: Promise<Order[]> = Promise.resolve([]);
    act(() => {
      resultadoDaAtivacao = chamarFetchPedidosCancelados();
    });

    // ENQUANTO o voo 1 ainda não voltou, pedido-B é cancelado por outra
    // sessão admin — chega só pelo canal de realtime, nunca por
    // updateOrderStatus deste hook.
    await act(async () => {
      await mockRealtimeOnHandler!({
        eventType: "UPDATE",
        new: { id: "pedido-B", status: "cancelled" },
        old: { id: "pedido-B" },
      });
    });

    // O voo 1 finalmente assenta, com um retrato de ANTES do cancelamento
    // de B (nenhum pedido).
    resolverPrimeiraChamada({
      data: { data: [], total_count: 0 },
      error: null,
    });
    await act(async () => {
      await resultadoDaAtivacao;
      // Dá tempo para a varredura de arrasto (encadeada sobre o voo 1)
      // rodar e assentar também.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // O DEFEITO (achado 2): reaproveitar cegamente a promessa em voo
    // devolveria o retrato do voo 1 (sem pedido-B) e nunca re-executaria
    // nada — pedido-B só apareceria na PRÓXIMA ativação de aba. A
    // correção paga exatamente UMA varredura extra (não uma fila) e o
    // painel acaba refletindo o cancelamento de B sozinho.
    expect(chamadasGetAdminOrdersPaged.length).toBeGreaterThanOrEqual(2);
    expect(pegarPedidosCancelados().map((o) => o.id)).toEqual(["pedido-B"]);
  });

  it("o par cancelamento local + eco do próprio realtime (mesmo pedido) continua custando UMA varredura só, mesmo com a marca de sujeira do achado 2", async () => {
    const chamadasGetAdminOrdersPaged: any[] = [];
    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "update_order_status_atomic") {
        return Promise.resolve({ error: null });
      }
      if (nome === "get_admin_orders_paged") {
        chamadasGetAdminOrdersPaged.push(args);
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: [linhaCanceladaFake("pedido-A")],
                total_count: 1,
              },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });

    const { chamarUpdateOrderStatus } = await montarSondaAdmin();
    expect(mockRealtimeOnHandler).toBeTruthy();

    await act(async () => {
      // A chamada direta de updateOrderStatus TERMINA primeiro (é ela que
      // faz a escrita — o RPC de cancelamento é sempre um round-trip de
      // rede real, que só resolve DEPOIS do commit; o eco do realtime
      // depende desse MESMO commit para existir, então não há como chegar
      // antes dele em produção) — o eco chega "logo em seguida", como o
      // docstring do achado descreve, não ANTES da própria escrita local
      // ter marcado o pedido.
      await chamarUpdateOrderStatus("pedido-A", "cancelled");
      await mockRealtimeOnHandler!({
        eventType: "UPDATE",
        new: { id: "pedido-A", status: "cancelled" },
        old: { id: "pedido-A" },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(chamadasGetAdminOrdersPaged).toHaveLength(1);
  });
});

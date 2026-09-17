// @vitest-environment jsdom
//
// pedidos-23/useOrders-cancelados-janela-e-colunas — duas ressalvas ainda
// abertas da revisão de `fetchPedidosCancelados` (useOrders.ts,
// useOrders-1417/1508):
//
// (a) `pedidosCanceladosLocalmenteRef` NUNCA EXPIRA. Ela existe para
// `handleRealtimeUpdate` reconhecer o ECO do próprio `updateOrderStatus`
// (cancelamento local) e não contar o par local+eco como DOIS gatilhos —
// mas se o eco de verdade nunca chegar (canal caiu, mensagem perdida), a
// entrada fica no `Set` para sempre. O PRÓXIMO evento de status "cancelled"
// para o MESMO pedido — que pode ser um cancelamento genuinamente NOVO
// (reaberto e cancelado de novo por outra sessão) — é then consumido como
// se fosse aquele eco velho: `gatilhoCanceladosSeqRef` não avança, e um
// cancelamento de verdade pode ficar preso atrás da janela anti-redundância
// como se nada tivesse mudado. Uma expiração de 30s fecha isso: passado
// esse prazo, o próximo evento sobre aquele id volta a contar como gatilho
// normal.
//
// (b) O CLEANUP DE DESMONTE não cancela o ENCADEAMENTO do "voo sujo": a
// peça 2 de `fetchPedidosCancelados` (`dispararOuEncadearBuscaCancelados`)
// resolve um gatilho mais novo que o voo em curso com
// `.catch(() => {}).then(() => dispararOuEncadearBuscaCancelados(...))` —
// e esse `.then` cria um `AbortController` NOVO e dispara `executarBusca`
// de novo assim que o voo antigo assentar, mesmo que o componente já
// tenha desmontado nesse meio-tempo. O cleanup de desmonte só cancelava a
// requisição EM VOO (`cancelledOrdersAbortControllerRef`) e a releitura de
// arrasto (`releituraDeArrastoAgendadaRef`) — não esta terceira forma de
// religar depois do desmonte.
//
// Mock no mesmo molde de use-orders-cancelados-nao-baixa-o-banco-inteiro.test.tsx
// (`montarSondaAdmin`, achado 2): sem @testing-library/react neste projeto,
// o hook se alcança por um componente que expõe a função via efeito, e o
// handler real de `channel.on("postgres_changes", ...)` é capturado para
// simular eventos remotos de realtime.
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

// `true` neste arquivo inteiro: os dois achados precisam do canal de
// realtime de verdade ligado (`channel.on("postgres_changes", ...)`), não
// só do BroadcastChannel de aba secundária.
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
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
  desmontar: () => void;
}> {
  const { useOrders } = await import("@/hooks/useOrders");

  let buscar: BuscaCancelados = async () => [];
  let update: AtualizaStatusAdmin = async () => {};

  function Sonda() {
    const { fetchPedidosCancelados, updateOrderStatus } = useOrders(true, true);
    useEffect(() => {
      buscar = fetchPedidosCancelados;
      update = updateOrderStatus;
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
    desmontar: () => raiz.unmount(),
  };
}

describe("pedidosCanceladosLocalmenteRef expira em 30s (ressalva 'a' da revisão de useOrders-1417)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
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

  it("eco que chega depois de 30s NÃO é engolido: conta como gatilho novo e força uma varredura de verdade", async () => {
    const chamadasGetAdminOrdersPaged: any[] = [];
    rpc.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome === "update_order_status_atomic") {
        return Promise.resolve({ error: null });
      }
      if (nome === "get_admin_orders_paged") {
        chamadasGetAdminOrdersPaged.push(true);
        return {
          abortSignal: () =>
            Promise.resolve({
              data: { data: [linhaCanceladaFake("pedido-A")], total_count: 1 },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });

    const { chamarUpdateOrderStatus, chamarFetchPedidosCancelados } =
      await montarSondaAdmin();
    expect(mockRealtimeOnHandler).toBeTruthy();

    // t=0: cancelamento LOCAL de pedido-A — soma o gatilho, marca o id como
    // "eco pendente" e dispara a varredura #1 (resolve na hora, mock
    // síncrono o bastante para o teste).
    await act(async () => {
      await chamarUpdateOrderStatus("pedido-A", "cancelled");
    });
    expect(chamadasGetAdminOrdersPaged).toHaveLength(1);

    // t=31s: o eco de VERDADE deste cancelamento nunca chegou (perdido no
    // canal) — mas outra coisa qualquer reativa a busca (ex.: trocar de
    // aba), só para avançar `ultimaBuscaCanceladosConcluidaEmRef` sem tocar
    // no id de pedido-A. Sem novo gatilho, cai fora da janela de 5s por
    // TEMPO e dispara uma segunda varredura real.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31000);
    });
    await act(async () => {
      await chamarFetchPedidosCancelados();
    });
    expect(chamadasGetAdminOrdersPaged).toHaveLength(2);

    // t=31.5s (500ms depois da varredura #2, dentro da janela de 5s dela —
    // mas 31.5s depois da entrada de pedido-A no set, ou seja EXPIRADA):
    // chega um cancelamento GENUÍNO e NOVO de pedido-A (outra sessão
    // reabriu e cancelou de novo) pelo canal de realtime.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await mockRealtimeOnHandler!({
        eventType: "UPDATE",
        new: { id: "pedido-A", status: "cancelled" },
        old: { id: "pedido-A" },
      });
      // assenta a promise encadeada de fetchPedidosCancelados().catch(()=>{})
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // O DEFEITO (ressalva 'a'): sem expiração, `pedidosCanceladosLocalmenteRef`
    // ainda tem "pedido-A" (o eco de t=0 nunca chegou para limpá-la) — este
    // evento seria consumido como SE fosse aquele eco velho, o gatilho NÃO
    // avançaria e, como isto está a só 500ms da varredura #2 (dentro da
    // janela de 5s), o painel serviria o CACHE em vez de reconhecer que
    // pedido-A mudou de novo. Com a expiração de 30s, a entrada já não
    // conta mais como eco pendente: o gatilho avança e uma TERCEIRA
    // varredura real acontece.
    expect(chamadasGetAdminOrdersPaged).toHaveLength(3);
  });
});

describe("cleanup de desmonte cancela o encadeamento do voo sujo (ressalva 'b' da revisão de useOrders-1417)", () => {
  beforeEach(() => {
    rpc.mockReset();
    stubLocalStorage();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    host.remove();
    vi.unstubAllGlobals();
  });

  it("um gatilho mais novo que chega durante um voo em curso não reencadeia mais uma varredura depois que o componente já desmontou", async () => {
    let resolverVoo1: (v: unknown) => void = () => {};
    const voo1 = new Promise((resolve) => {
      resolverVoo1 = resolve;
    });
    let numeroDaChamada = 0;
    const chamadasGetAdminOrdersPaged: any[] = [];

    rpc.mockImplementation((nome: string) => {
      if (nome === "get_admin_orders_paged") {
        numeroDaChamada += 1;
        chamadasGetAdminOrdersPaged.push(true);
        if (numeroDaChamada === 1) {
          // Voo #1: fica pendente de propósito — é o "voo sujo" do teste.
          return { abortSignal: () => voo1 };
        }
        // Qualquer varredura seguinte (não deveria acontecer depois do
        // desmonte) resolve rápido.
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

    const { chamarFetchPedidosCancelados, desmontar } =
      await montarSondaAdmin();
    expect(mockRealtimeOnHandler).toBeTruthy();

    // Dispara o voo #1, que fica pendente.
    let resultadoVoo1: Promise<Order[]> = Promise.resolve([]);
    act(() => {
      resultadoVoo1 = chamarFetchPedidosCancelados();
    });
    expect(chamadasGetAdminOrdersPaged).toHaveLength(1);

    // ENQUANTO o voo #1 ainda não voltou, um cancelamento remoto (pelo
    // canal) soma um gatilho mais novo — isto entra no ramo de "voo sujo"
    // (`.catch().then(() => dispararOuEncadearBuscaCancelados(...))`), que
    // fica esperando o voo #1 assentar para religar.
    await act(async () => {
      await mockRealtimeOnHandler!({
        eventType: "UPDATE",
        new: { id: "pedido-remoto", status: "cancelled" },
        old: { id: "pedido-remoto" },
      });
    });

    // O componente desmonta ANTES do voo #1 assentar — exatamente o caso
    // em que a lojista troca de tela no meio da varredura.
    act(() => {
      desmontar();
    });

    // Só agora o voo #1 assenta — o encadeamento (`.then`) dispararia a
    // religação, se não fosse cancelado pelo cleanup de desmonte.
    await act(async () => {
      resolverVoo1({ data: { data: [], total_count: 0 }, error: null });
      await resultadoVoo1.catch(() => {});
      // dá tempo para a cadeia `.catch().then(...)` rodar, se for rodar
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // O DEFEITO (ressalva 'b'): sem a guarda de desmonte, o `.then()` do
    // voo sujo chama `dispararOuEncadearBuscaCancelados` de novo, que cria
    // um AbortController NOVO e dispara `executarBusca` — uma SEGUNDA
    // chamada de rede depois que ninguém mais está olhando para o
    // resultado (e um `setPedidosCancelados` numa instância morta). Com a
    // guarda, o encadeamento para no desmonte: só a chamada #1 aconteceu.
    expect(chamadasGetAdminOrdersPaged).toHaveLength(1);
  });
});

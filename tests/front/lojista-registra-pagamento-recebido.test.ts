// @vitest-environment jsdom
//
// Task 3 do plano
// docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md — o front
// enxerga os campos que a Task 1 criou no banco
// (`pagamento_recebido_em`/`pagamento_recebido_por`) e o hook ganha
// `registrarPagamentoRecebido`, que chama a RPC
// `registrar_pagamento_recebido`.
//
// 🔴 O DEFEITO HISTÓRICO deste projeto mora exatamente aqui: um plano
// anterior dizia "Consome: a coluna payment_status" como se ela chegasse ao
// front, e `mapOrderFromDB` nunca a copiou — o filtro e o selo ficaram
// corretos no código e TODO pedido se comportava como se o campo fosse
// vazio. Coluna que não passa pelo mapper não existe para a tela. Por isso
// o primeiro describe (o mapper) é o caso mais importante deste arquivo.
//
// A migration `20261020000000` ainda não está aplicada quando o front sobe
// (ver "A ordem de subida", no plano) — o segundo caso do mapper prova que
// a tela sobrevive a uma linha sem essas colunas.
//
// Mock de `@/lib/supabase`/`@/hooks/useAuth`/`@/hooks/useLeaderElection`
// copiado do molde real que já monta `useOrders(true, true)` com sucesso —
// tests/front/cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx
// (`montarSondaAdmin`). POR QUE `createElement` EM VEZ DE JSX: este arquivo
// é `.test.ts`, não `.test.tsx` (mesmo padrão de
// tests/front/use-orders-estado-de-conexao-realtime.test.ts).
import { mapOrderFromDB } from "@/lib/mappers";
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("o mapper leva os campos de recebimento para a tela", () => {
  it("copia pagamento_recebido_em e pagamento_recebido_por", () => {
    const pedido = mapOrderFromDB({
      id: "o1",
      status: "pending",
      payment_method: "cash",
      payment_status: "recebido_na_entrega",
      pagamento_recebido_em: "2026-08-27T12:00:00.000Z",
      pagamento_recebido_por: "admin-1",
      total: 250,
      items: [],
    } as never);

    expect(pedido.pagamentoRecebidoEm).toBe("2026-08-27T12:00:00.000Z");
    expect(pedido.pagamentoRecebidoPor).toBe("admin-1");
  });

  it("pedido sem os campos vira null, nao undefined nem string vazia", () => {
    const pedido = mapOrderFromDB({
      id: "o2",
      status: "pending",
      payment_method: "pix",
      payment_status: null,
      total: 10,
      items: [],
    } as never);

    expect(pedido.pagamentoRecebidoEm).toBeNull();
    expect(pedido.pagamentoRecebidoPor).toBeNull();
  });
});

// ---------------------------------------------------------------------
// registrarPagamentoRecebido (hook) — o caso que mais importa é o do
// cache: sem limpar o cache do useAnalytics, a tela marca o pagamento e o
// número da receita não muda, porque useAnalytics guarda o resultado em
// cache de módulo.
const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ data: [], error: null }) }),
      }),
    }),
    channel: () => ({
      on: (
        _evento: string,
        _filtro: unknown,
        handler: (payload: unknown) => unknown,
      ) => {
        void handler;
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

const usuarioAdmin = { id: "admin-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAdmin, isAdmin: true }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: vi.fn(),
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type RegistraPagamento = (
  orderId: string,
  recebido: boolean,
) => Promise<unknown>;

async function montarSondaAdmin(
  raiz: Root,
): Promise<{ registrarPagamentoRecebido: RegistraPagamento }> {
  const { useOrders } = await import("@/hooks/useOrders");

  let registrar: RegistraPagamento = async () => undefined;

  function SondaAdmin() {
    const { registrarPagamentoRecebido } = useOrders(true, true);
    useEffect(() => {
      registrar = registrarPagamentoRecebido;
    });
    return null;
  }

  await act(async () => {
    raiz.render(createElement(SondaAdmin));
  });

  return {
    registrarPagamentoRecebido: (orderId, recebido) =>
      registrar(orderId, recebido),
  };
}

describe("registrarPagamentoRecebido — limpa o cache do useAnalytics, senao a receita nao muda", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(async () => {
    rpc.mockReset();
    const { clearAnalyticsCache } = await import("@/hooks/useAnalytics");
    vi.mocked(clearAnalyticsCache).mockClear();
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

  it("depois de registrar recebimento com sucesso, clearAnalyticsCache foi chamado UMA vez", async () => {
    rpc.mockResolvedValue({
      data: {
        order_id: "pedido-1",
        payment_status: "recebido_na_entrega",
        pagamento_recebido_em: "2026-08-27T12:00:00.000Z",
        pagamento_recebido_por: "admin-1",
        ja_estava: false,
      },
      error: null,
    });

    const { clearAnalyticsCache } = await import("@/hooks/useAnalytics");
    const { registrarPagamentoRecebido } = await montarSondaAdmin(raiz);

    await act(async () => {
      await registrarPagamentoRecebido("pedido-1", true);
    });

    expect(rpc).toHaveBeenCalledWith("registrar_pagamento_recebido", {
      p_order_id: "pedido-1",
      p_recebido: true,
    });
    expect(clearAnalyticsCache).toHaveBeenCalledTimes(1);
  });

  it("erro na RPC: nao chama clearAnalyticsCache e propaga o erro (throw)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: new Error("RPC caiu"),
    });

    const { clearAnalyticsCache } = await import("@/hooks/useAnalytics");
    const { registrarPagamentoRecebido } = await montarSondaAdmin(raiz);

    await act(async () => {
      await expect(
        registrarPagamentoRecebido("pedido-1", true),
      ).rejects.toThrow();
    });

    expect(clearAnalyticsCache).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// Task 3c, Step 2 — os TRES `.map` que espalham a resposta da RPC para
// `cachedAdminOrders`, `orders` e `pedidosCancelados`. Hoje apagar os tres
// deixa a suite inteira VERDE: o unico caso que o plano original exigiu foi
// o do `clearAnalyticsCache`, acima. Sao estes tres `.map` que fazem o selo
// do pedido e o balde de estorno mudarem SEM RECARREGAR A TELA — some com
// eles e o lojista clica, nada muda na tela, e nenhum teste reclamava.
//
// Cada teste usa um id de pedido PRÓPRIO ("pedido-orders"/"pedido-cancelados"
// /"pedido-cache") porque `cachedAdminOrders` é variável de MÓDULO: como
// este arquivo não chama `vi.resetModules()`, ela persiste do fim de um
// teste para o início do próximo, e reusar o mesmo id deixaria um teste
// lendo o resultado que o teste anterior gravou, em vez do próprio fetch.
//
// Inclui `pagamentoRecebidoPor` nas três asserções: sem isso o Step 1 desta
// Task (o `.map` já existia para `paymentStatus`/`pagamentoRecebidoEm`, mas
// não propagava `pagamentoRecebidoPor`) nasce sem cobertura.
function linhaAdminFake(id: string) {
  return {
    id,
    status: "pending",
    payment_method: "cash",
    payment_status: null,
    total: 100,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    items: [],
  };
}

type CarregaOrdersAdmin = () => Promise<{ orders: any[]; total: number }>;
type BuscaCancelados = () => Promise<any[]>;

async function montarSondaTresEstados(
  raizAlvo: Root,
  idPedido: string,
): Promise<{
  loadOrders: CarregaOrdersAdmin;
  fetchPedidosCancelados: BuscaCancelados;
  registrarPagamentoRecebido: RegistraPagamento;
  pegarOrders: () => any[];
  pegarPedidosCancelados: () => any[];
}> {
  const { useOrders } = await import("@/hooks/useOrders");

  let carregar: CarregaOrdersAdmin = async () => ({ orders: [], total: 0 });
  let buscarCancelados: BuscaCancelados = async () => [];
  let registrar: RegistraPagamento = async () => undefined;
  let ordersAtuais: any[] = [];
  let canceladosAtuais: any[] = [];

  function SondaTresEstados() {
    const {
      orders,
      pedidosCancelados,
      loadOrders,
      fetchPedidosCancelados,
      registrarPagamentoRecebido,
    } = useOrders(true, true);
    useEffect(() => {
      ordersAtuais = orders;
      canceladosAtuais = pedidosCancelados;
      carregar = loadOrders as unknown as CarregaOrdersAdmin;
      buscarCancelados = fetchPedidosCancelados;
      registrar = registrarPagamentoRecebido;
    });
    return null;
  }

  await act(async () => {
    raizAlvo.render(createElement(SondaTresEstados));
  });

  void idPedido; // usado só pelo chamador, para nomear os casos de teste

  return {
    loadOrders: () => carregar(),
    fetchPedidosCancelados: () => buscarCancelados(),
    registrarPagamentoRecebido: (orderId, recebido) =>
      registrar(orderId, recebido),
    pegarOrders: () => ordersAtuais,
    pegarPedidosCancelados: () => canceladosAtuais,
  };
}

function mockRpcAdminOrdersEPagamento(idPedido: string) {
  rpc.mockReset();
  rpc.mockImplementation((nome: string, args: any) => {
    if (nome === "get_admin_orders_paged") {
      return {
        abortSignal: () =>
          Promise.resolve({
            data: { data: [linhaAdminFake(idPedido)], total_count: 1 },
            error: null,
          }),
      };
    }
    if (nome === "registrar_pagamento_recebido") {
      return Promise.resolve({
        data: {
          order_id: args.p_order_id,
          payment_status: "recebido_na_entrega",
          pagamento_recebido_em: "2026-08-27T12:00:00.000Z",
          pagamento_recebido_por: "admin-1",
          ja_estava: false,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

describe("registrarPagamentoRecebido atualiza os TRES estados (cachedAdminOrders, orders, pedidosCancelados)", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
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

  it("atualiza paymentStatus/pagamentoRecebidoEm/pagamentoRecebidoPor em `orders`", async () => {
    const idPedido = "pedido-orders";
    mockRpcAdminOrdersEPagamento(idPedido);
    const sonda = await montarSondaTresEstados(raiz, idPedido);

    await act(async () => {
      await sonda.loadOrders();
    });
    await act(async () => {
      await sonda.registrarPagamentoRecebido(idPedido, true);
    });

    const pedido = sonda.pegarOrders().find((o) => o.id === idPedido);
    expect(pedido?.paymentStatus).toBe("recebido_na_entrega");
    expect(pedido?.pagamentoRecebidoEm).toBe("2026-08-27T12:00:00.000Z");
    expect(pedido?.pagamentoRecebidoPor).toBe("admin-1");
  });

  it("atualiza os mesmos campos em `pedidosCancelados`", async () => {
    const idPedido = "pedido-cancelados";
    mockRpcAdminOrdersEPagamento(idPedido);
    const sonda = await montarSondaTresEstados(raiz, idPedido);

    await act(async () => {
      await sonda.fetchPedidosCancelados();
    });
    await act(async () => {
      await sonda.registrarPagamentoRecebido(idPedido, true);
    });

    const pedido = sonda
      .pegarPedidosCancelados()
      .find((o) => o.id === idPedido);
    expect(pedido?.paymentStatus).toBe("recebido_na_entrega");
    expect(pedido?.pagamentoRecebidoEm).toBe("2026-08-27T12:00:00.000Z");
    expect(pedido?.pagamentoRecebidoPor).toBe("admin-1");
  });

  it("atualiza cachedAdminOrders — uma instância NOVA do hook vê o cache sem novo fetch", async () => {
    const idPedido = "pedido-cache";
    mockRpcAdminOrdersEPagamento(idPedido);
    const sonda = await montarSondaTresEstados(raiz, idPedido);

    await act(async () => {
      await sonda.loadOrders();
    });
    await act(async () => {
      await sonda.registrarPagamentoRecebido(idPedido, true);
    });

    // Segunda instância, host/raiz PRÓPRIOS: o `useState` inicial dela lê
    // `cachedAdminOrders` (variável de módulo) — sem chamar `loadOrders` de
    // novo. É assim que se observa o cache de fora, já que o hook não o
    // expõe diretamente.
    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const raiz2 = createRoot(host2);
    const sonda2 = await montarSondaTresEstados(raiz2, idPedido);

    const pedido = sonda2.pegarOrders().find((o) => o.id === idPedido);
    expect(pedido?.paymentStatus).toBe("recebido_na_entrega");
    expect(pedido?.pagamentoRecebidoEm).toBe("2026-08-27T12:00:00.000Z");
    expect(pedido?.pagamentoRecebidoPor).toBe("admin-1");

    act(() => {
      raiz2.unmount();
    });
    host2.remove();
  });
});

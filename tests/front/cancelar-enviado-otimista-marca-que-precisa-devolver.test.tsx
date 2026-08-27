// @vitest-environment jsdom
//
// Achado da execução da Task 5 (plano
// docs/superpowers/plans/2026-08-24-cancelamento-com-estorno.md, 26/08/2026):
// o UPDATE OTIMISTA de `updateOrderStatus` (useOrders.ts) fazia
// `Object.assign({}, o); updatedOrder.status = status;` e nunca derivava
// `cancelledAfterShipping`. A lojista cancela pelo painel um pedido JÁ
// ENVIADO, o estado otimista entra no cache com `cancelledAfterShipping:
// false` até o servidor responder, e `baldeDeEstorno` (AdminOrdersView.tsx)
// manda esse pedido para "Devolver agora" em vez de "Esperando o produto
// voltar" — a loja devolveria o dinheiro ANTES de receber a mercadoria de
// volta.
//
// POR QUE A SONDA: este projeto não tem @testing-library/react (mesmo
// motivo documentado em use-orders-otp-so-promete-o-que-enviou.test.tsx) —
// o hook se alcança por um componente que expõe `orders` e
// `updateOrderStatus` via efeito, sem atribuição em render.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, OrderStatus } from "@/types";

const rpc = vi.fn();

// Achado A da revisão de 26/08/2026 (rodada 4), "cuide do caminho do
// realtime também": para exercitar o handler REAL que `channel.on(
// "postgres_changes", ..., handler)` registra (sem reescrever o canal de
// verdade), o mock captura esse handler numa variável de módulo — o prefixo
// "mock" é o que deixa o Vitest referenciá-la de dentro do factory
// hoisted (mesmo padrão de `mockOrders` em painel-lista-estorno-devido.test.tsx).
let mockRealtimeOnHandler: ((payload: unknown) => unknown) | null = null;

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
        mockRealtimeOnHandler = handler;
        return { subscribe: () => ({}) };
      },
      // `subscribe` continua ignorando o próprio callback (status da
      // conexão) — nenhum teste deste arquivo depende dele, e mudar isso
      // destravaria efeitos de reconexão que não vêm ao caso aqui.
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
// `false` por padrão (mesmo valor de sempre, nenhum teste pré-existente
// depende de canal realtime nenhum — todos usam `enabled=false`). Só o
// describe do caminho do realtime (achado A) liga isto por um instante.
let mockIsLeader = false;
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: mockIsLeader }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(status: OrderStatus): Order {
  return {
    id: "pedido-1",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status,
    paymentStatus: "pago",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
  };
}

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;

type PegaOrders = () => Order[];
type AtualizaStatus = (id: string, status: OrderStatus) => Promise<void>;
type ConfirmaRetorno = (id: string) => Promise<unknown>;

async function montarSondaComCache(pedido: Order): Promise<{
  pegarOrders: PegaOrders;
  updateOrderStatus: AtualizaStatus;
  confirmarRetornoDoProduto: ConfirmaRetorno;
}> {
  armazem.set(`ikcous_orders_cache_${usuario.id}`, JSON.stringify([pedido]));

  const { useOrders } = await import("@/hooks/useOrders");

  let ordersAtuais: Order[] = [];
  let update: AtualizaStatus = async () => {};
  let confirmarRetorno: ConfirmaRetorno = async () => undefined;

  function Sonda() {
    const { orders, updateOrderStatus, confirmarRetornoDoProduto } = useOrders(
      false,
      false,
    );
    useEffect(() => {
      ordersAtuais = orders;
      update = updateOrderStatus;
      confirmarRetorno = confirmarRetornoDoProduto;
    });
    return null;
  }

  await act(async () => {
    raiz.render(<Sonda />);
  });

  return {
    pegarOrders: () => ordersAtuais,
    updateOrderStatus: update,
    confirmarRetornoDoProduto: confirmarRetorno,
  };
}

describe("updateOrderStatus — o update otimista deriva cancelledAfterShipping", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
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

  it("cancelar um pedido JÁ ENVIADO (shipping) marca cancelledAfterShipping=true", async () => {
    const { pegarOrders, updateOrderStatus } = await montarSondaComCache(
      pedidoFake("shipping"),
    );

    await act(async () => {
      await updateOrderStatus("pedido-1", "cancelled");
    });

    const pedido = pegarOrders().find((o) => o.id === "pedido-1");
    expect(pedido?.status).toBe("cancelled");
    expect(pedido?.cancelledAfterShipping).toBe(true);
  });

  it("controle negativo: cancelar um pedido NÃO enviado (pending) mantém cancelledAfterShipping=false", async () => {
    const { pegarOrders, updateOrderStatus } = await montarSondaComCache(
      pedidoFake("pending"),
    );

    await act(async () => {
      await updateOrderStatus("pedido-1", "cancelled");
    });

    const pedido = pegarOrders().find((o) => o.id === "pedido-1");
    expect(pedido?.status).toBe("cancelled");
    expect(pedido?.cancelledAfterShipping).toBe(false);
  });

  it("controle negativo: cancelar um pedido em preparo (processing) mantém cancelledAfterShipping=false", async () => {
    const { pegarOrders, updateOrderStatus } = await montarSondaComCache(
      pedidoFake("processing"),
    );

    await act(async () => {
      await updateOrderStatus("pedido-1", "cancelled");
    });

    const pedido = pegarOrders().find((o) => o.id === "pedido-1");
    expect(pedido?.status).toBe("cancelled");
    expect(pedido?.cancelledAfterShipping).toBe(false);
  });
});

// `derivarCancelledAfterShipping` é a MESMA função chamada nos dois `.map`
// do update otimista — o de `cachedAdminOrders` (cache de remontagem do
// painel) e o de `setOrders` (estado ao vivo, testado acima via sonda). O
// caminho de `cachedAdminOrders` só é alcançável recarregando a página
// paginada via RPC (`get_admin_orders_paged`, encadeada com
// `.abortSignal()`), o que testaria o dublê da RPC mais que a derivação em
// si — por isso a mesma regra é provada aqui, isolada, cobrindo TODAS as
// transições de status que importam para os dois `.map`.
describe("derivarCancelledAfterShipping — a regra usada nos dois `.map` do update otimista", () => {
  it("cancelar a partir de shipping: true", async () => {
    const { derivarCancelledAfterShipping } = await import("@/hooks/useOrders");
    expect(derivarCancelledAfterShipping("shipping", "cancelled", false)).toBe(
      true,
    );
  });

  it("cancelar a partir de pending: false", async () => {
    const { derivarCancelledAfterShipping } = await import("@/hooks/useOrders");
    expect(derivarCancelledAfterShipping("pending", "cancelled", false)).toBe(
      false,
    );
  });

  it("cancelar a partir de processing: false", async () => {
    const { derivarCancelledAfterShipping } = await import("@/hooks/useOrders");
    expect(
      derivarCancelledAfterShipping("processing", "cancelled", false),
    ).toBe(false);
  });

  it("mudança que NÃO é cancelamento (ex.: processing -> shipping) preserva o valor atual, mesmo que já fosse true", async () => {
    // Histórico: o campo nunca deveria "esquecer" um true por uma mudança de
    // status que não é cancelamento — embora nenhum fluxo real hoje mude
    // status de um pedido já cancelado.
    const { derivarCancelledAfterShipping } = await import("@/hooks/useOrders");
    expect(derivarCancelledAfterShipping("processing", "shipping", true)).toBe(
      true,
    );
    expect(derivarCancelledAfterShipping("processing", "shipping", false)).toBe(
      false,
    );
  });
});

// Achado da revisão (26/08/2026): o toast de `confirmarRetornoDoProduto`
// (useOrders.ts) afirmava "Estoque atualizado" também no SEGUNDO clique,
// quando a RPC devolve `ja_confirmado: true` porque a idempotência mora no
// banco — o estoque não muda nada nesse caso. O texto tem que dizer a
// verdade do que ESTE clique fez, não repetir a mesma frase sempre.
describe("confirmarRetornoDoProduto — o toast diz a verdade do que ESTE clique fez", () => {
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
    vi.mocked(toast.success).mockClear();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("primeiro clique (ja_confirmado: false): avisa que o estoque foi atualizado", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "confirmar_retorno_do_produto") {
        return Promise.resolve({
          data: { ok: true, ja_confirmado: false },
          error: null,
        });
      }
      return Promise.resolve({ error: null });
    });

    const { confirmarRetornoDoProduto } = await montarSondaComCache(
      pedidoFake("cancelled"),
    );

    await act(async () => {
      await confirmarRetornoDoProduto("pedido-1");
    });

    expect(toast.success).toHaveBeenCalledWith(
      "Retorno do produto confirmado. Estoque atualizado.",
    );
  });

  it("segundo clique (ja_confirmado: true): NÃO promete estoque atualizado — este clique não mexeu em nada", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "confirmar_retorno_do_produto") {
        return Promise.resolve({
          data: {
            ok: true,
            ja_confirmado: true,
            returned_to_seller_at: "2026-08-25T10:00:00Z",
          },
          error: null,
        });
      }
      return Promise.resolve({ error: null });
    });

    const { confirmarRetornoDoProduto } = await montarSondaComCache(
      pedidoFake("cancelled"),
    );

    await act(async () => {
      await confirmarRetornoDoProduto("pedido-1");
    });

    expect(toast.success).not.toHaveBeenCalledWith(
      "Retorno do produto confirmado. Estoque atualizado.",
    );
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/já tinha sido confirmado/i),
    );
  });

  // ITEM 3 da revisão de 26/08/2026: a RPC real, no PRIMEIRO clique, devolve
  // `jsonb_build_object('ok', true, 'ja_confirmado', false)` — migration
  // 20260970000000:199, SEM o campo `returned_to_seller_at`. O fallback
  // (`new Date().toISOString()`) em useOrders.ts é a ÚNICA coisa que tira o
  // pedido do balde de mercadoria no caminho feliz; trocar esse fallback
  // por `null` sobrevivia à suíte inteira antes deste teste — sem
  // `returned_to_seller_at`, o pedido ficaria preso no balde para sempre,
  // convidando a clicar de novo.
  it("primeiro clique SEM `returned_to_seller_at` na resposta da RPC: o fallback preenche o campo, e isso tira o pedido do balde de mercadoria", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "confirmar_retorno_do_produto") {
        return Promise.resolve({
          data: { ok: true, ja_confirmado: false },
          error: null,
        });
      }
      return Promise.resolve({ error: null });
    });

    const pedidoCanceladoEnviado: Order = {
      ...pedidoFake("cancelled"),
      cancelledAfterShipping: true,
      returnedToSellerAt: null,
    };

    const { pegarOrders, confirmarRetornoDoProduto } =
      await montarSondaComCache(pedidoCanceladoEnviado);

    await act(async () => {
      await confirmarRetornoDoProduto("pedido-1");
    });

    const pedido = pegarOrders().find((o) => o.id === "pedido-1");
    // A mutação-alvo: trocar o fallback por `null` faz esta asserção
    // falhar (`typeof null === "object"`, `null` também é falsy).
    expect(typeof pedido?.returnedToSellerAt).toBe("string");
    expect(pedido?.returnedToSellerAt).toBeTruthy();

    // A consequência que justifica o teste: com o campo preenchido, o
    // pedido REALMENTE sai do balde de mercadoria (ver
    // AdminOrdersView.tsx, `precisaConfirmarRetornoDoProduto`).
    const { precisaConfirmarRetornoDoProduto } = await import(
      "@/views/admin/AdminOrdersView"
    );
    expect(precisaConfirmarRetornoDoProduto(pedido!)).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Rodada 4 (26/08/2026) — três achados que BLOQUEARAM a revisão anterior:
//
//   A. `pedidosCancelados` (a lista própria de que os dois baldes de
//      AdminOrdersView.tsx dependem) não reagia ao cancelamento que a
//      cria: nem ao clique local (`updateOrderStatus`), nem ao evento que
//      chega por realtime.
//   B/D. falha de rede na RPC e truncagem pelo teto de páginas tinham a
//      MESMA cara de "não há nada pendente" — sem sinal nenhum na tela.
//   C. a propriedade que dá nome a esta rodada (a consulta paginada,
//      imune a filtro/busca/período) não tinha teste nenhum contra a
//      função REAL — só contra dublê do hook inteiro.
//   E. o rollback de `confirmarRetornoDoProduto` só conseguia perder
//      dado: era sempre um retrato tirado ANTES de qualquer escrita.
//
// Os testes abaixo usam uma sonda ADMIN (`useOrders(true, true)`) — os de
// cima usam `useOrders(false, false)` porque testavam o lado do CLIENTE.
// Cada função exposta é acessada por um WRAPPER que lê a variável mutável
// no INSTANTE da chamada (`update`, `confirmarRetorno`, ...), nunca uma
// cópia tirada no mount: `updateOrderStatus`/`confirmarRetornoDoProduto`
// são recriados a cada mudança de estado (dependências `orders`/
// `pedidosCancelados`), e mais de um destes testes muda esse estado ENTRE
// o mount e a chamada — destructurar uma vez só reusaria uma closure
// velha, fechada sobre `pedidosCancelados` de antes do fetch.
type CarregaOrdersAdmin = (
  page?: number,
  pageSize?: number,
  statusFilter?: string,
  searchQuery?: string,
  startDate?: string,
  endDate?: string,
  silent?: boolean,
) => Promise<{ orders: Order[]; total: number }>;

async function montarSondaAdmin(): Promise<{
  chamarUpdateOrderStatus: AtualizaStatus;
  chamarConfirmarRetorno: ConfirmaRetorno;
  chamarFetchPedidosCancelados: () => Promise<Order[]>;
  chamarLoadOrders: CarregaOrdersAdmin;
  pegarPedidosCancelados: () => Order[];
  pegarIncompleto: () => boolean;
}> {
  const { useOrders } = await import("@/hooks/useOrders");

  let update: AtualizaStatus = async () => {};
  let confirmarRetorno: ConfirmaRetorno = async () => undefined;
  let fetchCancelados: () => Promise<Order[]> = async () => [];
  let carregar: CarregaOrdersAdmin = async () => ({ orders: [], total: 0 });
  let cancelados: Order[] = [];
  let incompleto = false;

  function SondaAdmin() {
    const {
      updateOrderStatus,
      confirmarRetornoDoProduto,
      fetchPedidosCancelados,
      loadOrders,
      pedidosCancelados,
      pedidosCanceladosIncompleto,
    } = useOrders(true, true);
    useEffect(() => {
      update = updateOrderStatus;
      confirmarRetorno = confirmarRetornoDoProduto;
      fetchCancelados = fetchPedidosCancelados;
      carregar = loadOrders;
      cancelados = pedidosCancelados;
      incompleto = pedidosCanceladosIncompleto;
    });
    return null;
  }

  await act(async () => {
    raiz.render(<SondaAdmin />);
  });

  return {
    chamarUpdateOrderStatus: (id, status) => update(id, status),
    chamarConfirmarRetorno: (id) => confirmarRetorno(id),
    chamarFetchPedidosCancelados: () => fetchCancelados(),
    chamarLoadOrders: (...args) => carregar(...args),
    pegarPedidosCancelados: () => cancelados,
    pegarIncompleto: () => incompleto,
  };
}

function linhaCanceladaFake(id: string) {
  return {
    id,
    status: "cancelled",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

describe("updateOrderStatus (admin) recarrega pedidosCancelados sozinho — achado A da revisão de 26/08/2026 (rodada 4)", () => {
  let chamadasGetAdminOrdersPaged: any[];

  beforeEach(() => {
    rpc.mockReset();
    chamadasGetAdminOrdersPaged = [];
    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "update_order_status_atomic") {
        return Promise.resolve({ error: null });
      }
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
      return Promise.resolve({ error: null });
    });
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

  it("depois de cancelar um pedido pelo painel, o hook busca a lista PRÓPRIA de cancelados sozinho — sem precisar trocar de aba", async () => {
    const { chamarUpdateOrderStatus } = await montarSondaAdmin();

    await act(async () => {
      await chamarUpdateOrderStatus("pedido-x", "cancelled");
    });

    const chamadaDeCancelados = chamadasGetAdminOrdersPaged.find(
      (args) => args.p_status === "cancelled",
    );
    expect(chamadaDeCancelados).toBeTruthy();
  });

  it("controle negativo: um status que NÃO é 'cancelled' não dispara a busca da lista de cancelados", async () => {
    const { chamarUpdateOrderStatus } = await montarSondaAdmin();

    await act(async () => {
      await chamarUpdateOrderStatus("pedido-y", "shipping");
    });

    expect(
      chamadasGetAdminOrdersPaged.some((args) => args.p_status === "cancelled"),
    ).toBe(false);
  });
});

describe("realtime UPDATE (admin) também recarrega pedidosCancelados — achado A, 'cuide do caminho do realtime também'", () => {
  let chamadasGetAdminOrdersPaged: any[];

  beforeEach(() => {
    mockIsLeader = true;
    mockRealtimeOnHandler = null;
    rpc.mockReset();
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
      return Promise.resolve({ error: null });
    });
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
    mockIsLeader = false;
    mockRealtimeOnHandler = null;
  });

  it("pedido cancelado chegando pelo canal (cliente cancelou pelo dele, ou outra sessão admin) também recarrega a lista de cancelados", async () => {
    await montarSondaAdmin();

    expect(mockRealtimeOnHandler).toBeTruthy();

    await act(async () => {
      await mockRealtimeOnHandler!({
        eventType: "UPDATE",
        new: { id: "pedido-remoto", status: "cancelled" },
        old: { id: "pedido-remoto" },
      });
    });

    expect(
      chamadasGetAdminOrdersPaged.some((args) => args.p_status === "cancelled"),
    ).toBe(true);
  });
});

describe("fetchPedidosCancelados (hook real) — a propriedade que esta rodada existe para fechar, achado C", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(toast.error).mockClear();
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

  it("os seis argumentos da primeira página são exatamente os fixos — p_status='cancelled', busca/período vazios", async () => {
    const chamadas: any[] = [];
    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "get_admin_orders_paged") {
        chamadas.push(args);
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

    const { chamarFetchPedidosCancelados } = await montarSondaAdmin();
    await act(async () => {
      await chamarFetchPedidosCancelados();
    });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toEqual({
      p_search: "",
      p_status: "cancelled",
      p_start_date: "",
      p_end_date: "",
      p_page: 0,
      p_page_size: 200,
    });
  });

  it("total_count maior que uma página busca a segunda e acumula tudo — o laço de paginação é real", async () => {
    const chamadas: any[] = [];
    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "get_admin_orders_paged") {
        chamadas.push(args);
        const linhas =
          args.p_page === 0
            ? Array.from({ length: 200 }, (_, i) =>
                linhaCanceladaFake(`pg0-${i}`),
              )
            : Array.from({ length: 150 }, (_, i) =>
                linhaCanceladaFake(`pg1-${i}`),
              );
        return {
          abortSignal: () =>
            Promise.resolve({
              data: { data: linhas, total_count: 350 },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });

    const {
      chamarFetchPedidosCancelados,
      pegarPedidosCancelados,
      pegarIncompleto,
    } = await montarSondaAdmin();
    let resultado: Order[] = [];
    await act(async () => {
      resultado = await chamarFetchPedidosCancelados();
    });

    expect(chamadas.map((a) => a.p_page)).toEqual([0, 1]);
    expect(resultado).toHaveLength(350);
    expect(pegarPedidosCancelados()).toHaveLength(350);
    // Achado D: cobriu o total_count inteiro — nada truncado, nenhum aviso.
    expect(pegarIncompleto()).toBe(false);
  });

  it("teto de páginas (MAX_PAGES) truncando: marca pedidosCanceladosIncompleto — achado D", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_admin_orders_paged") {
        return {
          // total_count muito maior do que 25 páginas (MAX_PAGES) dão conta
          // de cobrir — o teto tem que interromper o laço. Página vazia
          // mantém o teste rápido: o que importa aqui é o teto, não o
          // volume de linhas.
          abortSignal: () =>
            Promise.resolve({
              data: { data: [], total_count: 999999 },
              error: null,
            }),
        };
      }
      return Promise.resolve({ error: null });
    });

    const { chamarFetchPedidosCancelados, pegarIncompleto } =
      await montarSondaAdmin();
    await act(async () => {
      await chamarFetchPedidosCancelados();
    });

    expect(pegarIncompleto()).toBe(true);
  });

  it("erro na RPC (não-abort): continua engolido em silêncio (sem toast), mas liga o aviso — achado B", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_admin_orders_paged") {
        return {
          abortSignal: () => Promise.reject(new Error("PGRST301: JWT expired")),
        };
      }
      return Promise.resolve({ error: null });
    });

    const { chamarFetchPedidosCancelados, pegarIncompleto } =
      await montarSondaAdmin();
    let resultado: Order[] = [];
    await act(async () => {
      resultado = await chamarFetchPedidosCancelados();
    });

    // O comportamento que NÃO pode mudar (BLOQUEIA 1 da revisão anterior):
    // esta falha não pode virar toast nem exceção — ela não pode derrubar
    // a lista principal de pedidos.
    expect(toast.error).not.toHaveBeenCalled();
    expect(resultado).toEqual([]);
    // O que passa a existir nesta rodada: o aviso liga.
    expect(pegarIncompleto()).toBe(true);
  });
});

describe("fetchPedidosCancelados NÃO compartilha o AbortController da lista principal — mutação 5 da revisão", () => {
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

  it("chamar fetchPedidosCancelados enquanto loadOrders (lista principal) está em voo NÃO aborta o loadOrders", async () => {
    const sinaisCapturados: { status: string; signal: AbortSignal }[] = [];
    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "get_admin_orders_paged") {
        return {
          abortSignal: (signal: AbortSignal) => {
            sinaisCapturados.push({ status: args.p_status, signal });
            if (args.p_status === "cancelled") {
              return Promise.resolve({
                data: { data: [], total_count: 0 },
                error: null,
              });
            }
            // Lista principal: fica em voo de propósito — o que este
            // teste mede é justamente que o sinal DELA não é abortado por
            // quem busca os cancelados.
            return new Promise<never>(() => {});
          },
        };
      }
      return Promise.resolve({ error: null });
    });

    const { chamarLoadOrders, chamarFetchPedidosCancelados } =
      await montarSondaAdmin();

    act(() => {
      // Fire-and-forget: fica pendente de propósito, é o "em voo" do teste.
      void chamarLoadOrders(0, 20, "open");
    });

    await act(async () => {
      await chamarFetchPedidosCancelados();
    });

    const sinalListaPrincipal = sinaisCapturados.find(
      (s) => s.status === "open",
    )?.signal;
    expect(sinalListaPrincipal).toBeTruthy();
    expect(sinalListaPrincipal?.aborted).toBe(false);
  });
});

describe("confirmarRetornoDoProduto — o rollback morto foi removido, achado E", () => {
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

  it("A falha depois que B já teve sucesso (chegado durante o await de A): o retorno de B continua marcado — nada é desfeito", async () => {
    let rejeitarA: (e: unknown) => void = () => {};
    const promessaA = new Promise((_resolve, reject) => {
      rejeitarA = reject;
    });

    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "get_admin_orders_paged") {
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: [
                  linhaCanceladaFake("pedido-A"),
                  linhaCanceladaFake("pedido-B"),
                ],
                total_count: 2,
              },
              error: null,
            }),
        };
      }
      if (nome === "confirmar_retorno_do_produto") {
        if (args.p_order_id === "pedido-A") return promessaA;
        if (args.p_order_id === "pedido-B") {
          return Promise.resolve({
            data: {
              ok: true,
              ja_confirmado: false,
              returned_to_seller_at: "2026-08-26T12:00:00Z",
            },
            error: null,
          });
        }
      }
      return Promise.resolve({ error: null });
    });

    const {
      chamarFetchPedidosCancelados,
      chamarConfirmarRetorno,
      pegarPedidosCancelados,
    } = await montarSondaAdmin();

    await act(async () => {
      await chamarFetchPedidosCancelados();
    });
    expect(pegarPedidosCancelados()).toHaveLength(2);

    let chamadaA: Promise<unknown> = Promise.resolve();
    await act(async () => {
      // A começa e fica pendente (RPC ainda não respondeu).
      chamadaA = chamarConfirmarRetorno("pedido-A").catch(() => {});
      // Enquanto A está em voo, B chega e termina com sucesso — o cenário
      // do achado: uma atualização legítima acontecendo DURANTE o await
      // de outra chamada que vai falhar.
      await chamarConfirmarRetorno("pedido-B");
    });

    expect(
      pegarPedidosCancelados().find((o) => o.id === "pedido-B")
        ?.returnedToSellerAt,
    ).toBe("2026-08-26T12:00:00Z");

    await act(async () => {
      rejeitarA(new Error("RPC caiu"));
      await chamadaA;
    });

    // O achado: A falhando (bem depois de B ter terminado) não pode
    // desfazer o que B já tinha conquistado — o rollback de A era um
    // retrato tirado ANTES de B escrever, e restaurá-lo apaga B.
    expect(
      pegarPedidosCancelados().find((o) => o.id === "pedido-B")
        ?.returnedToSellerAt,
    ).toBe("2026-08-26T12:00:00Z");
  });
});

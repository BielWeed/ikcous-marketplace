// @vitest-environment jsdom
//
// Task 9 da Fase 3: fila de atenção no admin. Prova as três garantias do
// brief com uma lista de pedidos EM MEMÓRIA cobrindo `aguardando`, `pago`,
// `pago_apos_expirar`, `estornado` e `payment_status` NULL (os 64 pedidos
// históricos têm NULL nessa coluna — a tela não pode quebrar com eles):
//
//   1. o filtro por payment_status restringe a lista;
//   2. `pago_apos_expirar` e `estornado` recebem destaque visual distinto
//      dos demais;
//   3. pedido com payment_status nulo continua aparecendo e não quebra a
//      renderização.
//
// `filterOrdersByPaymentStatus` é testada isolada (função pura exportada
// por AdminOrdersView.tsx) em vez de montar a tela inteira: a view arrasta
// useAuth, useOrders (RPC paginada + canal realtime), useAnalytics etc., e
// nada disso é o que esta tarefa muda — só o filtro e o badge.
// `@/lib/supabase` é mocado porque AdminOrdersView.tsx importa `supabase`
// no topo do arquivo (usado no fetch de pedido avulso por deep link); sem
// o mock, IMPORTAR o módulo (mesmo sem renderizar a view) já dispara a
// leitura de VITE_SUPABASE_URL/ANON_KEY em src/lib/env.ts, que explode por
// design quando ausente.
import type { Order, PaymentStatus } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// Mocados só para o describe "Estado vazio da lista" (Item 1) montar a view
// inteira sem arrastar RPC paginada, canal realtime ou DataVault/IndexedDB
// do useAnalytics — nenhum desses é o que este achado muda, só a decisão
// entre os dois textos de estado vazio. `mockOrders`/`mockTotalOrders` são
// `let` porque cada teste controla a página carregada.
let mockOrders: Order[] = [];
let mockTotalOrders = 0;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    totalOrders: mockTotalOrders,
    isLoaded: true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto (ver
// tests/front/pagamento-online.test.tsx): sem ela o React reclama "not
// configured to support act(...)" em todo render, mesmo dentro de act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface PedidoMinimo {
  id: string;
  paymentStatus: PaymentStatus | null;
}

const PEDIDOS_EM_MEMORIA: readonly PedidoMinimo[] = [
  { id: "ped-aguardando", paymentStatus: "aguardando" },
  { id: "ped-pago", paymentStatus: "pago" },
  { id: "ped-pago-apos-expirar", paymentStatus: "pago_apos_expirar" },
  { id: "ped-estornado", paymentStatus: "estornado" },
  { id: "ped-sem-cobranca", paymentStatus: null },
];

describe("filterOrdersByPaymentStatus", () => {
  it("com 'all' devolve a lista inteira, na mesma ordem", async () => {
    const { filterOrdersByPaymentStatus } = await import(
      "@/views/admin/AdminOrdersView"
    );

    const resultado = filterOrdersByPaymentStatus(PEDIDOS_EM_MEMORIA, "all");

    expect(resultado.map((p) => p.id)).toEqual(
      PEDIDOS_EM_MEMORIA.map((p) => p.id),
    );
  });

  it("restringe a lista a um único payment_status", async () => {
    const { filterOrdersByPaymentStatus } = await import(
      "@/views/admin/AdminOrdersView"
    );

    expect(
      filterOrdersByPaymentStatus(PEDIDOS_EM_MEMORIA, "pago_apos_expirar").map(
        (p) => p.id,
      ),
    ).toEqual(["ped-pago-apos-expirar"]);

    expect(
      filterOrdersByPaymentStatus(PEDIDOS_EM_MEMORIA, "estornado").map(
        (p) => p.id,
      ),
    ).toEqual(["ped-estornado"]);
  });

  it("payment_status nulo só aparece no filtro 'sem_cobranca', e continua na lista com 'all'", async () => {
    const { filterOrdersByPaymentStatus } = await import(
      "@/views/admin/AdminOrdersView"
    );

    const semCobranca = filterOrdersByPaymentStatus(
      PEDIDOS_EM_MEMORIA,
      "sem_cobranca",
    );
    expect(semCobranca.map((p) => p.id)).toEqual(["ped-sem-cobranca"]);

    const todos = filterOrdersByPaymentStatus(PEDIDOS_EM_MEMORIA, "all");
    expect(todos.some((p) => p.id === "ped-sem-cobranca")).toBe(true);
  });
});

describe("PaymentStatusBadge", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("dá destaque visual (anel de atenção) a estornado e pago_apos_expirar, mas não a pago", async () => {
    const { PaymentStatusBadge } = await import(
      "@/components/admin/orders/OrderStatusBadge"
    );

    await act(async () => {
      raiz.render(<PaymentStatusBadge paymentStatus="pago" />);
    });
    expect(hospedeiro.querySelector("div")?.className).not.toContain(
      "ring-red-500",
    );

    await act(async () => {
      raiz.render(<PaymentStatusBadge paymentStatus="estornado" />);
    });
    expect(hospedeiro.querySelector("div")?.className).toContain(
      "ring-red-500",
    );
    expect(hospedeiro.textContent).toContain("Estornado");

    await act(async () => {
      raiz.render(<PaymentStatusBadge paymentStatus="pago_apos_expirar" />);
    });
    expect(hospedeiro.querySelector("div")?.className).toContain(
      "ring-red-500",
    );
    expect(hospedeiro.textContent).toContain("Pago fora do prazo");
  });

  it("payment_status nulo não quebra a renderização e mostra 'Sem cobrança online'", async () => {
    const { PaymentStatusBadge } = await import(
      "@/components/admin/orders/OrderStatusBadge"
    );

    expect(() => {
      act(() => {
        raiz.render(<PaymentStatusBadge paymentStatus={null} />);
      });
    }).not.toThrow();

    expect(hospedeiro.textContent).toContain("Sem cobrança online");
  });
});

// Item 1 (achado BLOQUEANTE da revisão): o filtro de payment_status é
// client-side sobre a página já carregada (12 pedidos), não sobre os 64+
// pedidos do banco. "Nenhum pedido da página bate com o filtro" não é
// "não existe nenhum pedido" — a tela tinha as duas coisas com o MESMO
// texto ("Ainda não tem nenhum pedido"), que é falso no primeiro caso.
function pedidoFake(id: string, paymentStatus: PaymentStatus | null): Order {
  return {
    id,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("AdminOrdersView — estado vazio da lista (Item 1 da revisão)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // jsdom deste ambiente não traz localStorage utilizável (--localstorage-file
    // sem caminho válido) — mesmo dublê em Map usado em
    // checkout-view-flag-on.test.tsx, já que useLocalStorage lê window.localStorage
    // de verdade no initializer.
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
    mockTotalOrders = 0;
  });

  it("nenhum pedido da PÁGINA bate com o filtro: mostra o aviso de filtro, não 'Ainda não tem nenhum pedido'", async () => {
    window.localStorage.setItem(
      "admin_orders_payment_filter",
      JSON.stringify("estornado"),
    );
    mockOrders = Array.from({ length: 12 }, (_, i) =>
      pedidoFake(`ped-${i}`, "pago"),
    );
    mockTotalOrders = 64;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    expect(hospedeiro.textContent).toContain(
      "Nenhum pedido desta página tem este status de pagamento",
    );
    expect(hospedeiro.textContent).not.toContain("Ainda não tem nenhum pedido");
  });

  it("lista vazia de verdade, SEM filtro ativo: mostra 'Ainda não tem nenhum pedido'", async () => {
    mockOrders = [];
    mockTotalOrders = 0;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    expect(hospedeiro.textContent).toContain("Ainda não tem nenhum pedido");
    expect(hospedeiro.textContent).not.toContain(
      "Nenhum pedido desta página tem este status de pagamento",
    );
  });
});

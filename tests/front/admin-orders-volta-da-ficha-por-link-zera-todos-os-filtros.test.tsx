// @vitest-environment jsdom
//
// Ficha aberta por LINK (aviso no celular, sino), com o pedido fora da lista
// da última visita: o Voltar cai na lista LIMPA — Todos, sem busca, sem
// período, pagamento e canal em "todos", página 1, rolagem no topo
// (AdminOrdersView, efeito de `fichaAbertaPorLinkRef`).
//
// Buraco achado por mutação (lote 591, 28/11/2026): o vizinho
// `admin-orders-rotina-de-despacho-na-bf` só prova status e busca. Não zerar
// pagamento, canal, período, página ou rolagem não derrubava teste algum —
// a página nem servia de prova ali: a lista falsa tinha um pedido só e a
// correção automática de "página além do fim" zerava sozinha. Aqui o total é
// de 60 pedidos (5 páginas), então a página 4 salva é legítima e só a volta
// da ficha a zera.
//
// Casco de mocks: admin-orders-rotina-de-despacho-na-bf.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ErroPedidoMudou: real.ErroPedidoMudou,
    mensagemAmigavelErroAtualizacaoStatus:
      real.mensagemAmigavelErroAtualizacaoStatus,
    useOrders: () => ({
      orders: [pedidoDaLista],
      loadOrders: vi.fn(),
      updateOrderStatus: vi.fn(),
      // 5 páginas de 12: a página 4 (índice 3) salva existe de verdade.
      totalOrders: 60,
      isLoaded: true,
      loading: false,
    }),
  };
});
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => buscaAvulsa()),
    rpc: vi.fn(),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const ID_DO_LINK = "pedido-fic-do-aviso";

const pedidoDaLista: Order = {
  id: "pedido-fic-da-lista",
  customer: { name: "Cliente Fictícia", whatsapp: "11988887777" },
  items: [],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  paymentStatus: "pago",
  status: "shipping",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

/** Linha crua da busca avulsa da ficha aberta por link (pedido fora da lista). */
function buscaAvulsa() {
  const linha = {
    id: ID_DO_LINK,
    status: "processing",
    payment_status: "pago",
    payment_method: "pix",
    total: 120,
    subtotal: 100,
    shipping: 20,
    discount: 0,
    customer_name: "Cliente Fictícia",
    customer_data: { whatsapp: "11988887777" },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    items: [],
    address: null,
  };
  const builder = {
    abortSignal: () => builder,
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => Promise.resolve({ data: linha, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return builder;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminOrdersView — volta da ficha aberta por link zera a lista inteira", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let rolagem: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ObservadorStub);
    vi.stubGlobal("IntersectionObserver", ObservadorStub);
    // O contêiner que rola no painel (o da aba ativa, como em AdminArea): a
    // tela guarda e devolve a rolagem dele. Com a ficha na tela a lista sai
    // do DOM, e quem a acha é a classe da aba ativa.
    rolagem = document.createElement("div");
    rolagem.className = "admin-scroll-container active-scroll-container";
    rolagem.scrollTo = ((opcoes: ScrollToOptions) => {
      rolagem.scrollTop = opcoes.top ?? 0;
    }) as typeof rolagem.scrollTo;
    hospedeiro = document.createElement("div");
    rolagem.appendChild(hospedeiro);
    document.body.appendChild(rolagem);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    rolagem.remove();
    vi.unstubAllGlobals();
  });

  async function renderizar(active: boolean, selectedOrderId?: string) {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={active}
          selectedOrderId={selectedOrderId}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  const proximoQuadro = () =>
    act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  const salvo = (chave: string) => armazem.get(chave);

  it("período de 7 dias, pagamento, canal, página 4 e rolagem: o Voltar zera os cinco", async () => {
    armazem.set("admin_orders_filter_v2", JSON.stringify("shipping"));
    armazem.set("admin_orders_search_query", JSON.stringify("fulana"));
    armazem.set(
      "admin_orders_date_range",
      JSON.stringify({ start: "2026-11-21", end: "2026-11-27" }),
    );
    armazem.set("admin_orders_payment_filter", JSON.stringify("pago"));
    armazem.set("admin_orders_canal_filter", JSON.stringify("presencial"));
    armazem.set("admin_orders_current_page", JSON.stringify(3));

    // A lojista rolou a lista e saiu da tela: a rolagem fica guardada.
    await renderizar(true);
    rolagem.scrollTop = 800;
    await renderizar(false);

    // O aviso abre a ficha de um pedido que não está na lista.
    await renderizar(true, ID_DO_LINK);
    // Controle: até aqui nada foi zerado (a ficha não mexe na lista).
    expect(salvo("admin_orders_current_page")).toBe(JSON.stringify(3));
    expect(salvo("admin_orders_payment_filter")).toBe(JSON.stringify("pago"));

    // Voltar.
    await renderizar(true);
    await proximoQuadro();

    expect(salvo("admin_orders_filter_v2")).toBe(JSON.stringify("all"));
    expect(salvo("admin_orders_search_query")).toBe(JSON.stringify(""));
    expect(salvo("admin_orders_payment_filter")).toBe(JSON.stringify("all"));
    expect(salvo("admin_orders_canal_filter")).toBe(JSON.stringify("all"));
    expect(salvo("admin_orders_date_range")).toBe(
      JSON.stringify({ start: "", end: "" }),
    );
    expect(salvo("admin_orders_current_page")).toBe(JSON.stringify(0));
    expect(rolagem.scrollTop).toBe(0);
  });

  it("controle: sem passar pela ficha, a lista guarda página e rolagem da última visita", async () => {
    armazem.set("admin_orders_payment_filter", JSON.stringify("pago"));
    armazem.set("admin_orders_current_page", JSON.stringify(3));

    await renderizar(true);
    rolagem.scrollTop = 800;
    await renderizar(false);
    rolagem.scrollTop = 0;
    await renderizar(true);
    await proximoQuadro();

    expect(salvo("admin_orders_current_page")).toBe(JSON.stringify(3));
    expect(salvo("admin_orders_payment_filter")).toBe(JSON.stringify("pago"));
    expect(rolagem.scrollTop).toBe(800);
  });
});

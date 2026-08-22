// @vitest-environment jsdom
//
// O CHECK do banco (marketplace_orders_status_check, baseline em
// 20260806000000, linha ~3981) aceita SEIS status: 'pending', 'processing',
// 'shipping', 'delivered', 'cancelled', 'new'. O type `OrderStatus`
// (src/types/index.ts) só conhece CINCO — falta 'new'.
//
// A migration 20260327000003_sync_order_status_constraint.sql migrou os
// pedidos 'new' para 'pending' (linhas 20-24) e manteve 'new' no CHECK
// (linha 16) só por compatibilidade histórica: hoje há 0 pedidos nesse
// estado, mas o banco continua aceitando o valor.
//
// Dois pontos indexam `statusConfig[order.status]` sem guarda e quebram se
// um pedido com esse status chegar à tela:
//
//   - OrderDetailsView.tsx:374 — `.icon` na linha seguinte quebra a ficha
//     do pedido para o cliente (tela branca).
//   - AdminOrdersView.tsx:641 — `.label` na mensagem de WhatsApp quebra o
//     botão de contato da lojista.
//
// Este teste renderiza os DOIS consumidores de verdade (não só a função),
// porque testar a função prova que ela sabe fazer, não que a tela sobrevive.
//
// Mesmo padrão de mock de order-details-codigo-de-rastreio.test.tsx (para o
// consumidor do cliente) e admin-orders-filtro-que-filtra.test.tsx (para o
// consumidor do admin) — `vi.mock` fica no topo do arquivo, não dentro de um
// `describe`, porque o hoisting do Vitest junta todo `vi.mock` do MESMO
// caminho num só; dois mocks diferentes do mesmo módulo em describes
// separados fariam o último sobrescrever o primeiro nos dois.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pedidoBase: Order = {
  id: "pedido-status-desconhecido",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  status: "shipping",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

/** Lista compartilhada pelos dois `useOrders` mocados abaixo — cada teste
 * escreve nela antes de renderizar. */
let mockOrders: Order[] = [pedidoBase];

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    fetchUserOrders: vi.fn().mockResolvedValue(mockOrders),
    updateOrderStatus: vi.fn(),
    loadOrders: vi.fn(),
    totalOrders: mockOrders.length,
    isLoaded: true,
    loading: false,
  }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("OrderDetailsView — status desconhecido não fica com tela branca", () => {
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
    mockOrders = [pedidoBase];
  });

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-status-desconhecido"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("pedido com status 'new' (fora do type) renderiza a ficha e mostra o rótulo de pending, não fica em branco", async () => {
    // O valor 'new' só existe no banco, nunca no type — força o mesmo jeito
    // que o dado real chega quando escapa da guarda.
    mockOrders = [
      {
        ...pedidoBase,
        status: "new" as unknown as Order["status"],
      },
    ];

    await renderizar();

    const texto = hospedeiro.textContent ?? "";
    // A âncora: a tela renderizou de verdade (senão o resto é vazio por
    // acaso, não por prova).
    expect(texto).toContain("Blusa Teste");
    // Rótulo de pending neste arquivo (statusConfig.pending.label).
    expect(texto).toContain("Pedido Recebido");
  });

  it("controle: status conhecido (shipping) continua mostrando o rótulo dele, não o de pending", async () => {
    mockOrders = [{ ...pedidoBase, status: "shipping" }];

    await renderizar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Blusa Teste");
    expect(texto).toContain("Em Trânsito");
    expect(texto).not.toContain("Pedido Recebido");
  });
});

describe("AdminOrdersView — botão de WhatsApp não quebra com status desconhecido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let janelaAberta: string[] = [];

  beforeEach(() => {
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
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    janelaAberta = [];
    vi.stubGlobal("open", (url: string) => {
      janelaAberta.push(url);
      return null;
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
    mockOrders = [pedidoBase];
  });

  function botaoWhatsApp() {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "WhatsApp",
    );
  }

  function mensagemEnviada() {
    const url = janelaAberta.at(-1);
    expect(url).toBeTruthy();
    const parametros = new URL(url!);
    const texto = parametros.searchParams.get("text");
    expect(texto).not.toBeNull();
    return texto as string;
  }

  it("pedido com status 'new' (fora do type): clicar em WhatsApp não quebra a tela, e a mensagem NÃO leva a string crua 'new'", async () => {
    mockOrders = [
      { ...pedidoBase, status: "new" as unknown as Order["status"] },
    ];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    const botao = botaoWhatsApp();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const mensagem = mensagemEnviada();
    // A metade que impede o conserto de virar o outro defeito: nada de
    // valor técnico cru na mensagem que a lojista manda para a cliente.
    expect(mensagem).not.toContain("new");
    expect(mensagem).toContain("Novo Pedido");
  });

  it("controle: status conhecido (shipping) continua com o rótulo dele na mensagem", async () => {
    mockOrders = [{ ...pedidoBase, status: "shipping" }];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    const botao = botaoWhatsApp();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const mensagem = mensagemEnviada();
    expect(mensagem).toContain("Em Trânsito");
  });
});

// @vitest-environment jsdom
//
// Defeito: a tela do CLIENTE já avisa quando um pedido pago é cancelado
// ("Pago — fale com a loja", ver CustomerPaymentBadge.tsx). O painel do
// LOJISTA não tinha o outro lado disso — `PaymentStatusBadge` chaveava só
// por `payment_status`, então um pedido `pago` + `cancelled` aparecia como
// "Pago" verde comum, sem nada que fizesse a lojista olhar. O dinheiro está
// com a loja, o estoque já voltou à prateleira, e não existe estorno
// automático em lugar nenhum deste app.
//
// O caso vizinho (`pago_apos_expirar`) já tinha o alerta — é o contraste que
// prova o buraco: o caminho aberto era o oposto, pagou e DEPOIS cancelou,
// produzível hoje pelo botão "Cancelar Pedido" da tela do cliente.
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mesmo padrão de admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx:
// `@/lib/supabase` mocado porque AdminOrdersView.tsx (e OrderDetail.tsx, que
// tem o próprio suíte de referência abaixo) importam `supabase` no topo —
// sem o mock, só IMPORTAR o módulo já dispara leitura de env var ausente
// neste ambiente.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// A-3 (laudo varredura 01/09): AdminOrdersView passou a ler o nome da loja
// (config.storeName) para o recibo impresso — mock mínimo do contexto, mesmo
// padrão de admin-coupons-view-expirado.test.tsx. Sem ele o useStore lança
// 'must be used within a StoreProvider' em toda montagem da view.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

// Mesmo mock de tests/front/order-detail-aviso-pagamento-pendente.test.tsx:
// o Radix real de `AlertDialog` depende de PointerEvent/ResizeObserver que o
// jsdom deste projeto não implementa.
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

let mockOrders: Order[] = [];

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    totalOrders: mockOrders.length,
    isLoaded: true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: null,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// embla-carousel-react (usado pelo AdminKpiCarousel) usa ResizeObserver e
// IntersectionObserver internamente — ausentes no jsdom deste projeto. Mesmo
// padrão de admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx.
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

const pedidoBase: Order = {
  id: "pedido-pago-cancelado",
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
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

describe("PaymentStatusBadge (componente) — aviso do lojista quando o pedido pago é cancelado", () => {
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

  async function renderizar(
    paymentStatus: Order["paymentStatus"],
    orderStatus?: Order["status"],
  ) {
    const { PaymentStatusBadge } = await import(
      "@/components/admin/orders/OrderStatusBadge"
    );
    await act(async () => {
      raiz.render(
        <PaymentStatusBadge
          paymentStatus={paymentStatus}
          orderStatus={orderStatus}
        />,
      );
    });
  }

  it("pago + cancelled: mostra o rótulo de atenção do LOJISTA e tem o anel de needsAttention (não o 'Pago' simples)", async () => {
    await renderizar("pago", "cancelled");

    expect(hospedeiro.textContent).toContain(
      "Pago e cancelado — precisa de atenção",
    );
    // Guarda contra o caso vira 'Pago' puro por acidente: aqui o texto
    // INTEIRO do selo tem que ser o rótulo de atenção, nunca só "Pago".
    expect(hospedeiro.textContent).not.toBe("Pago");

    const selo = hospedeiro.querySelector("div");
    expect(selo).not.toBeNull();
    expect(selo?.className).toContain("animate-pulse");
    expect(selo?.className).toContain("ring-red-500/60");
  });

  it("CONTROLE — pago + delivered (venda saudável): continua 'Pago' verde, sem anel", async () => {
    await renderizar("pago", "delivered");

    expect(hospedeiro.textContent).toBe("Pago");
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");

    const selo = hospedeiro.querySelector("div");
    expect(selo).not.toBeNull();
    expect(selo?.className).not.toContain("animate-pulse");
  });

  it("CONTROLE — pago sem orderStatus (comportamento de hoje, para quem não passar a prop): continua 'Pago' verde, sem anel", async () => {
    await renderizar("pago");

    expect(hospedeiro.textContent).toBe("Pago");
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");

    const selo = hospedeiro.querySelector("div");
    expect(selo).not.toBeNull();
    expect(selo?.className).not.toContain("animate-pulse");
  });

  it("REGRESSÃO — pago_apos_expirar continua com o próprio rótulo ('Pago fora do fluxo'), sem virar o novo texto", async () => {
    await renderizar("pago_apos_expirar", "cancelled");

    expect(hospedeiro.textContent).toContain(
      "Pago fora do fluxo — precisa de atenção",
    );
    expect(hospedeiro.textContent).not.toContain(
      "Pago e cancelado — precisa de atenção",
    );

    const selo = hospedeiro.querySelector("div");
    expect(selo).not.toBeNull();
    expect(selo?.className).toContain("animate-pulse");
  });

  // Task 3b do plano docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md
  // (ponto 3): antes desta correção, `recebido_na_entrega` + `cancelled`
  // caía no `getPaymentStatusConfig` comum e mostrava o selo verde parado
  // "Recebido na entrega" — o mesmo defeito que este arquivo já cobre para
  // `pago`, só que sem o anel de atenção nenhum.
  it("recebido_na_entrega + cancelled: mostra o MESMO rótulo de atenção do LOJISTA que 'pago' + cancelled", async () => {
    await renderizar("recebido_na_entrega", "cancelled");

    expect(hospedeiro.textContent).toContain(
      "Pago e cancelado — precisa de atenção",
    );
    expect(hospedeiro.textContent).not.toBe("Recebido na entrega");

    const selo = hospedeiro.querySelector("div");
    expect(selo).not.toBeNull();
    expect(selo?.className).toContain("animate-pulse");
    expect(selo?.className).toContain("ring-red-500/60");
  });

  it("CONTROLE — recebido_na_entrega + delivered (venda saudável): continua 'Recebido na entrega' verde, sem anel", async () => {
    await renderizar("recebido_na_entrega", "delivered");

    expect(hospedeiro.textContent).toBe("Recebido na entrega");
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");

    const selo = hospedeiro.querySelector("div");
    expect(selo).not.toBeNull();
    expect(selo?.className).not.toContain("animate-pulse");
  });
});

// `describe.each` sobre os dois modos de visualização — achado do revisor:
// `AdminOrderCard` (AdminOrdersView.tsx:1375+) tem um `if (viewMode ===
// "detailed") { …return… }` e o compacto só começa depois; um teste com
// `localStorage` vazio cai sempre em "compact" (o padrão real,
// AdminOrdersView.tsx:202-204) e NUNCA renderiza o card "detailed" — apagar
// `orderStatus` só do card detalhado (~1435) passava batido. Mesma técnica
// de admin-products-esgotado.test.tsx:189-222, com a chave DESTE arquivo
// (`admin_orders_view_mode`, não `admin_products_view_mode`).
describe.each(["compact", "detailed"] as const)(
  "AdminOrdersView (%s) — a lista de pedidos do lojista mostra o aviso (a prop chega de verdade ao consumidor)",
  (viewMode) => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;

    beforeEach(() => {
      // Um Map de verdade, pré-carregado com o viewMode do describe.each
      // atual — só pré-carrega a chave quando o cenário é "detailed", porque
      // a visualização padrão real (sem nada salvo) já é "compact".
      const armazem = new Map<string, string>(
        viewMode === "detailed" ? [["admin_orders_view_mode", "detailed"]] : [],
      );
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
    });

    it("pedido pago+cancelled na lista: o card mostra o aviso de atenção do lojista (prova que AdminOrdersView passa orderStatus, não só que o componente saberia usar)", async () => {
      mockOrders = [
        { ...pedidoBase, status: "cancelled", paymentStatus: "pago" },
      ];

      const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

      await act(async () => {
        raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
      });

      // Redesenho do card compacto (02/09): na LISTA, o badge usa o
      // rótulo CURTO ("Pago e cancelado") porque o longo estourava a
      // coluna e o corte CSS virava "PAGÃO ... PRECIS..." — a frase
      // completa mora no `title` do badge. No modo detailed (folgado), o
      // rótulo longo de sempre continua; e na FICHA do pedido os testes
      // do bloco de baixo continuam provando o rótulo longo.
      expect(hospedeiro.textContent).toContain("Pago e cancelado");
      if (viewMode === "compact") {
        expect(hospedeiro.textContent).not.toContain("— precisa de atenção");
      } else {
        expect(hospedeiro.textContent).toContain(
          "Pago e cancelado — precisa de atenção",
        );
      }
    });
  },
);

describe("OrderDetail (ficha do pedido no painel) — mostra o aviso nos DOIS pontos onde usa o badge", () => {
  // A ficha é a tela onde a lojista abre o pedido para AGIR (o card da
  // lista só chama a atenção) — e ela usa `PaymentStatusBadge` duas vezes:
  // no cabeçalho (`OrderHeader`, ~linha 174) e no card "Consolidado
  // Financeiro" (`OrderFinanceCard`, ~linha 582). Um teste que olhasse só
  // `textContent.toContain(...)` passaria com UM dos dois funcionando.
  //
  // Achado da revisão: uma primeira versão deste teste contava OCORRÊNCIAS
  // do rótulo (técnica de `order-detail-aviso-pagamento-pendente.test.tsx`
  // para "Aguardando pagamento") — funcionava, mas sabotar QUALQUER um dos
  // dois pontos derrubava o MESMO teste (`ocorrencias` caindo de 3 para 2
  // nos dois casos), sem dizer qual dos dois quebrou. Trocado por duas
  // asserções SEPARADAS, cada uma escopada ao pedaço de texto de um só
  // ponto: `OrderHeader` (linha 1127) renderiza ANTES de `OrderFinanceCard`
  // (linha 1173) — confirmado lendo `OrderDetail.tsx` — então cortar o
  // `textContent` no índice de "Consolidado Financeiro" separa "tudo antes"
  // (cabeçalho) de "tudo a partir daqui" (Consolidado Financeiro, cujo
  // título abre o corte). Cada sabotagem agora derruba só a sua metade.
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  function pedidoOrderDetailFake(
    paymentStatus: Order["paymentStatus"],
    status: Order["status"],
  ): Order {
    return {
      id: "ped-pago-cancelado",
      customer: {
        name: "Cliente Teste",
        whatsapp: "34999999999",
        address: "Rua das Flores",
        number: "123",
        neighborhood: "Centro",
        city: "Patos de Minas",
        state: "MG",
      },
      items: [],
      subtotal: 100,
      shipping: 0,
      discount: 0,
      total: 100,
      paymentMethod: "pix",
      paymentStatus,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cancelledAfterShipping: false,
    };
  }

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
    vi.restoreAllMocks();
  });

  /**
   * Corta `hospedeiro.textContent` em duas metades no índice de "Consolidado
   * Financeiro": tudo antes é o CABEÇALHO (e o que vem entre ele e o card
   * financeiro); tudo a partir dali é o card financeiro. A asserção de
   * sanidade (`idx > -1`) garante que o corte é real — sem ela, um
   * `indexOf` que não achasse nada (-1) faria `slice(0, -1)` devolver quase
   * o texto inteiro e a "metade do cabeçalho" incluiria o financeiro por
   * engano, escondendo a falta do badge lá.
   */
  function metadesDaFicha(host: HTMLElement): {
    cabecalho: string;
    consolidadoFinanceiro: string;
  } {
    const texto = host.textContent ?? "";
    const idx = texto.indexOf("Consolidado Financeiro");
    expect(idx).toBeGreaterThan(-1);
    return {
      cabecalho: texto.slice(0, idx),
      consolidadoFinanceiro: texto.slice(idx),
    };
  }

  it("pago + cancelled: o CABEÇALHO mostra 'Pago e cancelado — precisa de atenção'", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoOrderDetailFake("pago", "cancelled");

    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });

    const { cabecalho } = metadesDaFicha(hospedeiro);
    expect(cabecalho).toContain("Pago e cancelado — precisa de atenção");
  });

  it("pago + cancelled: o Consolidado Financeiro mostra 'Pago e cancelado — precisa de atenção'", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoOrderDetailFake("pago", "cancelled");

    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });

    const { consolidadoFinanceiro } = metadesDaFicha(hospedeiro);
    expect(consolidadoFinanceiro).toContain(
      "Pago e cancelado — precisa de atenção",
    );
  });

  it("CONTROLE — pago + delivered na ficha: continua 'Pago' simples, sem o aviso em nenhum dos dois pontos", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoOrderDetailFake("pago", "delivered");

    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });

    expect(hospedeiro.textContent).not.toContain("precisa de atenção");
  });
});

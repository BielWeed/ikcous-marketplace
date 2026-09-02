// @vitest-environment jsdom
//
// Histórico do desenho desta área (tudo por pedido do Gabriel):
//   02/09 de manhã: os três blocos gigantes (dinheiro preso, mercadoria a
//     voltar, estorno devido) viraram uma PÍLULA colapsável full-width.
//   02/09 à tarde: a pílula ainda ocupava uma faixa inteira da tela — o
//     Gabriel pediu o passo seguinte: um BOTÃO redondo com o ícone de alerta,
//     no canto direito da linha do título "Pedidos" (onde nada mais vive —
//     o ponto de conexão mudou para junto do título), e os detalhes num
//     DROPDOWN que desce do botão. Conteúdo, textos e handlers dos blocos:
//     palavra por palavra os mesmos; o que mudou é ONDE moram.
//
// Contrato provado aqui:
//   1. Com pendência (ou lista incompleta), o botão nasce no header com o
//      badge de contagem e a frase-resumo no aria-label/title. Sem pendência
//      nenhuma E lista completa, o botão nem nasce (regra antiga mantida).
//   2. O clique expande o dropdown com os blocos detalhados; o 2º clique, um
//      clique fora e a tecla Escape colapsam de volta.
//   3. "Ver pedidos" grava os filtros, rola até a lista (provado no teste
//      irmão admin-orders-total-concluido-e-aviso-pago-cancelado) e AGORA
//      fecha o dropdown — sem isso ele ficaria aberto cobrindo a lista para
//      onde a página acabou de rolar.
//
// Segue o mesmo padrão de mocks de
// admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx (supabase,
// StoreContext, useAnalytics); `useOrders` aqui é mocado COM os campos dos
// baldes (`pedidosCancelados`/`fetchPedidosCancelados`) porque este teste
// exercita exatamente os baldes que o teste irmão deixa vazios.
import type { Order } from "@/types";
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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

let mockOrders: Order[] = [];
let mockTotalOrders = 0;

// `let` porque cada teste controla o que a consulta de cancelados devolve.
let mockPedidosCancelados: Order[] = [];

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    totalOrders: mockTotalOrders,
    isLoaded: true,
    loading: false,
    pedidosCancelados: mockPedidosCancelados,
    fetchPedidosCancelados: vi.fn(async () => mockPedidosCancelados),
    pedidosCanceladosIncompleto: mockPedidosCanceladosIncompleto,
  }),
}));

let mockAnalyticsStats: any = null;
// R3 da revisão do PR #400: o aviso de lista incompleta é caminho próprio —
// ganha variável de controle aqui.
let mockPedidosCanceladosIncompleto = false;

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: mockAnalyticsStats,
    fetchExecutiveSummary: vi.fn(),
  }),
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

function statsFake(paidOnCancelled?: number) {
  return {
    today: {
      revenue: 0,
      count: 0,
      pending: 0,
      revenueTrend: 0,
      countTrend: 0,
    },
    month: { revenue: 0, count: 6, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue: 0,
      totalOrders: 0,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket: 0,
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
    },
    revenueHistory: [],
    topProducts: [],
    inventoryAlerts: 0,
    deliveredTotal: 3,
    paidOnCancelled,
  };
}

/** Pedido cancelado com só os campos que esta tela lê (os baldes derivam de
 * `status`, `paymentStatus`, `cancelledAfterShipping`, `returnedToSellerAt`;
 * os cartões mostram `id`/`customer`/`total`). Objeto parcial com cast —
 * `Order` completo não é necessário para o que este teste exercita. */
function canceladoFake(campos: {
  id: string;
  paymentStatus?: Order["paymentStatus"];
  cancelledAfterShipping?: boolean;
  returnedToSellerAt?: string | null;
}): Order {
  return {
    id: campos.id,
    status: "cancelled",
    paymentStatus: campos.paymentStatus ?? null,
    cancelledAfterShipping: campos.cancelledAfterShipping ?? false,
    returnedToSellerAt: campos.returnedToSellerAt ?? null,
    customer: { name: "Gabriel" },
    total: 1,
  } as unknown as Order;
}

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

/** O botão compacto de alerta — o contrato é o `data-testid` (o conteúdo do
 * dropdown é o que muda de tela para tela; o estado vive no `aria-expanded`). */
const botaoAlerta = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    'button[data-testid="alertas-cancelados-alavanca"]',
  );

async function expandir() {
  expect(botaoAlerta()).toBeTruthy();
  await act(async () => {
    botaoAlerta()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

let hospedeiro: HTMLDivElement;
let raiz: Root;

describe("AdminOrdersView — botão de alerta no header com dropdown de detalhes", () => {
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
    // R2 da revisão do PR #400: o stub de scrollIntoView (teste do "Ver
    // pedidos") é feito no protótipo e vaza para os testes seguintes do
    // arquivo — restaurar a ausência original aqui (atribuição de
    // `undefined`, não `delete`: regra noDelete do Biome que o CI cobra).
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView =
      undefined;
    mockOrders = [];
    mockTotalOrders = 0;
    mockPedidosCancelados = [];
    mockPedidosCanceladosIncompleto = false;
    mockAnalyticsStats = null;
  });

  it("com dinheiro preso: botão com badge de contagem e a frase no aria-label, sem bloco nenhum na tela", async () => {
    mockAnalyticsStats = statsFake(2);

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    // O botão existe, nasce FECHADO e descreve o alerta sem abrir nada:
    // a contagem fica no badge e a frase (singular/plural já provados no
    // teste irmão) no aria-label — o leitor de tela lê o botão inteiro.
    expect(botaoAlerta()).toBeTruthy();
    expect(botaoAlerta()!.getAttribute("aria-expanded")).toBe("false");
    expect(botaoAlerta()!.getAttribute("aria-label")).toContain(
      "2 pedidos receberam pagamento e estão cancelados",
    );
    expect(
      hospedeiro.querySelector('[data-testid="alertas-cancelados-badge"]')
        ?.textContent,
    ).toBe("2");
    // E o conteúdo detalhado NÃO está na tela: os textos longos dos blocos
    // só existem com o dropdown expandido.
    expect(hospedeiro.textContent).not.toContain(
      "O dinheiro entrou e o pedido está cancelado",
    );
    expect(hospedeiro.textContent).not.toContain(
      "esta tela não devolve dinheiro nenhum",
    );
  });

  it("clique no botão expande o dropdown; segundo clique colapsa de volta", async () => {
    mockAnalyticsStats = statsFake(1);

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await expandir();

    // Expandido: os textos longos e o botão de destino voltam a existir —
    // o conteúdo é o mesmo dos blocos antigos (nenhuma palavra honesta se
    // perdeu, só o lugar: agora desce do botão do header).
    expect(hospedeiro.textContent).toContain(
      "O dinheiro entrou e o pedido está cancelado",
    );
    expect(botaoAlerta()!.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      botaoAlerta()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(hospedeiro.textContent).not.toContain(
      "O dinheiro entrou e o pedido está cancelado",
    );
    expect(botaoAlerta()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("clique FORA do botão e tecla Escape também fecham o dropdown", async () => {
    mockAnalyticsStats = statsFake(1);

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await expandir();
    expect(hospedeiro.textContent).toContain(
      "O dinheiro entrou e o pedido está cancelado",
    );

    // Clique fora (o listener é `pointerdown` no document, como num dropdown
    // de verdade): o alvo é um nó FORA da raiz do alerta.
    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(botaoAlerta()!.getAttribute("aria-expanded")).toBe("false");
    expect(hospedeiro.textContent).not.toContain(
      "O dinheiro entrou e o pedido está cancelado",
    );

    // Reabrir e apertar Escape fecha do mesmo jeito.
    await expandir();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(botaoAlerta()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("lista incompleta: o botão nasce MESMO sem pendência e o aviso mora no dropdown (sucessor do R3 da revisão)", async () => {
    // O R3 original exigia o aviso SEMPRE visível no fluxo porque, com as
    // listas podendo estar vazias por erro, escondê-lo era silenciar o único
    // cenário em que importa. O dono mudou o desenho (nada de faixa aberta):
    // o sinal permanente agora é o PRÓPRIO BOTÃO — âmbar no header, visível
    // sem clique nenhum; o texto completo fica a um clique, nunca some.
    mockAnalyticsStats = statsFake(0);
    mockPedidosCanceladosIncompleto = true;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    // Sem pendência não há badge — mas o botão do alerta existe.
    expect(botaoAlerta()).toBeTruthy();
    expect(
      hospedeiro.querySelector('[data-testid="alertas-cancelados-badge"]'),
    ).toBeNull();
    expect(hospedeiro.textContent).not.toContain(
      "Não foi possível confirmar a lista completa de pedidos cancelados",
    );

    await expandir();
    expect(hospedeiro.textContent).toContain(
      "Não foi possível confirmar a lista completa de pedidos cancelados",
    );
  });

  it("sem pendência nenhuma e lista completa: nenhum botão nasce", async () => {
    mockAnalyticsStats = statsFake(0);
    mockPedidosCancelados = [];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(botaoAlerta()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("produto a voltar");
    expect(hospedeiro.textContent).not.toContain("estorno devido");
  });

  it("cancelado que nunca foi pago, com mercadoria fora: badge conta o pedido e o resumo fala de PRODUTO, não de estorno", async () => {
    // Mesmo cenário do achado da revisão de 26/08: pedido fechado "na
    // entrega" (paymentStatus NULL) cancelado depois do envio — o balde de
    // mercadoria aparece, o de dinheiro NÃO.
    mockAnalyticsStats = statsFake(0);
    mockPedidosCancelados = [
      canceladoFake({ id: "abc123", cancelledAfterShipping: true }),
    ];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(botaoAlerta()).toBeTruthy();
    expect(botaoAlerta()!.getAttribute("aria-label")).toContain(
      "produto a voltar (1)",
    );
    expect(botaoAlerta()!.getAttribute("aria-label")).not.toContain(
      "estorno devido",
    );
    expect(
      hospedeiro.querySelector('[data-testid="alertas-cancelados-badge"]')
        ?.textContent,
    ).toBe("1");
  });

  it("cancelado pago sem envio: resumo e badge apontam ESTORNO devido", async () => {
    mockAnalyticsStats = statsFake(0);
    mockPedidosCancelados = [
      canceladoFake({ id: "def456", paymentStatus: "pago" }),
    ];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(botaoAlerta()).toBeTruthy();
    expect(botaoAlerta()!.getAttribute("aria-label")).toContain(
      "estorno devido (1)",
    );
  });

  it("'Ver pedidos' grava os filtros, rola até a lista e FECHA o dropdown", async () => {
    // O jsdom não implementa scrollIntoView; o stub é o próprio contrato do
    // teste: o dropdown expandido chama o scroll na âncora da lista.
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView =
      scrollSpy as unknown as typeof Element.prototype.scrollIntoView;

    mockAnalyticsStats = statsFake(1);
    window.localStorage.setItem(
      "admin_orders_search_query",
      JSON.stringify("maria"),
    );

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await expandir();

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Ver pedidos",
    );
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Comportamento de filtro já provado no teste irmão — reafirmado aqui
    // porque o clique agora mora dentro do dropdown.
    expect(window.localStorage.getItem("admin_orders_filter_v2")).toBe(
      '"cancelled"',
    );
    expect(window.localStorage.getItem("admin_orders_search_query")).toBe('""');
    // A página rola até a lista (resposta visível do clique)…
    await esperarAte(() => scrollSpy.mock.calls.length > 0);
    expect(scrollSpy).toHaveBeenCalled();
    // …e o dropdown fecha: senão ele continuaria aberto cobrindo exatamente
    // a lista para onde a página acabou de rolar.
    expect(botaoAlerta()!.getAttribute("aria-expanded")).toBe("false");
  });
});

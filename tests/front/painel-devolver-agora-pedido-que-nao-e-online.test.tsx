// @vitest-environment jsdom
//
// Achado 6 da rodada 6: pedido cancelado que a loja recebeu na entrega
// (dinheiro, PIX da loja, cartão na maquininha) aparece em "Devolver agora",
// mas a pergunta de "Já estornei" mandava confirmar que o dinheiro foi
// devolvido "no painel do Mercado Pago" — dinheiro que nunca passou por lá.
// A pergunta agora fala da devolução direta ao cliente. Só TEXTO: o registro
// (`registrar_estorno_manual`) é o mesmo de sempre.
//
// Mesmo padrão de mocks de painel-devolver-agora-desconta-estorno-em-curso.test.tsx.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  desligarDialogoDeConfirmacao,
  ligarDialogoDeConfirmacao,
} from "./duble-dialogo-de-confirmacao";

interface RespostaFake {
  data: unknown[] | null;
  error: unknown;
}
let RESPOSTA_ORDER_REFUNDS: RespostaFake = { data: [], error: null };

function criarBuilderOrderRefunds() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
  builder.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve(RESPOSTA_ORDER_REFUNDS).then(
      resolve as never,
      reject as never,
    );
  return builder;
}

const rpcMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((tabela: string) => {
      if (tabela === "order_refunds") return criarBuilderOrderRefunds();
      throw new Error(`tabela inesperada neste teste: ${tabela}`);
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

let mockPedidosCancelados: Order[] = [];

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    confirmarRetornoDoProduto: vi.fn(),
    totalOrders: 0,
    isLoaded: true,
    loading: false,
    pedidosCancelados: mockPedidosCancelados,
    carregandoPedidosCancelados: false,
    fetchPedidosCancelados: vi.fn().mockResolvedValue([]),
    pedidosCanceladosIncompleto: false,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: null,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoCancelado(overrides: Partial<Order> & { id: string }): Order {
  return {
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    status: "cancelled",
    paymentStatus: "pago",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    returnedToSellerAt: null,
    ...overrides,
  } as Order;
}

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
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

describe("'Já estornei' — a pergunta segue a forma de pagamento do pedido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let confirmSpy: ReturnType<typeof vi.fn>;

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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    RESPOSTA_ORDER_REFUNDS = { data: [], error: null };
    rpcMock.mockReset();
    confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    ligarDialogoDeConfirmacao();
  });

  afterEach(() => {
    desligarDialogoDeConfirmacao();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockPedidosCancelados = [];
  });

  async function perguntaDoJaEstornei(pedido: Order): Promise<string> {
    mockPedidosCancelados = [pedido];
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    const alavanca = hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="alertas-cancelados-alavanca"]',
    );
    expect(alavanca).toBeTruthy();
    await act(async () => {
      alavanca!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const seletor = `[data-testid="devolver-agora-item-${pedido.id}"] button`;
    await esperarAte(() => hospedeiro.querySelector(seletor) !== null);
    const botao = hospedeiro.querySelector<HTMLButtonElement>(seletor);
    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await esperarAte(() => confirmSpy.mock.calls.length > 0);
    return String(confirmSpy.mock.calls[0]?.[0] ?? "");
  }

  it.each(["cash", "pix", "card"] as const)(
    "pedido do site pago na entrega (%s) e depois cancelado: a pergunta fala de devolução direta, não do Mercado Pago",
    async (paymentMethod) => {
      const pergunta = await perguntaDoJaEstornei(
        pedidoCancelado({
          id: "ped-entrega",
          paymentMethod,
          paymentStatus: "recebido_na_entrega",
        }),
      );

      expect(pergunta).toContain(
        "Confirma que você JÁ devolveu R$ 100,00 para Cliente Teste (dinheiro, PIX ou maquininha)?",
      );
      expect(pergunta).not.toContain("Mercado Pago");
      expect(pergunta).toContain(
        'Isso marca o pedido como estornado e o remove da lista "Devolver agora".',
      );
    },
  );

  it("com a leitura da devolução do Mercado Pago falhando, pedido que nunca passou por lá também não manda abrir o painel do Mercado Pago", async () => {
    RESPOSTA_ORDER_REFUNDS = { data: null, error: { message: "rede caiu" } };

    const pergunta = await perguntaDoJaEstornei(
      pedidoCancelado({
        id: "ped-entrega-leitura-falha",
        paymentMethod: "cash",
        paymentStatus: "recebido_na_entrega",
      }),
    );

    expect(pergunta).toContain(
      "Confirma que você JÁ devolveu R$ 100,00 para Cliente Teste (dinheiro, PIX ou maquininha)?",
    );
    expect(pergunta).not.toContain("Mercado Pago");
  });

  it("o limite: pedido PAGO ONLINE segue com a pergunta do Mercado Pago", async () => {
    const pergunta = await perguntaDoJaEstornei(
      pedidoCancelado({
        id: "ped-online",
        paymentMethod: "online",
        paymentStatus: "pago",
      }),
    );

    expect(pergunta).toContain(
      "Confirma que você JÁ devolveu R$ 100,00 para Cliente Teste no painel do Mercado Pago?",
    );
    expect(pergunta).not.toContain("maquininha");
  });

  it("o balcão segue com a pergunta do balcão", async () => {
    const pergunta = await perguntaDoJaEstornei(
      pedidoCancelado({
        id: "ped-balcao",
        paymentMethod: "cash",
        paymentStatus: "recebido_na_entrega",
        canal: "presencial",
      }),
    );

    expect(pergunta).toContain(
      "Confirma que você JÁ devolveu R$ 100,00 para Cliente Teste no balcão?",
    );
    expect(pergunta).not.toContain("Mercado Pago");
  });

  async function rotuloDoBotao(pedido: Order): Promise<string> {
    mockPedidosCancelados = [pedido];
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    const alavanca = hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="alertas-cancelados-alavanca"]',
    );
    await act(async () => {
      alavanca!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const seletor = `[data-testid="devolver-agora-item-${pedido.id}"] button`;
    await esperarAte(() => hospedeiro.querySelector(seletor) !== null);
    return hospedeiro.querySelector(seletor)?.textContent?.trim() ?? "";
  }

  it.each(["cash", "pix", "card"] as const)(
    "o BOTÃO de pedido pago na entrega (%s) diz 'Já devolvi ao cliente', não 'Mercado Pago'",
    async (paymentMethod) => {
      const rotulo = await rotuloDoBotao(
        pedidoCancelado({
          id: "ped-botao-entrega",
          paymentMethod,
          paymentStatus: "recebido_na_entrega",
        }),
      );
      expect(rotulo).toBe("Já devolvi ao cliente");
    },
  );

  it("o botão do balcão diz 'Já devolvi ao cliente' e o do pedido PAGO ONLINE segue 'Já estornei no Mercado Pago'", async () => {
    expect(
      await rotuloDoBotao(
        pedidoCancelado({
          id: "ped-botao-balcao",
          paymentMethod: "cash",
          paymentStatus: "recebido_na_entrega",
          canal: "presencial",
        }),
      ),
    ).toBe("Já devolvi ao cliente");
  });

  it("o botão de pedido pago ONLINE segue 'Já estornei no Mercado Pago'", async () => {
    expect(
      await rotuloDoBotao(
        pedidoCancelado({
          id: "ped-botao-online",
          paymentMethod: "online",
          paymentStatus: "pago",
        }),
      ),
    ).toBe("Já estornei no Mercado Pago");
  });
});

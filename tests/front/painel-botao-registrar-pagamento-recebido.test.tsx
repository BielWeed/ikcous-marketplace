// @vitest-environment jsdom
//
// Task 4 do plano
// docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md — o botão no
// cartão do pedido que deixa a loja registrar (e desfazer) que recebeu um
// pagamento na entrega. Consome `registrarPagamentoRecebido(orderId,
// recebido)` e `order.pagamentoRecebidoEm`, produzidos pela Task 3.
//
// Mesmo padrão de mock de tests/front/painel-lista-estorno-devido.test.tsx:
// `@/lib/supabase` mocado porque AdminOrdersView.tsx importa `supabase` no
// topo (fetch de pedido avulso por deep link); `useOrders` mocado porque a
// RPC paginada, o canal realtime e o `useAnalytics` não são o que esta
// tarefa muda.
import type { Order, OrderStatus, PaymentMethod, PaymentStatus } from "@/types";
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

let mockOrders: Order[] = [];
let mockTotalOrders = 0;
const registrarPagamentoRecebidoMock = vi
  .fn()
  .mockResolvedValue({ payment_status: "recebido_na_entrega" });

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    confirmarRetornoDoProduto: vi.fn().mockResolvedValue({ ok: true }),
    registrarPagamentoRecebido: registrarPagamentoRecebidoMock,
    totalOrders: mockTotalOrders,
    isLoaded: true,
    loading: false,
    pedidosCancelados: [],
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(overrides: {
  id: string;
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus | null;
  pagamentoRecebidoEm?: string | null;
}): Order {
  return {
    id: overrides.id,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [
      {
        productId: "prod-1",
        name: "Produto Teste",
        price: 100,
        quantity: 1,
        image: "",
      },
    ],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: overrides.paymentMethod ?? "cash",
    status: overrides.status ?? "processing",
    paymentStatus: overrides.paymentStatus ?? null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    returnedToSellerAt: null,
    pagamentoRecebidoEm: overrides.pagamentoRecebidoEm ?? null,
    pagamentoRecebidoPor: null,
  };
}

function botaoComTexto(hospedeiro: HTMLElement, texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

describe("AdminOrdersView — botão de registrar pagamento recebido na entrega (Task 4)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
    mockTotalOrders = 0;
    registrarPagamentoRecebidoMock.mockClear();
  });

  it("caso 1: paymentMethod 'cash' e pagamentoRecebidoEm null — o botão 'Marcar como recebido' aparece", async () => {
    mockOrders = [
      pedidoFake({
        id: "ped-cash",
        paymentMethod: "cash",
        status: "processing",
        pagamentoRecebidoEm: null,
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    const botao = botaoComTexto(hospedeiro, "Marcar como recebido");
    expect(botao).toBeTruthy();
  });

  it("caso 2: paymentMethod 'online' — o botão não aparece (quem confirma é o gateway)", async () => {
    mockOrders = [
      pedidoFake({
        id: "ped-online",
        paymentMethod: "online",
        status: "processing",
        pagamentoRecebidoEm: null,
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    const botao = botaoComTexto(hospedeiro, "Marcar como recebido");
    expect(botao).toBeUndefined();
  });

  it("caso 3: status 'cancelled' — o botão não aparece", async () => {
    mockOrders = [
      pedidoFake({
        id: "ped-cancelado",
        paymentMethod: "cash",
        status: "cancelled",
        pagamentoRecebidoEm: null,
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    const botao = botaoComTexto(hospedeiro, "Marcar como recebido");
    expect(botao).toBeUndefined();
  });

  it("caso 4: pagamentoRecebidoEm preenchido — aparece o texto de recebido e a ação de desfazer; desfazer chama registrarPagamentoRecebido(id, false)", async () => {
    mockOrders = [
      pedidoFake({
        id: "ped-recebido",
        paymentMethod: "cash",
        status: "delivered",
        pagamentoRecebidoEm: "2026-08-27T12:00:00Z",
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    // O botão de "marcar" some, some — o pedido já está marcado.
    expect(botaoComTexto(hospedeiro, "Marcar como recebido")).toBeUndefined();

    // Aparece algum texto indicando recebimento (data formatada).
    expect(hospedeiro.textContent).toMatch(/Recebido/i);

    const botaoDesfazer = botaoComTexto(hospedeiro, "Desfazer");
    expect(botaoDesfazer).toBeTruthy();

    await act(async () => {
      botaoDesfazer!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(registrarPagamentoRecebidoMock).toHaveBeenCalledTimes(1);
    // 🔴 O SEGUNDO ARGUMENTO é o que este caso existe para pegar: marcar e
    // desmarcar chamam a MESMA função — um teste que só confere "foi
    // chamada" passa com o botão de desfazer marcando de novo.
    expect(registrarPagamentoRecebidoMock).toHaveBeenCalledWith(
      "ped-recebido",
      false,
    );
  });

  // 🔴 Caso 5 — o modo DETALHADO. Acrescentado depois da revisao da Task 4.
  // `viewMode` nasce "compact", entao os casos 1 a 4 e as duas mutacoes
  // exercitaram apenas UMA das duas copias do bloco de pagamento. A copia
  // detalhada e' ~45 linhas de JSX duplicado a mao carregando a MESMA acao de
  // dinheiro: sem este caso, trocar o `false` por `true` no desfazer dela
  // deixa a suite inteira verde e o botao de desfazer passa a marcar de novo.
  it("caso 5: no modo detalhado, desfazer tambem chama registrarPagamentoRecebido(id, false)", async () => {
    localStorage.setItem("admin_orders_view_mode", "detailed");

    mockOrders = [
      pedidoFake({
        id: "ped-detalhado",
        paymentMethod: "cash",
        status: "delivered",
        pagamentoRecebidoEm: "2026-08-27T12:00:00Z",
      }),
    ];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    // Ancora positiva DUPLA, e as duas sao necessarias. A grade do modo
    // detalhado (`grid-cols-1`) prova que caiu no ramo certo -- a compacta usa
    // `grid-cols-2`; e o codigo do pedido prova que o cartao renderizou dentro
    // dela. Sem as duas, a ausencia do botao "Marcar como recebido" abaixo
    // seria verdadeira por vacuidade.
    expect(hospedeiro.querySelector("div.grid-cols-1")).toBeTruthy();
    expect(hospedeiro.textContent).toContain("ALHADO");
    expect(hospedeiro.textContent).toMatch(/Recebido/i);
    expect(botaoComTexto(hospedeiro, "Marcar como recebido")).toBeUndefined();

    const botaoDesfazer = botaoComTexto(hospedeiro, "Desfazer");
    expect(botaoDesfazer).toBeTruthy();

    await act(async () => {
      botaoDesfazer!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(registrarPagamentoRecebidoMock).toHaveBeenCalledTimes(1);
    expect(registrarPagamentoRecebidoMock).toHaveBeenCalledWith(
      "ped-detalhado",
      false,
    );
  });
});

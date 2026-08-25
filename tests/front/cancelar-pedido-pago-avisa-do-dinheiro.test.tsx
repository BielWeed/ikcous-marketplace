// @vitest-environment jsdom
//
// Achado: o aviso de "Cancelar Pedido" (`handleCancelOrder`,
// OrderDetailsView.tsx) não distinguia se o pagamento já tinha ENTRADO. O
// botão aparece para todo pedido `status === "pending"` com usuário logado,
// sem olhar o pagamento — e não existe estorno automático neste app. Quem já
// pagou clica em "Cancelar Pedido" e lê o mesmo texto genérico de quem nunca
// pagou nada, sem saber que o dinheiro fica retido até falar com a loja.
//
// A correção distingue os dois casos usando `paymentStatusKey` (a ÚNICA
// fonte que decide "null vira sem_cobranca", em OrderStatusBadge.tsx):
// pagamento ENTROU ('pago' ou 'pago_apos_expirar') ganha aviso próprio;
// qualquer outro valor mantém o texto original, palavra por palavra.
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// pedido-mostra-pagamento-confirmado.test.tsx, cujo dublê de hooks este
// arquivo reaproveita.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, PaymentStatus } from "@/types";

const pedidoBase: Order = {
  id: "pedido-cancelar",
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

let pedidoAtual: Order = pedidoBase;
const updateOrderStatusMock = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: updateOrderStatusMock,
  }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TEXTO_ORIGINAL =
  "Tem certeza que deseja cancelar este pedido? Esta ação não pode ser desfeita.";

function pedidoComPagamento(
  paymentStatus: PaymentStatus | null | undefined,
): Order {
  return { ...pedidoBase, status: "pending", paymentStatus };
}

describe("OrderDetailsView — o aviso de cancelamento fala do dinheiro quando já foi pago", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let confirmMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateOrderStatusMock.mockClear();
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
  });

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-cancelar"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function clicarCancelar() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancelar Pedido"),
    );
    expect(botao).toBeDefined();
    return act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("paymentStatus 'pago': o confirm avisa que o dinheiro não volta automaticamente e cita a loja", async () => {
    confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    pedidoAtual = pedidoComPagamento("pago");

    await renderizar();
    await clicarCancelar();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    const texto = confirmMock.mock.calls[0][0] as string;
    expect(texto).toContain("NÃO volta automaticamente");
    expect(texto).toContain("falar com a loja");
  });

  it("CONTROLE — paymentStatus 'aguardando': o confirm recebe o texto original, sem falar em dinheiro", async () => {
    confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    pedidoAtual = pedidoComPagamento("aguardando");

    await renderizar();
    await clicarCancelar();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    const texto = confirmMock.mock.calls[0][0] as string;
    expect(texto).toBe(TEXTO_ORIGINAL);
    expect(texto).not.toContain("não volta automaticamente");
  });

  it("paymentStatus nulo: o confirm também recebe o texto original", async () => {
    confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    pedidoAtual = pedidoComPagamento(null);

    await renderizar();
    await clicarCancelar();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    const texto = confirmMock.mock.calls[0][0] as string;
    expect(texto).toBe(TEXTO_ORIGINAL);
  });

  it("recusar o confirm (pagamento 'pago') não cancela o pedido", async () => {
    confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmMock);
    pedidoAtual = pedidoComPagamento("pago");

    await renderizar();
    await clicarCancelar();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(updateOrderStatusMock).not.toHaveBeenCalled();
  });

  it("recusar o confirm (pagamento 'aguardando') não cancela o pedido", async () => {
    confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmMock);
    pedidoAtual = pedidoComPagamento("aguardando");

    await renderizar();
    await clicarCancelar();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(updateOrderStatusMock).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
//
// S1 (dinheiro, 04/10/2026, migration 20261198000000): o cliente cancela o
// próprio pedido online em "Meus pedidos" (OrderDetailsView). O cancelamento
// passa pela edge `criar-pagamento`, que anula a cobrança no Mercado Pago
// antes; quando ela NÃO cancela, `useOrders` já mostrou o aviso e lança
// `ErroCancelamentoNaoConcluido`. Esta tela tem de:
//   - nunca pintar "cancelado" sem a resposta `cancelado`;
//   - "já pago" / "mudou": reler o pedido do servidor (o pago aparece quando
//     a confirmação do MP chegar — a tela nunca marca pago sozinha);
//   - "em análise" / "tente de novo": não reler, não mudar nada.
// Harness de cliente-cancela-conforme-o-envio.test.tsx; o módulo
// `@/hooks/useOrders` é o REAL com só `useOrders` trocado — a tela usa a
// classe de erro de verdade (`instanceof`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedidoBase: Order = {
  id: "pedido-online",
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
  paymentMethod: "online",
  paymentStatus: "aguardando",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

const updateOrderStatusMock = vi.fn();
const fetchUserOrdersMock = vi.fn();

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({
      orders: [pedidoBase],
      fetchUserOrders: fetchUserOrdersMock,
      updateOrderStatus: updateOrderStatusMock,
    }),
  };
});

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "order_refunds") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
        }),
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — cancelar pedido online pela edge (S1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    updateOrderStatusMock.mockReset();
    fetchUserOrdersMock.mockReset();
    fetchUserOrdersMock.mockResolvedValue([pedidoBase]);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
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
          orderId="pedido-online"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function botaoCancelar() {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancelar Pedido"),
    );
  }

  async function clicarCancelar() {
    const botao = botaoCancelar();
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it.each(["ja_pago", "mudou"] as const)(
    "edge responde %s: o pedido NÃO vira cancelado na tela e é relido do servidor",
    async (desfecho) => {
      const { ErroCancelamentoNaoConcluido } = await import(
        "@/hooks/useOrders"
      );
      updateOrderStatusMock.mockRejectedValue(
        new ErroCancelamentoNaoConcluido({
          desfecho,
          mensagem: "frase da edge",
        }),
      );
      await renderizar();
      const leiturasAntes = fetchUserOrdersMock.mock.calls.length;

      await clicarCancelar();

      expect(updateOrderStatusMock).toHaveBeenCalledWith(
        "pedido-online",
        "cancelled",
      );
      expect(fetchUserOrdersMock.mock.calls.length).toBe(leiturasAntes + 1);
      // Nada de "cancelado" pintado: o botão continua lá (pedido pending).
      expect(botaoCancelar()).toBeDefined();
    },
  );

  it.each(["em_analise", "recuperavel"] as const)(
    "edge responde %s: nada muda na tela e o pedido NÃO é relido",
    async (desfecho) => {
      const { ErroCancelamentoNaoConcluido } = await import(
        "@/hooks/useOrders"
      );
      updateOrderStatusMock.mockRejectedValue(
        new ErroCancelamentoNaoConcluido({
          desfecho,
          mensagem: "frase da edge",
        }),
      );
      await renderizar();
      const leiturasAntes = fetchUserOrdersMock.mock.calls.length;

      await clicarCancelar();

      expect(fetchUserOrdersMock.mock.calls.length).toBe(leiturasAntes);
      expect(botaoCancelar()).toBeDefined();
    },
  );

  it("controle: edge cancelou (updateOrderStatus resolve) — a tela mostra cancelado e o botão some", async () => {
    updateOrderStatusMock.mockResolvedValue(undefined);
    await renderizar();

    await clicarCancelar();

    expect(botaoCancelar()).toBeUndefined();
  });
});

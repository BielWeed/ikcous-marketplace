// @vitest-environment jsdom
//
// Pedido de R$ 0,00 nas telas da CLIENTE (cupom de 100% que zera a compra).
// Decisão do dono, 15/10/2026 — só telas e textos; o servidor segue gravando
// o pedido como "pagar na entrega":
//   - detalhe do pedido: o rótulo da forma de pagamento e a frase do cartão
//     de status dizem "Sem valor a pagar"/"você não paga nada", nunca
//     "Dinheiro" nem "você paga na entrega";
//   - lista "Meus pedidos": o selo da forma de pagamento idem;
//   - CONTROLE: o mesmo componente com total 10 continua dizendo o de antes.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedidoBase: Order = {
  id: "pedido-zero",
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
  shipping: 0,
  discount: 100,
  total: 0,
  paymentMethod: "cash",
  status: "pending",
  paymentStatus: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

let pedidoAtual: Order = pedidoBase;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: vi.fn(),
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

describe("telas da cliente — pedido de R$ 0,00 (sem valor a pagar)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    pedidoAtual = pedidoBase;
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

  async function renderizarDetalhe() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-zero"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function renderizarLista() {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(
        <OrderList
          orders={[pedidoAtual]}
          isLoadingOrders={false}
          onNavigate={() => {}}
          isGuest={false}
        />,
      );
    });
  }

  function descricaoDoCartaoDeStatus(): string {
    return (
      hospedeiro.querySelector('[data-testid="cartao-status"] p')
        ?.textContent ?? ""
    );
  }

  describe("detalhe do pedido", () => {
    it("total 0: a forma de pagamento é 'Sem valor a pagar' e a frase não manda pagar na entrega", async () => {
      await renderizarDetalhe();

      expect(hospedeiro.textContent).toContain("Sem valor a pagar");
      expect(hospedeiro.textContent).not.toContain("Dinheiro");
      expect(descricaoDoCartaoDeStatus()).toBe(
        "Recebemos seu pedido. A loja vai separar e você não paga nada.",
      );
      expect(hospedeiro.textContent).not.toContain("você paga");
    });

    it("total 0 com retirada na loja: diz que não paga nada na retirada", async () => {
      pedidoAtual = {
        ...pedidoBase,
        retiradaNaLoja: true,
        enderecoDeRetirada: "Rua da Loja, 10 - Centro",
      };

      await renderizarDetalhe();

      expect(descricaoDoCartaoDeStatus()).toBe(
        "Recebemos seu pedido. A loja vai separar e você não paga nada na retirada.",
      );
      expect(hospedeiro.textContent).toContain("Sem valor a pagar");
    });

    it("CONTROLE: o mesmo pedido com total 10 continua 'Dinheiro' e 'você paga na entrega'", async () => {
      pedidoAtual = { ...pedidoBase, total: 10, discount: 0, subtotal: 10 };

      await renderizarDetalhe();

      expect(hospedeiro.textContent).toContain("Dinheiro");
      expect(hospedeiro.textContent).not.toContain("Sem valor a pagar");
      expect(descricaoDoCartaoDeStatus()).toBe(
        "Recebemos seu pedido. A loja vai separar e você paga na entrega.",
      );
    });

    it("CONTROLE: total 10 com retirada continua 'paga na loja, na hora de retirar'", async () => {
      pedidoAtual = {
        ...pedidoBase,
        total: 10,
        retiradaNaLoja: true,
        enderecoDeRetirada: "Rua da Loja, 10 - Centro",
      };

      await renderizarDetalhe();

      expect(descricaoDoCartaoDeStatus()).toBe(
        "Recebemos seu pedido. A loja vai separar e você paga na loja, na hora de retirar.",
      );
    });
  });

  describe("lista 'Meus pedidos'", () => {
    it("total 0: o selo da forma de pagamento diz 'Sem valor a pagar', não 'Dinheiro'", async () => {
      await renderizarLista();

      expect(hospedeiro.textContent).toContain("Sem valor a pagar");
      expect(hospedeiro.textContent).not.toContain("Dinheiro");
    });

    it("CONTROLE: total 10 continua 'Dinheiro' (e PIX/cartão com o rótulo curto de sempre)", async () => {
      for (const [forma, rotulo] of [
        ["cash", "Dinheiro"],
        ["pix", "PIX"],
        ["card", "Cartão"],
      ] as const) {
        pedidoAtual = {
          ...pedidoBase,
          paymentMethod: forma,
          total: 10,
          discount: 0,
          subtotal: 10,
        };
        await renderizarLista();

        expect(hospedeiro.textContent).toContain(rotulo);
        expect(hospedeiro.textContent).not.toContain("Sem valor a pagar");
        act(() => {
          raiz.unmount();
        });
        raiz = createRoot(hospedeiro);
      }
    });
  });
});

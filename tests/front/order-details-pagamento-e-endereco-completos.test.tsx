// @vitest-environment jsdom
//
// Meus pedidos, detalhe do pedido: duas coisas que a cliente via erradas.
// 1) A forma de pagamento aparecia como o valor cru do banco ("Cash",
//    "Online"; maquininha sempre "Cartão de Crédito", mesmo no débito).
//    Agora usa o MESMO rótulo em português da planilha e da ficha da loja
//    (`rotuloDaFormaDoPedido`), sem chutar crédito nem PIX que o pedido não diz.
// 2) O endereço de entrega não mostrava complemento ("Apto 1") nem CEP.
//    Agora usa as mesmas linhas do recibo e da ficha da loja.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedidoBase: Order = {
  id: "pedido-pg",
  customer: {
    name: "Cliente Teste",
    whatsapp: "34999999999",
    address: "Rua das Flores",
    number: "100",
    complement: "Apto 1",
    neighborhood: "Centro",
    city: "Uberlândia",
    state: "MG",
    cep: "38400-000",
  },
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
  paymentMethod: "cash",
  status: "shipping",
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

describe("OrderDetailsView — pagamento em português e endereço completo", () => {
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

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-pg"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const textoDoPagamento = () => {
    const rotulo = [...hospedeiro.querySelectorAll("p")].find(
      (p) => p.textContent?.trim() === "Pagamento",
    );
    return rotulo?.nextElementSibling?.textContent?.trim() ?? "";
  };

  it("dinheiro na entrega aparece como 'Dinheiro', nunca 'Cash'", async () => {
    pedidoAtual = { ...pedidoBase, paymentMethod: "cash" };
    await renderizar();
    expect(textoDoPagamento()).toBe("Dinheiro");
  });

  it("pago pelo app (online) não vira o valor cru 'Online'", async () => {
    pedidoAtual = { ...pedidoBase, paymentMethod: "online" };
    await renderizar();
    expect(textoDoPagamento()).not.toMatch(/^online$/i);
    expect(textoDoPagamento()).toBe("Pagamento pelo site");
  });

  it("maquininha não afirma crédito (pode ser débito)", async () => {
    pedidoAtual = { ...pedidoBase, paymentMethod: "card" };
    await renderizar();
    expect(textoDoPagamento()).not.toMatch(/crédito/i);
    expect(textoDoPagamento()).toBe("Cartão na entrega");
  });

  it("o endereço mostra complemento e CEP, além de rua, bairro e cidade", async () => {
    await renderizar();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Rua das Flores, 100 - Apto 1");
    expect(texto).toContain("CEP: 38400-000");
    expect(texto).toContain("Centro");
    expect(texto).toContain("Uberlândia/MG");
  });

  it("sem complemento nem CEP: nenhum rótulo solto", async () => {
    pedidoAtual = {
      ...pedidoBase,
      customer: {
        ...pedidoBase.customer,
        complement: undefined,
        cep: undefined,
      },
    };
    await renderizar();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Rua das Flores, 100");
    expect(texto).not.toContain("CEP:");
    expect(texto).not.toContain("100 -");
  });
});

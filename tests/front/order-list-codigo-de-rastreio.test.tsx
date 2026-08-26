// @vitest-environment jsdom
//
// PEDIDO-060 (#105), segunda metade: o código de rastreio também na LISTAGEM.
//
// O critério de aceite da issue exige o código "na listagem de pedidos ou na
// tela de rastreio de convidado (definir qual e cumprir)". A listagem é a
// escolha: ela é a tela onde o cliente chega perguntando "onde está meu
// pedido?", e obrigá-lo a abrir cada pedido para descobrir se já tem código é
// justamente o atrito que faz ele desistir e chamar no WhatsApp — que é o
// estado que a issue existe para acabar.
//
// A tela de detalhe está coberta em order-details-codigo-de-rastreio.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const pedidoBase: Order = {
  id: "11111111-2222-3333-4444-555555555555",
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
  cancelledAfterShipping: false,
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList — código de rastreio no cartão do pedido (#105)", () => {
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

  async function renderizar(pedido: Order) {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={[pedido]} onNavigate={() => {}} />);
    });
  }

  it("com código preenchido, o cartão mostra o código sem precisar abrir o pedido", async () => {
    await renderizar({ ...pedidoBase, trackingCode: "AA123456789BR" });

    expect(hospedeiro.textContent).toContain("AA123456789BR");
  });

  it("pedido sem código não ganha rótulo vazio nem 'undefined'", async () => {
    await renderizar({ ...pedidoBase, trackingCode: undefined });

    const texto = hospedeiro.textContent ?? "";
    // Âncora: o cartão renderizou de verdade.
    expect(texto).toContain("Blusa Teste");
    expect(texto).not.toContain("undefined");
    expect(texto).not.toContain("Rastreio");
  });

  it("código só com espaços conta como ausente", async () => {
    await renderizar({ ...pedidoBase, trackingCode: "  " });

    expect(hospedeiro.textContent).not.toContain("Rastreio");
  });
});

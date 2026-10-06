// @vitest-environment jsdom
//
// F6 (04/10/2026): o comprovante impresso vai para a mão do cliente, e o app
// dele mostra o pedido como "#3884BE" (6 últimos caracteres do id, em
// maiúsculas — `numeroDoPedido`). O papel saía com "#3884be": a mesma compra
// com duas grafias.
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedido: Order = {
  id: "pedido-c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be",
  customer: { name: "Maria Teste", whatsapp: "11999999999" },
  items: [],
  subtotal: 100,
  shipping: 15,
  discount: 0,
  total: 115,
  paymentMethod: "pix",
  status: "pending",
  createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
  updatedAt: new Date("2026-08-20T10:00:00Z").toISOString(),
  cancelledAfterShipping: false,
};

describe("OrderReceipt — o número do pedido no papel é o que o cliente vê", () => {
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

  it("o recibo diz 'Pedido #3884BE', nunca '#3884be'", () => {
    act(() => {
      raiz.render(<OrderReceipt order={pedido} />);
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Pedido #3884BE");
    expect(texto).not.toContain("#3884be");
  });
});

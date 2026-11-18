// @vitest-environment jsdom
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function pedidoBase(recipientName?: string, overrides: Partial<Order> = {}) {
  return {
    id: "pedido-1234567890",
    customer: {
      name: "Cliente Teste",
      whatsapp: "11999999999",
      address: "Rua das Flores",
      number: "100",
      neighborhood: "Centro",
      recipientName,
    },
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
    shipping: 15,
    discount: 0,
    total: 115,
    paymentMethod: "pix",
    status: "pending",
    createdAt: "2026-08-20T10:00:00Z",
    updatedAt: "2026-08-20T10:00:00Z",
    cancelledAfterShipping: false,
    ...overrides,
  } as Order;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderReceipt — o papel diz quem recebe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function imprimir(pedido: Order): Promise<HTMLElement> {
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} />);
    });
    const papel = document.body.querySelector<HTMLElement>(".print\\:block");
    expect(papel).not.toBeNull();
    return papel!;
  }

  it("compra para outra pessoa: 'Recebe: X' logo abaixo do nome de quem comprou", async () => {
    const papel = await imprimir(pedidoBase("  Maria   da Silva "));
    const nome = Array.from(papel.querySelectorAll("p")).find(
      (p) => p.textContent === "Cliente Teste",
    );
    expect(nome?.nextElementSibling?.textContent).toBe(
      "Recebe: Maria da Silva",
    );
  });

  it.each([undefined, "", "   ", "cliente TESTE", "Cliente Téste"])(
    "não repete o comprador nem inventa quem recebe: %j",
    async (recipientName) => {
      const papel = await imprimir(pedidoBase(recipientName));
      expect(papel.textContent).not.toContain("Recebe:");
    },
  );

  it("venda de balcão não imprime 'Recebe:'", async () => {
    const papel = await imprimir(
      pedidoBase("Maria da Silva", {
        canal: "presencial",
        shipping: 0,
        total: 100,
      }),
    );
    expect(papel.textContent).not.toContain("Recebe:");
  });
});

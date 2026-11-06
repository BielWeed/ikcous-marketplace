// @vitest-environment jsdom
//
// Reimprimir pela FICHA do pedido uma venda de balcão sem cliente: o banco
// grava 'Venda no balcão' em `customer_name`, e o papel saía com
// "CLIENTE: Venda no balcão". O recibo da tela Vender já evita isso (nome
// vazio); a ficha não tinha o mesmo tratamento. Cliente cadastrada sem nome
// no perfil (tem userId) sai como "Cliente", igual ao recibo da tela Vender.
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "pedido-1234567890",
    customer: { name: "Venda no balcão", whatsapp: "" },
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
    paymentMethod: "pix",
    status: "delivered",
    canal: "presencial",
    createdAt: new Date("2026-10-20T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-10-20T10:00:00Z").toISOString(),
    cancelledAfterShipping: false,
    ...parcial,
  };
}

describe("papel da ficha: venda de balcão sem cliente", () => {
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
  const papel = () => document.querySelector("[data-tema-fixo]")!;

  it("sem userId: o papel não traz 'CLIENTE:' nem 'Venda no balcão'", async () => {
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido()} storeName="L" />);
    });
    expect(papel().textContent).not.toContain("CLIENTE:");
    expect(papel().textContent).not.toContain("Venda no balcão");
    expect(papel().textContent).toContain("Produto Teste");
  });

  it("com userId (cadastrada sem nome no perfil): o papel diz 'Cliente', não 'Venda no balcão'", async () => {
    await act(async () => {
      raiz.render(
        <OrderReceipt
          order={pedido({
            userId: "cliente-1",
            customer: { name: "Venda no balcão", whatsapp: "11999990000" },
          })}
          storeName="L"
        />,
      );
    });
    expect(papel().textContent).toContain("CLIENTE:");
    expect(papel().textContent).toContain("Cliente");
    expect(papel().textContent).toContain("11999990000");
    expect(papel().textContent).not.toContain("Venda no balcão");
  });

  it("controle: balcão com cliente de verdade segue imprimindo o nome", async () => {
    await act(async () => {
      raiz.render(
        <OrderReceipt
          order={pedido({
            customer: { name: "Lia", whatsapp: "11988887777" },
          })}
          storeName="L"
        />,
      );
    });
    expect(papel().textContent).toContain("CLIENTE:");
    expect(papel().textContent).toContain("Lia");
    expect(papel().textContent).toContain("11988887777");
  });

  it("controle: pedido online chamado 'Venda no balcão' (nome digitado) não é escondido", async () => {
    await act(async () => {
      raiz.render(
        <OrderReceipt
          order={pedido({ canal: "online", shipping: 10, total: 110 })}
          storeName="L"
        />,
      );
    });
    expect(papel().textContent).toContain("CLIENTE:");
  });
});

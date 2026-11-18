// @vitest-environment jsdom
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("quebra palavras longas dos campos livres sem alterar o texto impresso", async () => {
  const longo = "á".repeat(120);
  const pedido: Order = {
    id: "pedido-1234567890",
    customer: {
      name: longo,
      whatsapp: "11999999999",
      address: "Rua",
      number: "120",
      complement: longo,
      neighborhood: longo,
      reference: longo,
    },
    items: [
      {
        productId: "produto",
        name: longo,
        variantId: "variacao",
        price: 100,
        quantity: 1,
        image: "",
      },
    ],
    notes: longo,
    retiradaNaLoja: true,
    enderecoDeRetirada: longo,
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    createdAt: "2026-11-17T12:00:00Z",
    updatedAt: "2026-11-17T12:00:00Z",
    cancelledAfterShipping: false,
  };
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  try {
    await act(async () => {
      raiz.render(
        <OrderReceipt
          order={pedido}
          storeName={longo}
          variacoes={{ variacao: longo }}
        />,
      );
    });
    const cliente = Array.from(document.querySelectorAll("p")).find(
      (p) => p.textContent === "CLIENTE:",
    )?.parentElement;
    const camposDoCliente = Array.from(cliente!.querySelectorAll("p")).slice(1);
    expect(camposDoCliente).toHaveLength(4);
    for (const campo of camposDoCliente) {
      expect(campo.classList.contains("break-words")).toBe(true);
    }
    const textosLivres = Array.from(
      document.querySelectorAll("h2, p, span"),
    ).filter((el) => el.textContent === longo);
    // Loja, cliente, retirada, observação e variação.
    expect(textosLivres).toHaveLength(5);
    for (const campo of textosLivres) {
      expect(campo.classList.contains("break-words")).toBe(true);
    }
    const produto = Array.from(document.querySelectorAll("span")).find(
      (el) => el.firstChild?.textContent === "1",
    );
    expect(produto?.textContent).toContain(`1x ${longo}`);
    expect(produto?.classList.contains("break-words")).toBe(true);
    expect(produto?.classList.contains("min-w-0")).toBe(true);
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
  }
});

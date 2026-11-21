// @vitest-environment jsdom
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

it.each(["", "   ", undefined])(
  "imprime Produto quando o nome do item é %j",
  async (name) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const raiz = createRoot(document.createElement("div"));
    const pedido: Order = {
      id: "pedido-teste",
      customer: { name: "Cliente Teste", whatsapp: "" },
      items: [
        {
          productId: "produto-teste",
          name: name as string,
          price: 10,
          quantity: 1,
          image: "",
        },
      ],
      subtotal: 10,
      shipping: 0,
      total: 10,
      paymentMethod: "pix",
      status: "pending",
      createdAt: "2026-11-21T10:00:00Z",
      updatedAt: "2026-11-21T10:00:00Z",
      cancelledAfterShipping: false,
    };

    try {
      await act(async () => raiz.render(<OrderReceipt order={pedido} />));
      expect(document.querySelector("[data-tema-fixo]")?.textContent).toContain(
        "1x Produto",
      );
    } finally {
      await act(async () => raiz.unmount());
      vi.unstubAllGlobals();
    }
  },
);

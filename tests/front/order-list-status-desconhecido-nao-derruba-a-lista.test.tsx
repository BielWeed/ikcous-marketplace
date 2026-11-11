// @vitest-environment jsdom
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, View } from "@/types";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: vi.fn().mockResolvedValue(true),
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
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList — status desconhecido não derruba a lista", () => {
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

  it("mantém os dois cartões e abre o pedido certo mesmo com status novo", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const onNavigate = vi.fn<(view: View, id?: string) => void>();
    const pedidos: Order[] = [
      // Simula um valor vindo do banco que o front ainda não conhece.
      { ...pedidoBase, status: "new" as Order["status"] },
      {
        ...pedidoBase,
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        status: "delivered",
      },
    ];

    await expect(
      act(async () => {
        raiz.render(<OrderList orders={pedidos} onNavigate={onNavigate} />);
      }),
    ).resolves.not.toThrow();

    const botoes = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>(
        '[data-testid="order-card-open"]',
      ),
    ];
    expect(botoes).toHaveLength(2);

    for (const pedido of pedidos) {
      const botao = botoes.find(
        (b) =>
          b.getAttribute("aria-label") ===
          `Ver detalhes do pedido #${numeroDoPedido(pedido.id)}`,
      );
      expect(botao).toBeDefined();
      expect(botao?.closest("div.relative.flex-col")).not.toBeNull();
      expect(botao?.textContent?.trim()).toBe("Ver detalhes");
      onNavigate.mockClear();

      await act(async () => {
        botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(onNavigate).toHaveBeenCalledExactlyOnceWith(
        "order-details",
        pedido.id,
      );
    }
  });
});

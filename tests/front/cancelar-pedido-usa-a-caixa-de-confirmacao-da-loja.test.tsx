// @vitest-environment jsdom
//
// UI-191 (G10): "Cancelar Pedido" perguntava pelo `confirm()` do navegador, que
// numa loja instalada aparece com o endereço do site e o visual do sistema.
// Agora é a caixa de confirmação da casa (AlertDialog), acima da barra de
// navegação, com O MESMO caminho de cancelamento: nada é cancelado antes do
// "sim", "Manter pedido" não cancela, e o "sim" chama a mesma edge uma vez.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedido: Order = {
  id: "pedido-cancelar",
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
  paymentStatus: "pago",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

const updateOrderStatusMock = vi.fn();
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders: vi.fn().mockResolvedValue([pedido]),
    updateOrderStatus: updateOrderStatusMock,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
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
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — cancelar pedido pela caixa de confirmação da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    updateOrderStatusMock.mockReset().mockResolvedValue(undefined);
    confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-cancelar"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    confirmSpy.mockRestore();
  });

  const caixa = () =>
    document.querySelector<HTMLElement>('[role="alertdialog"]');
  const botao = (raizDoBotao: ParentNode, rotulo: string) =>
    Array.from(raizDoBotao.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes(rotulo),
    );

  async function abrirACaixa() {
    const abrir = botao(hospedeiro, "Cancelar Pedido");
    expect(abrir).toBeDefined();
    await act(async () => {
      abrir!.click();
    });
  }

  it("abre a caixa da loja (não o confirm do navegador) e ainda não cancela nada", async () => {
    await abrirACaixa();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(caixa()).not.toBeNull();
    expect(caixa()!.textContent).toContain("Cancelar este pedido?");
    // O texto é o de sempre sobre o dinheiro (pedido pago e não enviado).
    expect(caixa()!.textContent).toContain("volta sozinho");
    // Acima da barra de navegação da loja (z-120).
    expect(caixa()!.className).toContain("z-[130]");
    expect(updateOrderStatusMock).not.toHaveBeenCalled();
  });

  it("'Manter pedido' fecha a caixa e não cancela", async () => {
    await abrirACaixa();
    await act(async () => {
      botao(caixa()!, "Manter pedido")!.click();
    });

    expect(caixa()).toBeNull();
    expect(updateOrderStatusMock).not.toHaveBeenCalled();
    expect(botao(hospedeiro, "Cancelar Pedido")).toBeDefined();
  });

  it("'Cancelar pedido' (o sim) chama o cancelamento uma vez, com o id do pedido", async () => {
    await abrirACaixa();
    await act(async () => {
      botao(caixa()!, "Cancelar pedido")!.click();
      await Promise.resolve();
    });

    expect(updateOrderStatusMock).toHaveBeenCalledTimes(1);
    expect(updateOrderStatusMock).toHaveBeenCalledWith(
      "pedido-cancelar",
      "cancelled",
    );
    expect(caixa()).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("Escape fecha a caixa sem cancelar", async () => {
    await abrirACaixa();
    await act(async () => {
      caixa()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(updateOrderStatusMock).not.toHaveBeenCalled();
  });
});

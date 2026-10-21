// @vitest-environment jsdom
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pedido: Order = {
  id: "pedido-whatsapp",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    { productId: "prod-1", name: "Blusa", price: 100, quantity: 1, image: "" },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "pix",
  status: "shipping",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders: vi.fn().mockResolvedValue([pedido]),
    updateOrderStatus: vi.fn(),
  }),
}));
const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
const config = { enableReviews: false, whatsappNumber: "34999999999" };
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config }),
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

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("pedido do cliente — contato com o glifo oficial do WhatsApp", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    config.whatsappNumber = "34999999999";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={pedido.id}
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
  }

  it("os dois botões da loja mostram o path oficial, não o balão genérico", async () => {
    await renderizar();
    const topo = hospedeiro.querySelector(
      'button[aria-label="Falar com a loja no WhatsApp"]',
    );
    const rodape = [...hospedeiro.querySelectorAll("button")].find(
      (botao) => botao.textContent?.trim() === "Falar com a loja",
    );
    expect(topo).not.toBeNull();
    expect(rodape).toBeDefined();
    for (const botao of [topo, rodape]) {
      // Assinatura do path do simple-icons em IconeWhatsapp, sem mock do ícone.
      expect(botao?.querySelector('path[d^="M17.472 14.382"]')).not.toBeNull();
      expect(botao?.querySelector(".lucide-message-circle")).toBeNull();
      expect(botao?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    }
  });

  it("sem WhatsApp configurado não oferece contato quebrado", async () => {
    config.whatsappNumber = "";
    await renderizar();
    expect(
      hospedeiro.querySelector(
        'button[aria-label="Falar com a loja no WhatsApp"]',
      ),
    ).toBeNull();
    expect(
      [...hospedeiro.querySelectorAll("button")].some(
        (botao) => botao.textContent?.trim() === "Falar com a loja",
      ),
    ).toBe(false);
  });
});

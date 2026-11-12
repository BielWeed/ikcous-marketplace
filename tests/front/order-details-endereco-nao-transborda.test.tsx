// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const { pedido } = vi.hoisted(() => ({
  pedido: {
    id: "pedido-endereco",
    customer: {
      name: "Cliente Teste",
      whatsapp: "34999999999",
      address: "Rua de Teste",
      number: "10",
      complement: "x".repeat(80),
      neighborhood: "Centro",
      city: "Cidade",
      state: "MG",
      cep: "38400-000",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "shipping",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    retiradaNaLoja: true,
    enderecoDeRetirada: "y".repeat(80),
  },
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders: vi.fn().mockResolvedValue([pedido]),
    updateOrderStatus: vi.fn(),
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("endereços de entrega e retirada quebram palavras de 80 caracteres", async () => {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  try {
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={pedido.id}
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    const paragrafos = [...hospedeiro.querySelectorAll("p")];
    for (const endereco of [
      pedido.customer.complement,
      pedido.enderecoDeRetirada,
    ]) {
      const paragrafo = paragrafos.find((p) =>
        p.textContent?.includes(endereco),
      );
      expect(paragrafo, endereco).toBeDefined();
      expect(paragrafo?.classList.contains("break-words"), endereco).toBe(true);
    }
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
  }
});

// @vitest-environment jsdom
//
// Caça 13-C #5: quando a conferência de "quais itens eu já avaliei" FALHA, a
// ficha do pedido não pode afirmar "0 de N avaliados" nem oferecer estrelas
// (a cliente avaliaria de novo e a nota do produto contaria duas vezes). O
// dublê do supabase devolve `{ data: null, error }` DE VERDADE, como o
// supabase-js faz (ele não lança).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const fetchUserOrders = vi.fn();

const pedidoEntregue: Order = {
  id: "pedido-101",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
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
  paymentMethod: "cash",
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoEntregue],
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
  }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, whatsappNumber: "34999999999" },
  }),
}));

const respostas: Array<{ data: unknown; error: unknown }> = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () =>
            Promise.resolve(respostas.shift() ?? { data: [], error: null }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function botaoDeEstrela(dentroDe: HTMLElement) {
  return [...dentroDe.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label")?.startsWith("Dar ") ||
      b.textContent?.includes("Escrever avaliação"),
  );
}

describe("OrderDetailsView — conferência de avaliações que falha (13-C #5)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function abrir() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-101"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    respostas.length = 0;
    fetchUserOrders.mockReset();
    fetchUserOrders.mockResolvedValue([pedidoEntregue]);
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

  it("na falha, não diz '0 de N avaliados' nem oferece avaliar; oferece tentar de novo", async () => {
    respostas.push({ data: null, error: { message: "rede" } });
    await abrir();

    expect(hospedeiro.textContent).not.toMatch(/0 de 1\s*avaliados/);
    expect(botaoDeEstrela(hospedeiro)).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Não deu para conferir suas avaliações",
    );
    expect(
      hospedeiro.querySelector('[data-testid="avaliacoes-tentar-de-novo"]'),
    ).not.toBeNull();
  });

  it("'Tentar de novo' refaz a conferência e, dando certo, volta ao normal", async () => {
    respostas.push({ data: null, error: { message: "rede" } });
    respostas.push({ data: [{ product_id: "prod-1" }], error: null });
    await abrir();

    const tentar = hospedeiro.querySelector(
      '[data-testid="avaliacoes-tentar-de-novo"]',
    ) as HTMLButtonElement;
    await act(async () => {
      tentar.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).toMatch(/1 de 1\s*avaliados/);
    expect(
      hospedeiro.querySelector('[data-testid="avaliacoes-tentar-de-novo"]'),
    ).toBeNull();
  });
});

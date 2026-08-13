// @vitest-environment jsdom
//
// Prova da garantia central da Trilha 2 (ADMIN-090, issue #101) na tela de
// pedido entregue: com o interruptor "Avaliações dos Clientes" desligado,
// nenhum item do pedido pode oferecer o botão "Avaliar" — mesmo quando o
// pedido já está `delivered` e o item ainda não foi avaliado (o único
// caminho, antes desta correção, que mostrava o botão).
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de checkout-view-flag-off.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const fetchUserOrders = vi.fn();
const updateOrderStatus = vi.fn();

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
};

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoEntregue],
    fetchUserOrders,
    updateOrderStatus,
  }),
}));

// `user` precisa ser a MESMA referência em toda chamada -- o efeito
// `checkIfReviewed` de OrderDetailsView tem `[user, order]` nas deps. Um
// objeto literal novo a cada render faria esse efeito disparar sem parar
// (identidade sempre diferente -> setReviewedProductIds -> re-render ->
// identidade diferente de novo), travando o `act()` deste teste.
const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));

let enableReviews = true;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews, whatsappNumber: "34999999999" },
  }),
}));

// checkIfReviewed (linha ~190 de OrderDetailsView) consulta `reviews` direto
// pelo client do Supabase -- sem vi.importActual, para não puxar o client
// de verdade (Web Worker, indisponível no jsdom) só de importar o módulo.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão de
// checkout-view-flag-off.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function localizarBotaoAvaliar(dentroDe: HTMLElement) {
  return [...dentroDe.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Avaliar"),
  ) as HTMLButtonElement | undefined;
}

describe("OrderDetailsView — gate do interruptor de Avaliações (ADMIN-090, #101)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    fetchUserOrders.mockClear();
    fetchUserOrders.mockResolvedValue([pedidoEntregue]);
    updateOrderStatus.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    enableReviews = true;
  });

  it("com o flag DESLIGADO, o pedido entregue não oferece o botão Avaliar", async () => {
    enableReviews = false;
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
    // `checkIfReviewed` (efeito assíncrono) precisa resolver antes de medir.
    await act(async () => {
      await Promise.resolve();
    });

    expect(localizarBotaoAvaliar(hospedeiro)).toBeUndefined();
  });

  it("com o flag LIGADO, o pedido entregue continua oferecendo o botão Avaliar", async () => {
    enableReviews = true;
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

    expect(localizarBotaoAvaliar(hospedeiro)).toBeDefined();
  });
});

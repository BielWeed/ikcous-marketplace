// @vitest-environment jsdom
//
// Defeito: três pontos do card "Resumo da Transação" (e o selo "Avaliado" do
// item entregue) usavam `text-emerald-600`, que mede 3,58-3,77:1 contra o
// mínimo AA (4,5:1) de texto normal. `text-emerald-700` mede 5,21:1 e passa.
//
//   - o selo "Avaliado" de um item já avaliado (pedido entregue);
//   - "Grátis" na linha "Logística e Envio" quando `order.shipping === 0`;
//   - o valor "-R$ X" da linha "Benefício / Cupom" quando há desconto.
//
// Modelo estrutural copiado de order-details-gate-avaliacoes.test.tsx (mesmos
// dublês) -- a diferença é que aqui `reviewedProductIds` precisa CONTER o
// produto do pedido (para o selo "Avaliado" aparecer, em vez do botão
// "Avaliar"), e o pedido precisa ter `shipping: 0` e `discount > 0`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const fetchUserOrders = vi.fn();
const updateOrderStatus = vi.fn();

const pedidoEntregue: Order = {
  id: "pedido-financeiro",
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
  discount: 20,
  total: 80,
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
    updateOrderStatus,
  }),
}));

// `user` precisa ser a MESMA referência em toda chamada -- o efeito
// `checkIfReviewed` de OrderDetailsView tem `[user, order]` nas deps (mesma
// nota de order-details-gate-avaliacoes.test.tsx).
const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, whatsappNumber: "34999999999" },
  }),
}));

// checkIfReviewed (OrderDetailsView) consulta `reviews` direto pelo client do
// Supabase -- devolve o `product_id` do pedido como já avaliado, para o selo
// "Avaliado" aparecer em vez do botão "Avaliar".
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () =>
            Promise.resolve({ data: [{ product_id: "prod-1" }], error: null }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — 'Resumo da Transação' e selo 'Avaliado' usam text-emerald-700 (contraste AA), não mais text-emerald-600", () => {
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
  });

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-financeiro"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    // `checkIfReviewed` (efeito assíncrono) precisa resolver antes de medir.
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("item já avaliado: o selo 'Avaliado' troca de tom", async () => {
    await renderizar();

    // A armadilha precisa estar de fato presente: sem o selo renderizado de
    // verdade (em vez do botão "Avaliar"), o par abaixo não prova nada.
    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const selo = spans.find((el) => el.textContent === "Avaliado");
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("text-emerald-600")).toBe(false);
  });

  it("frete grátis (shipping=0): 'Grátis' na linha de Logística e Envio troca de tom", async () => {
    await renderizar();

    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const valorFrete = spans.find((el) => el.textContent === "Grátis");
    expect(valorFrete).not.toBeUndefined();
    expect(valorFrete?.classList.contains("text-emerald-700")).toBe(true);
    expect(valorFrete?.classList.contains("text-emerald-600")).toBe(false);
  });

  it("com desconto aplicado: a linha 'Benefício / Cupom' troca de tom", async () => {
    await renderizar();

    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const rotulo = spans.find((el) => el.textContent === "Benefício / Cupom");
    expect(rotulo).not.toBeUndefined();
    const linhaDesconto = rotulo?.parentElement;
    expect(linhaDesconto?.classList.contains("text-emerald-700")).toBe(true);
    expect(linhaDesconto?.classList.contains("text-emerald-600")).toBe(false);
  });
});

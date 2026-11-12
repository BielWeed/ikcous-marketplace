// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const usuario = { id: "conta-a" };
const pedido: Order = {
  id: "pedido-avaliacao",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "produto-p",
      name: "Kit canetas",
      price: 20,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 20,
  shipping: 0,
  discount: 0,
  total: 20,
  paymentMethod: "cash",
  status: "delivered",
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-02T12:00:00.000Z",
  cancelledAfterShipping: false,
};
const fetchUserOrders = vi.fn();
type Avaliacao = {
  product_id: string;
  user_id: string;
  status: string;
};
let avaliacoes: Avaliacao[] = [];

function valorDaColuna(linha: Avaliacao, coluna: keyof Avaliacao) {
  switch (coluna) {
    case "product_id":
      return linha.product_id;
    case "user_id":
      return linha.user_id;
    case "status":
      return linha.status;
  }
}

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "reviews") throw new Error(`Tabela inesperada: ${tabela}`);
      return {
        select: () => {
          // Linhas publicadas de terceiros são legíveis pela RLS. O dublê
          // aplica os filtros reais, sem presumir que eq sempre foi chamado.
          let linhas = [...avaliacoes];
          const consulta = {
            eq: (coluna: keyof Avaliacao, valor: string) => {
              linhas = linhas.filter(
                (linha) => valorDaColuna(linha, coluna) === valor,
              );
              return consulta;
            },
            in: (coluna: keyof Avaliacao, valores: string[]) =>
              Promise.resolve({
                data: linhas
                  .filter((linha) =>
                    valores.includes(valorDaColuna(linha, coluna)),
                  )
                  .map(({ product_id }) => ({ product_id })),
                error: null,
              }),
          };
          return consulta;
        },
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Avaliado no pedido só conta a avaliação da pessoa logada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    avaliacoes = [
      { product_id: "produto-p", user_id: "conta-b", status: "published" },
    ];
    fetchUserOrders.mockResolvedValue([pedido]);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.clearAllMocks();
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
    await act(async () => {
      await Promise.resolve();
    });
    const cartao = hospedeiro.querySelector('[data-testid="cartao-avaliacao"]');
    expect(cartao).not.toBeNull();
    return cartao!;
  }

  it("avaliação publicada de outra conta não esconde estrelas nem o botão de escrever", async () => {
    const cartao = await renderizar();

    expect(cartao.textContent).toContain("0 de 1 avaliados");
    expect(cartao.textContent).toContain("Escrever avaliação");
    expect(
      cartao.querySelectorAll('[aria-label*="para Kit canetas"]').length,
    ).toBe(5);
    expect(cartao.textContent).not.toContain("Avaliado");
  });

  it("ao existir também avaliação da própria conta, conta o produto e esconde o botão de escrever", async () => {
    avaliacoes.push({
      product_id: "produto-p",
      user_id: "conta-a",
      status: "published",
    });

    const cartao = await renderizar();

    expect(cartao.textContent).toContain("1 de 1 avaliados");
    expect(cartao.textContent).toContain("Avaliado");
    expect(cartao.textContent).not.toContain("Escrever avaliação");
    expect(
      cartao.querySelectorAll('[aria-label*="para Kit canetas"]').length,
    ).toBe(0);
  });
});

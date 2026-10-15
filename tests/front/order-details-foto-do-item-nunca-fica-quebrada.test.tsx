// @vitest-environment jsdom
//
// Defeito (14/10/2026, caçador de leitura de código no commit 28602766): no
// detalhe do pedido, a foto de cada item era `<img src={item.image}>` sem
// guarda nenhuma. A LISTA de pedidos (OrderList) já mostra um ícone quando o
// item não tem foto, mas o detalhe não: pedido de convidado (a consulta por
// código devolve `oi.image_url` vazio) e produto desativado ficavam com a
// imagem quebrada e o texto alternativo cortado, nos DOIS lugares do detalhe
// onde a foto aparece — o cartão "O que achou da compra?" e o cartão "Itens
// do pedido".
//
// A regra: sem foto, ou foto que dá erro ao carregar, mostra o ícone — nunca
// uma imagem quebrada.
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// pedido-mostra-pagamento-confirmado.test.tsx, cujo dublê de hooks este
// arquivo reaproveita.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedidoBase: Order = {
  id: "pedido-foto",
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
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  status: "delivered",
  paymentStatus: "recebido_na_entrega",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

let pedidoAtual: Order = pedidoBase;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: vi.fn(),
  }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

// Avaliações ligadas e pedido entregue: o cartão "O que achou da compra?"
// também aparece, e é o segundo lugar do detalhe com a foto do item.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, whatsappNumber: "34999999999" },
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

describe("OrderDetailsView — a foto do item nunca fica quebrada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    pedidoAtual = pedidoBase;
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
          orderId="pedido-foto"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const iconesDeSemFoto = () =>
    hospedeiro.querySelectorAll('[data-testid="foto-do-item-sem-imagem"]');

  it("item sem foto (convidado, produto desativado): nenhuma <img> e o ícone nos dois cartões", async () => {
    pedidoAtual = { ...pedidoBase };

    await renderizar();

    expect(
      hospedeiro.querySelector('[data-testid="cartao-avaliacao"]'),
    ).not.toBeNull();
    expect(hospedeiro.querySelectorAll("img")).toHaveLength(0);
    // um ícone no cartão de avaliação e um no cartão "Itens do pedido"
    expect(iconesDeSemFoto()).toHaveLength(2);
  });

  it("item com foto que dá erro ao carregar: troca a imagem pelo ícone, nos dois cartões", async () => {
    pedidoAtual = {
      ...pedidoBase,
      items: [
        {
          ...pedidoBase.items[0],
          image: "https://exemplo.invalid/foto-que-nao-existe.jpg",
        },
      ],
    };

    await renderizar();

    const imagens = Array.from(hospedeiro.querySelectorAll("img"));
    expect(imagens).toHaveLength(2);
    expect(iconesDeSemFoto()).toHaveLength(0);

    await act(async () => {
      for (const img of imagens) img.dispatchEvent(new Event("error"));
    });

    expect(hospedeiro.querySelectorAll("img")).toHaveLength(0);
    expect(iconesDeSemFoto()).toHaveLength(2);
  });

  it("CONTROLE — item com foto boa: continua com a imagem e sem ícone", async () => {
    pedidoAtual = {
      ...pedidoBase,
      items: [
        {
          ...pedidoBase.items[0],
          image: "https://exemplo.invalid/foto-boa.jpg",
        },
      ],
    };

    await renderizar();

    const imagens = Array.from(hospedeiro.querySelectorAll("img"));
    expect(imagens).toHaveLength(2);
    expect(imagens.map((i) => i.getAttribute("src"))).toEqual([
      "https://exemplo.invalid/foto-boa.jpg",
      "https://exemplo.invalid/foto-boa.jpg",
    ]);
    expect(iconesDeSemFoto()).toHaveLength(0);
  });

  it("dois itens, só um sem foto: o ícone aparece só no item sem foto", async () => {
    pedidoAtual = {
      ...pedidoBase,
      items: [
        {
          ...pedidoBase.items[0],
          productId: "prod-1",
          image: "https://exemplo.invalid/foto-boa.jpg",
        },
        {
          ...pedidoBase.items[0],
          productId: "prod-2",
          name: "Saia Teste",
          image: "",
        },
      ],
    };

    await renderizar();

    // 2 cartões x 1 foto boa; 2 cartões x 1 ícone
    expect(hospedeiro.querySelectorAll("img")).toHaveLength(2);
    expect(iconesDeSemFoto()).toHaveLength(2);
  });
});

// @vitest-environment jsdom
//
// Defeito (05/11/2026): "N itens" nos pedidos da cliente contava LINHAS
// (`order.items.length`), enquanto carrinho, checkout e painel contam UNIDADES.
// O mesmo pedido (1 produto, quantidade 3) era "3 itens" antes de pagar e
// "1 item" depois, na lista "Meus Pedidos" e no detalhe do pedido.
//
// A regra: o texto soma as quantidades; o selo "+N" da lista continua contando
// as linhas (é "mais N produtos", não unidades).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: vi.fn().mockResolvedValue(true),
}));

const pedidoBase: Order = {
  id: "pedido-unidades",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 3,
      image: "",
    },
  ],
  subtotal: 300,
  shipping: 0,
  discount: 0,
  total: 300,
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

// Objeto estável: um novo a cada render refaria os efeitos do detalhe sem parar.
const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

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

describe("pedido da cliente — o 'N itens' conta unidades, não linhas", () => {
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

  async function renderizarLista() {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={[pedidoAtual]} onNavigate={() => {}} />);
    });
  }

  async function renderizarDetalhe() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-unidades"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const textoDaPagina = () =>
    (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

  it("lista: 1 linha com quantidade 3 diz '3 itens'", async () => {
    await renderizarLista();
    expect(textoDaPagina()).toContain("3 itens");
    expect(textoDaPagina()).not.toContain("1 item ");
  });

  it("lista: 1 linha com quantidade 1 diz '1 item' (singular)", async () => {
    pedidoAtual = {
      ...pedidoBase,
      items: [{ ...pedidoBase.items[0], quantity: 1 }],
    };
    await renderizarLista();
    expect(textoDaPagina()).toMatch(/1 item ·/);
  });

  it("lista: 2 linhas (2 + 3 unidades) dizem '5 itens' e o selo segue '+1'", async () => {
    pedidoAtual = {
      ...pedidoBase,
      items: [
        { ...pedidoBase.items[0], quantity: 2 },
        {
          ...pedidoBase.items[0],
          productId: "prod-2",
          name: "Calça",
          quantity: 3,
        },
      ],
    };
    await renderizarLista();
    expect(textoDaPagina()).toContain("5 itens");
    expect(textoDaPagina()).toContain("+1");
  });

  it("detalhe: 1 linha com quantidade 3 diz '3 itens'", async () => {
    await renderizarDetalhe();
    expect(textoDaPagina()).toMatch(/Itens do pedido\s*3 itens/);
  });

  it("detalhe: quantidade 1 diz '1 item' (singular)", async () => {
    pedidoAtual = {
      ...pedidoBase,
      items: [{ ...pedidoBase.items[0], quantity: 1 }],
    };
    await renderizarDetalhe();
    expect(textoDaPagina()).toMatch(/Itens do pedido\s*1 item(?!ns)/);
  });
});

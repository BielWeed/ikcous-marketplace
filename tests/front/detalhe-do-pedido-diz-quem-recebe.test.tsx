// @vitest-environment jsdom
//
// Quem comprou para outra pessoa ("Quem vai receber" no endereço) precisa
// conferir, na tela de detalhes do pedido, para quem a entrega vai. A ficha da
// loja, o recibo e a etiqueta já mostravam o nome; o cartão "Endereço de
// entrega" da cliente só mostrava o nome de quem comprou. A linha "Recebe: X"
// segue a mesma regra do recibo (`quemVaiReceberSeForOutro`): só aparece quando
// o nome é de outra pessoa, e retirada na loja e balcão não ganham.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));
const { pedidosDoHook } = vi.hoisted(() => ({
  pedidosDoHook: { lista: [] as unknown[] },
}));
vi.mock("@/hooks/useOrders", () => ({
  ErroCancelamentoNaoConcluido: class extends Error {},
  useOrders: () => ({
    orders: pedidosDoHook.lista,
    ordersLoadError: null,
    fetchUserOrders: () => Promise.resolve(pedidosDoHook.lista),
    updateOrderStatus: vi.fn(),
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-1" }, loading: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, storeAddress: "Rua A, 10" },
  }),
}));

const ID = "11111111-2222-3333-4444-555555555555";

function pedidoBase(
  recipientName?: string,
  overrides: Partial<Order> = {},
): Order {
  return {
    id: ID,
    customer: {
      name: "Cliente Teste",
      whatsapp: "34999999999",
      address: "Rua das Flores",
      number: "100",
      neighborhood: "Centro",
      recipientName,
    },
    items: [
      {
        productId: "p-1",
        name: "Blusa Teste",
        price: 100,
        quantity: 1,
        image: "",
      },
    ],
    subtotal: 100,
    shipping: 15,
    discount: 0,
    total: 115,
    paymentMethod: "pix",
    status: "shipping",
    createdAt: "2026-11-12T10:00:00Z",
    updatedAt: "2026-11-12T10:00:00Z",
    cancelledAfterShipping: false,
    ...overrides,
  } as Order;
}

describe("detalhe do pedido da cliente — diz quem recebe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir(pedido: Order): Promise<HTMLElement> {
    pedidosDoHook.lista = [pedido];
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={ID}
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    return hospedeiro;
  }

  it("compra para outra pessoa: 'Recebe: X' logo abaixo do nome de quem comprou", async () => {
    const tela = await abrir(pedidoBase("  Maria   da Silva "));
    const nome = Array.from(tela.querySelectorAll("p")).find(
      (p) => p.textContent === "Cliente Teste",
    );
    expect(nome).toBeDefined();
    expect(nome?.nextElementSibling?.textContent).toBe(
      "Recebe: Maria da Silva",
    );
  });

  it.each([undefined, "", "   ", "cliente TESTE", "Cliente Téste"])(
    "não repete o comprador nem inventa quem recebe: %j",
    async (recipientName) => {
      const tela = await abrir(pedidoBase(recipientName));
      expect(tela.textContent).toContain("Cliente Teste");
      expect(tela.textContent).not.toContain("Recebe:");
    },
  );

  it("retirada na loja não ganha 'Recebe:' (ninguém recebe em casa)", async () => {
    const tela = await abrir(
      pedidoBase("Maria da Silva", {
        retiradaNaLoja: true,
        enderecoDeRetirada: "Rua da Loja, 1",
      }),
    );
    expect(tela.textContent).toContain("Retire em: Rua da Loja, 1");
    expect(tela.textContent).not.toContain("Recebe:");
  });

  it("compra no balcão não ganha 'Recebe:'", async () => {
    const tela = await abrir(
      pedidoBase("Maria da Silva", {
        canal: "presencial",
        shipping: 0,
        total: 100,
      }),
    );
    expect(tela.textContent).toContain("Compra na loja");
    expect(tela.textContent).not.toContain("Recebe:");
  });
});

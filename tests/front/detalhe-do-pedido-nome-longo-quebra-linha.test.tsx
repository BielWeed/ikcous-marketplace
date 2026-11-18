// @vitest-environment jsdom
//
// Nome longo, sem espaço, no cartão "Endereço de entrega" da cliente não pode
// estourar uma tela estreita (320-360 px): o contêiner já é `min-w-0 flex-1`,
// então basta o nome quebrar palavra (`break-words`), como o endereço logo abaixo.
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

const NOME_LONGO = "Maria".repeat(12); // 60 letras seguidas, sem espaço

describe("detalhe do pedido da cliente — nome e endereço longos quebram linha", () => {
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

  it("o nome de quem comprou (60 letras sem espaço) leva break-words", async () => {
    const pedido = pedidoBase(undefined);
    pedido.customer.name = NOME_LONGO;
    const tela = await abrir(pedido);
    const nome = Array.from(tela.querySelectorAll("p")).find(
      (p) => p.textContent === NOME_LONGO,
    );
    expect(nome, "o nome aparece no cartão de endereço").toBeDefined();
    expect(nome?.classList.contains("break-words")).toBe(true);
  });

  it("as linhas do endereço logo abaixo também quebram palavra longa", async () => {
    const pedido = pedidoBase(undefined);
    pedido.customer.address = "Rua".repeat(30);
    const tela = await abrir(pedido);
    const linhas = Array.from(tela.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Rua".repeat(30)),
    );
    expect(linhas, "o endereço aparece no cartão").toBeDefined();
    expect(linhas?.classList.contains("break-words")).toBe(true);
  });
});

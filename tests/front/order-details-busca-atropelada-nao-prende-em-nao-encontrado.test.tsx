// @vitest-environment jsdom
//
// Caça 13-C #7: a ficha do pedido (sem cópia dele na memória) fica presa em
// "Pedido não encontrado" quando a busca dela é CANCELADA por outra busca
// (volta ao app, reconexão): a cancelada devolve `[]` sem erro, a tela grava
// "não encontrado" e a busca nova só enche a LISTA -- a ficha não a adotava.
// Aqui a ordem de resolução é controlada à mão (promessa em aberto).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedido: Order = {
  id: "pedido-777",
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
  status: "processing",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

const estado = vi.hoisted(() => ({
  lista: [] as unknown[],
  fetchUserOrders: vi.fn(),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: estado.lista,
    fetchUserOrders: estado.fetchUserOrders,
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { whatsappNumber: "34999999999" } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — busca atropelada (13-C #7)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function desenhar(id = "pedido-777") {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={id}
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
  }

  beforeEach(() => {
    estado.lista = [];
    estado.fetchUserOrders.mockReset();
    sessionStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("busca cancelada (devolveu []) e depois a lista recebe o pedido: a ficha o adota", async () => {
    estado.fetchUserOrders.mockResolvedValue([]);
    await desenhar();
    expect(hospedeiro.textContent).toContain("Pedido não encontrado");

    // A busca nova (volta ao app) trouxe o pedido para a lista.
    estado.lista = [pedido];
    await desenhar();

    expect(hospedeiro.textContent).not.toContain("Pedido não encontrado");
    expect(hospedeiro.textContent).toContain("Meu pedido");
  });

  it("pedido que realmente não existe continua 'não encontrado'", async () => {
    estado.fetchUserOrders.mockResolvedValue([]);
    estado.lista = [{ ...pedido, id: "outro-pedido" }];
    await desenhar();
    await desenhar();

    expect(hospedeiro.textContent).toContain("Pedido não encontrado");
  });

  it("busca antiga que termina VAZIA depois de a ficha já ter o pedido não o apaga", async () => {
    let terminar: (v: unknown[]) => void = () => {};
    estado.fetchUserOrders.mockReturnValue(
      new Promise<unknown[]>((r) => {
        terminar = r;
      }),
    );
    await desenhar();
    // Enquanto a busca antiga está em voo, a lista (outra busca) traz o pedido.
    estado.lista = [pedido];
    await desenhar();
    expect(hospedeiro.textContent).toContain("Sincronizando");

    await act(async () => {
      terminar([]);
    });

    expect(hospedeiro.textContent).not.toContain("Pedido não encontrado");
    expect(hospedeiro.textContent).toContain("Meu pedido");
  });

  it("orderId muda para um pedido inexistente: não mostra os dados do pedido anterior", async () => {
    estado.fetchUserOrders.mockResolvedValue([pedido]);
    estado.lista = [pedido];
    await desenhar("pedido-777");
    expect(hospedeiro.textContent).toContain("Meu pedido");

    // Mesmo componente, outro id que não existe em lugar nenhum.
    estado.fetchUserOrders.mockResolvedValue([]);
    await desenhar("pedido-inexistente");
    await act(async () => {
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).toContain("Pedido não encontrado");
    expect(hospedeiro.textContent).not.toContain("Meu pedido");
  });
});

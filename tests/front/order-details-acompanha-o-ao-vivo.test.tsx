// @vitest-environment jsdom
//
// Defeito da cliente (14/10/2026): o detalhe do pedido não acompanhava o ao
// vivo. O realtime atualiza a lista do hook `useOrders`, mas a tela guardava a
// SUA cópia do pedido (preenchida ao abrir e no cancelamento) e nada copiava
// uma para a outra: o PIX era confirmado, o hook recebia `pago`, e a cliente
// seguia vendo "Retomar pagamento" até sair e voltar.
//
// Aqui o hook é um dublê controlável (o que o realtime entregaria) e a tela é
// a de verdade. Cobre: a tela atualiza quando o hook traz um pedido mais novo
// (botão de retomar some quando vira pago); não perde itens/endereço que só a
// abertura trouxe; ignora cópia mais velha e pedido de outro id.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fundirPedidoDoHook } from "@/lib/fundir-pedido-do-hook";
import type { Order } from "@/types";

const ID = "pedido-ao-vivo";

const pedidoAberto: Order = {
  id: ID,
  customer: {
    name: "Cliente Teste",
    whatsapp: "34999999999",
    address: "Rua das Flores",
    number: "123",
  },
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
  paymentMethod: "online",
  paymentStatus: "aguardando",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(1_000).toISOString(),
  cancelledAfterShipping: false,
};

let ordersDoHook: Order[] = [pedidoAberto];
let abertura: Order[] = [pedidoAberto];

// As funções do hook têm identidade ESTÁVEL, como no hook real
// (`useCallback`): `loadOrder` depende de `fetchUserOrders`, e uma função nova
// a cada render o refaria a cada render.
vi.mock("@/hooks/useOrders", () => {
  const fetchUserOrders = async () => abertura;
  const updateOrderStatus = vi.fn();
  return {
    useOrders: () => ({
      orders: ordersDoHook,
      fetchUserOrders,
      updateOrderStatus,
    }),
  };
});

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
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("fundirPedidoDoHook — quando a cópia do hook vale e o que ela nunca apaga", () => {
  const nova = (parcial: Partial<Order>): Order => ({
    ...pedidoAberto,
    updatedAt: new Date(2_000).toISOString(),
    ...parcial,
  });

  it("cópia mais nova: troca status e pagamento", () => {
    const r = fundirPedidoDoHook(
      pedidoAberto,
      nova({ paymentStatus: "pago", status: "processing" }),
    );
    expect(r.paymentStatus).toBe("pago");
    expect(r.status).toBe("processing");
  });

  it("cópia com a mesma data: devolve a MESMA referência (nada renderiza de novo)", () => {
    const r = fundirPedidoDoHook(
      pedidoAberto,
      nova({ updatedAt: pedidoAberto.updatedAt, paymentStatus: "pago" }),
    );
    expect(r).toBe(pedidoAberto);
  });

  it("cópia mais velha: não desfaz o que a tela já sabe", () => {
    const r = fundirPedidoDoHook(
      pedidoAberto,
      nova({ updatedAt: new Date(500).toISOString(), paymentStatus: "pago" }),
    );
    expect(r).toBe(pedidoAberto);
  });

  it("data ilegível na cópia do hook: não funde", () => {
    const r = fundirPedidoDoHook(
      pedidoAberto,
      nova({ updatedAt: "isso-nao-e-data", paymentStatus: "pago" }),
    );
    expect(r).toBe(pedidoAberto);
  });

  it("cópia nova sem itens nem endereço: mantém os da tela", () => {
    const r = fundirPedidoDoHook(
      pedidoAberto,
      nova({
        items: [],
        customer: { name: "Cliente Teste", whatsapp: "34999999999" },
        paymentStatus: "pago",
      }),
    );
    expect(r.paymentStatus).toBe("pago");
    expect(r.items).toEqual(pedidoAberto.items);
    expect(r.customer.address).toBe("Rua das Flores");
  });

  it("campo undefined na cópia nova não apaga o que a tela tem", () => {
    const comRastreio = { ...pedidoAberto, trackingCode: "BR123" };
    const r = fundirPedidoDoHook(
      comRastreio,
      nova({ trackingCode: undefined, paymentStatus: "pago" }),
    );
    expect(r.trackingCode).toBe("BR123");
    expect(r.paymentStatus).toBe("pago");
  });
});

describe("OrderDetailsView — acompanha o pedido ao vivo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    ordersDoHook = [pedidoAberto];
    abertura = [pedidoAberto];
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

  async function montar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    const desenhar = () => (
      <OrderDetailsView
        orderId={ID}
        onBack={() => {}}
        onNavigate={() => {}}
        onRetomarPagamento={() => {}}
      />
    );
    await act(async () => {
      raiz.render(desenhar());
    });
    await act(async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    /** O que o realtime faz: troca a lista do hook e a tela re-renderiza. */
    return async (novaLista: Order[]) => {
      ordersDoHook = novaLista;
      await act(async () => {
        raiz.render(desenhar());
      });
      await act(async () => {
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
    };
  }

  const texto = () => hospedeiro.textContent ?? "";
  const botaoRetomar = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Retomar pagamento"),
    );

  it("PIX confirmado pelo realtime: o 'Retomar pagamento' some e o texto vira 'confirmado'", async () => {
    const aoVivo = await montar();
    expect(botaoRetomar()).toBeDefined();
    expect(texto()).toContain("Aguardando pagamento");

    await aoVivo([
      {
        ...pedidoAberto,
        paymentStatus: "pago",
        updatedAt: new Date(2_000).toISOString(),
      },
    ]);

    expect(botaoRetomar()).toBeUndefined();
    expect(texto()).toContain("Pagamento confirmado");
    expect(texto()).not.toContain("Aguardando pagamento");
  });

  it("status que avança pelo realtime: a tela acompanha", async () => {
    const aoVivo = await montar();
    expect(texto()).toContain("Pedido recebido");

    await aoVivo([
      {
        ...pedidoAberto,
        paymentStatus: "pago",
        status: "processing",
        updatedAt: new Date(2_000).toISOString(),
      },
    ]);

    expect(texto()).toContain("Em separação");
  });

  it("a linha do realtime sem itens nem endereço não esvazia a tela", async () => {
    const aoVivo = await montar();
    expect(texto()).toContain("Blusa Teste");

    await aoVivo([
      {
        ...pedidoAberto,
        items: [],
        customer: { name: "Cliente Teste", whatsapp: "34999999999" },
        paymentStatus: "pago",
        updatedAt: new Date(2_000).toISOString(),
      },
    ]);

    expect(texto()).toContain("Pagamento confirmado");
    expect(texto()).toContain("Blusa Teste");
    expect(texto()).toContain("Rua das Flores");
  });

  it("lista do hook mais velha não desfaz a tela", async () => {
    const aoVivo = await montar();

    await aoVivo([
      {
        ...pedidoAberto,
        paymentStatus: "recusado",
        updatedAt: new Date(10).toISOString(),
      },
    ]);

    expect(texto()).toContain("Aguardando pagamento");
    expect(botaoRetomar()).toBeDefined();
  });

  it("mudança de OUTRO pedido na lista não mexe nesta tela", async () => {
    const aoVivo = await montar();

    await aoVivo([
      pedidoAberto,
      {
        ...pedidoAberto,
        id: "outro-pedido",
        paymentStatus: "pago",
        status: "delivered",
        updatedAt: new Date(9_000).toISOString(),
      },
    ]);

    expect(texto()).toContain("Aguardando pagamento");
    expect(botaoRetomar()).toBeDefined();
  });
});

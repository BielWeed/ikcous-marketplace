// @vitest-environment jsdom
//
// Rodada 21 (lote C2), achado C: pedido ENTREGUE com um item sem produto
// vinculado (`productId` vazio — o produto foi apagado do catálogo, o mapper
// grava `item.product_id || ""`) mostrava estrelas para um item que não dá para
// avaliar: publicar falha sempre, e o id vazio entrava na consulta "quais já
// avaliei". Agora o item órfão não ganha estrelas e o id vazio nunca vai à
// consulta; pedido SÓ com itens órfãos não mostra o cartão de avaliação.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const fetchUserOrders = vi.fn();
const consultasDeAvaliacao: string[][] = [];

const item = (productId: string, name: string) => ({
  productId,
  name,
  price: 50,
  quantity: 1,
  image: "",
});

const pedidoComOrfao: Order = {
  id: "pedido-orfao",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    item("prod-1", "Camisa"),
    item("", "Item sem produto"),
    item("prod-2", "Calça"),
  ],
  subtotal: 150,
  shipping: 0,
  discount: 0,
  total: 150,
  paymentMethod: "cash",
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};
const pedidoSoOrfaos: Order = {
  ...pedidoComOrfao,
  id: "pedido-so-orfaos",
  items: [item("", "Só órfão")],
};

let pedidoDaVez: Order = pedidoComOrfao;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoDaVez],
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
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: (_coluna: string, ids: string[]) => {
            consultasDeAvaliacao.push([...ids]);
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — item sem produto vinculado não vira estrela (C2-C)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function abrir(pedido: Order) {
    pedidoDaVez = pedido;
    fetchUserOrders.mockResolvedValue([pedido]);
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
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  const estrelasDe = (nome: string) =>
    [...hospedeiro.querySelectorAll("button")].filter((b) =>
      b.getAttribute("aria-label")?.endsWith(`para ${nome}`),
    );

  beforeEach(() => {
    consultasDeAvaliacao.length = 0;
    fetchUserOrders.mockReset();
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

  it("o órfão entre dois itens não ganha estrelas; os outros dois ganham", async () => {
    await abrir(pedidoComOrfao);

    expect(
      hospedeiro.querySelector('[data-testid="cartao-avaliacao"]'),
    ).not.toBeNull();
    expect(estrelasDe("Camisa")).toHaveLength(5);
    expect(estrelasDe("Calça")).toHaveLength(5);
    expect(estrelasDe("Item sem produto")).toHaveLength(0);
    // O contador não conta o órfão: são 2 produtos avaliáveis.
    expect(hospedeiro.textContent).toMatch(/0 de 2\s*avaliados/);
  });

  it("o id vazio nunca vai à consulta de avaliações já feitas", async () => {
    await abrir(pedidoComOrfao);

    expect(consultasDeAvaliacao.length).toBeGreaterThan(0);
    for (const ids of consultasDeAvaliacao) {
      expect(ids).not.toContain("");
      expect(ids.sort()).toEqual(["prod-1", "prod-2"]);
    }
  });

  it("pedido só com itens sem produto: sem cartão de avaliação e sem consulta", async () => {
    await abrir(pedidoSoOrfaos);

    expect(
      hospedeiro.querySelector('[data-testid="cartao-avaliacao"]'),
    ).toBeNull();
    expect(hospedeiro.textContent).not.toContain("O que achou da compra?");
    expect(estrelasDe("Só órfão")).toHaveLength(0);
    expect(consultasDeAvaliacao).toHaveLength(0);
    // A tela do pedido em si abriu (âncora).
    expect(hospedeiro.textContent).not.toContain("Pedido não encontrado");
  });
});

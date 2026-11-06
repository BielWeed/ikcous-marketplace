// @vitest-environment jsdom
//
// Pedido ENTREGUE com um produto que a loja excluiu (ou pausou): o item
// continua com `productId` (a exclusão é soft-delete), mas a consulta do
// pedido não devolve o produto (a regra de leitura só mostra produto ativo) e
// o mapper marca `productVisible: false`. Convidar a cliente a avaliar um
// produto que não está mais à venda é um convite que não leva a lugar nenhum:
// o item não ganha estrelas, não conta no "x de y avaliados", e pedido só com
// itens assim não mostra o cartão. Item sem a marca (consulta sem o join, ou
// produto à venda) avalia como sempre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const fetchUserOrders = vi.fn();
const consultasDeAvaliacao: string[][] = [];

const item = (productId: string, name: string, productVisible?: boolean) => ({
  productId,
  name,
  price: 50,
  quantity: 1,
  image: "",
  ...(productVisible === undefined ? {} : { productVisible }),
});

const pedidoComExcluido: Order = {
  id: "pedido-excluido",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    item("prod-1", "Camisa", true),
    item("prod-9", "Produto excluído", false),
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
const pedidoSoExcluidos: Order = {
  ...pedidoComExcluido,
  id: "pedido-so-excluidos",
  items: [item("prod-9", "Só excluído", false)],
};

let pedidoDaVez: Order = pedidoComExcluido;

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

describe("OrderDetailsView — produto excluído não convida a avaliar", () => {
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

  it("o produto excluído entre dois à venda não ganha estrelas; os outros dois ganham", async () => {
    await abrir(pedidoComExcluido);

    expect(
      hospedeiro.querySelector('[data-testid="cartao-avaliacao"]'),
    ).not.toBeNull();
    expect(estrelasDe("Camisa")).toHaveLength(5);
    expect(estrelasDe("Calça")).toHaveLength(5);
    expect(estrelasDe("Produto excluído")).toHaveLength(0);
    // O contador não conta o excluído: são 2 produtos avaliáveis.
    expect(hospedeiro.textContent).toMatch(/0 de 2\s*avaliados/);
    // O item continua na lista "Itens do pedido" (a compra aconteceu).
    expect(hospedeiro.textContent).toContain("Produto excluído");
  });

  it("pedido só com produtos excluídos: sem cartão de avaliação", async () => {
    await abrir(pedidoSoExcluidos);

    expect(
      hospedeiro.querySelector('[data-testid="cartao-avaliacao"]'),
    ).toBeNull();
    expect(hospedeiro.textContent).not.toContain("O que achou da compra?");
    expect(estrelasDe("Só excluído")).toHaveLength(0);
    // A tela do pedido em si abriu (âncora), com o item listado.
    expect(hospedeiro.textContent).not.toContain("Pedido não encontrado");
    expect(hospedeiro.textContent).toContain("Só excluído");
  });
});

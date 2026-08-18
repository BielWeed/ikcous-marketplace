// @vitest-environment jsdom
//
// PEDIDO-060 (#105) — quem compra precisa ver o código de rastreio.
//
// Até 18/08/2026 o rastreio existia só na metade da lojista: ela digitava o
// código no painel (OrderDetail.tsx, bloco "Logística & Rastreio") e o campo
// viajava do banco até o objeto Order no front (mappers.ts:238) — mas NENHUMA
// tela do cliente o renderizava. Quem comprou tinha que pedir por WhatsApp.
//
// Isso deixou de ser detalhe em 18/08/2026: o carrinho prometia "código de
// rastreio automático" e a promessa saiu do ar por ser falsa. Mostrar o código
// que a lojista de fato digita é a metade que dá para cumprir de verdade.
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// order-details-gate-avaliacoes.test.tsx, cujo dublê de hooks este arquivo
// reaproveita.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedidoBase: Order = {
  id: "pedido-105",
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
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  status: "shipping",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
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

describe("OrderDetailsView — código de rastreio para quem comprou (#105)", () => {
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
          orderId="pedido-105"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("com código preenchido, o cliente vê o código na tela", async () => {
    pedidoAtual = { ...pedidoBase, trackingCode: "AA123456789BR" };

    await renderizar();

    expect(hospedeiro.textContent).toContain("AA123456789BR");
  });

  it("oferece copiar o código e um link para rastrear fora do app", async () => {
    pedidoAtual = { ...pedidoBase, trackingCode: "AA123456789BR" };

    await renderizar();

    const botaoCopiar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.getAttribute("title")?.toLowerCase().includes("copiar"),
    );
    expect(botaoCopiar).toBeDefined();

    const link = [...hospedeiro.querySelectorAll("a")].find((a) =>
      a.getAttribute("href")?.includes("linkrastreio.com"),
    );
    expect(link?.getAttribute("href")).toContain("AA123456789BR");
    // Aba nova sem dar ao site de destino acesso à janela do app.
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("pedido SEM código não mostra bloco vazio nem a palavra undefined", async () => {
    pedidoAtual = { ...pedidoBase, trackingCode: undefined };

    await renderizar();

    const texto = hospedeiro.textContent ?? "";
    // A âncora: a tela renderizou mesmo (senão as ausências abaixo são vazias).
    expect(texto).toContain("Blusa Teste");
    expect(texto).not.toContain("undefined");
    expect(texto).not.toContain("Código de Rastreio");
  });

  it("código só com espaços conta como ausente", async () => {
    // O campo do admin é texto livre: salvar e apagar deixa string vazia ou
    // espaços, e um bloco "Código de Rastreio:" em branco é pior que nenhum.
    pedidoAtual = { ...pedidoBase, trackingCode: "   " };

    await renderizar();

    expect(hospedeiro.textContent).not.toContain("Código de Rastreio");
  });
});

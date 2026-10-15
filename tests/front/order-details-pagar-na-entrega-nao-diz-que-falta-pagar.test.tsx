// @vitest-environment jsdom
//
// Defeito (14/10/2026, caçador de leitura de código no commit 28602766):
// pedido para PAGAR NA ENTREGA (e retirada paga na loja) mostrava no cartão
// grande "Aguardando confirmação de pagamento para iniciar a separação". Só
// que a compra "na entrega" grava `payment_status` nulo (RPC v23) — não há
// cobrança online nenhuma para confirmar — e a frase mandava a cliente achar
// que faltava pagar algo no app. `pendingDescription` só conhecia pago /
// recusado / expirado / estornado; o nulo ("sem cobrança") caía no texto fixo.
//
// A regra: pedido SEM cobrança online (`payment_status` nulo e forma de
// pagamento que não é "online") nunca diz que falta pagar. O pagamento online
// pendente (`aguardando`) continua com a frase de sempre.
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// pedido-mostra-pagamento-confirmado.test.tsx, cujo dublê de hooks este
// arquivo reaproveita.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const FRASE_ANTIGA = "Aguardando confirmação de pagamento";

const pedidoBase: Order = {
  id: "pedido-na-entrega",
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
  paymentMethod: "cash",
  status: "pending",
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

describe("OrderDetailsView — pedido sem cobrança online não diz que falta pagar", () => {
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
          orderId="pedido-na-entrega"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function descricaoDoCartaoDeStatus(): string {
    return (
      hospedeiro.querySelector('[data-testid="cartao-status"] p')
        ?.textContent ?? ""
    );
  }

  it("pagar na entrega (dinheiro, status nulo): diz que a loja separa e que paga na entrega", async () => {
    pedidoAtual = { ...pedidoBase, paymentMethod: "cash", paymentStatus: null };

    await renderizar();

    expect(descricaoDoCartaoDeStatus()).toBe(
      "Recebemos seu pedido. A loja vai separar e você paga na entrega.",
    );
    expect(hospedeiro.textContent).not.toContain(FRASE_ANTIGA);
  });

  it("pagar na entrega no cartão ou no PIX, com status ausente: mesma frase", async () => {
    for (const forma of ["card", "pix"] as const) {
      pedidoAtual = { ...pedidoBase, paymentMethod: forma };

      await renderizar();

      expect(descricaoDoCartaoDeStatus()).toBe(
        "Recebemos seu pedido. A loja vai separar e você paga na entrega.",
      );
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
    }
  });

  it("retirada na loja com pagamento na loja: fala em pagar na hora de retirar, nunca em pagar para iniciar a separação", async () => {
    pedidoAtual = {
      ...pedidoBase,
      paymentMethod: "cash",
      paymentStatus: null,
      retiradaNaLoja: true,
      enderecoDeRetirada: "Rua da Loja, 10 - Centro",
    };

    await renderizar();

    expect(descricaoDoCartaoDeStatus()).toBe(
      "Recebemos seu pedido. A loja vai separar e você paga na loja, na hora de retirar.",
    );
    expect(hospedeiro.textContent).not.toContain(FRASE_ANTIGA);
  });

  it("CONTROLE — pagamento online aguardando: continua com a frase de aguardar a confirmação", async () => {
    pedidoAtual = {
      ...pedidoBase,
      paymentMethod: "online",
      paymentStatus: "aguardando",
    };

    await renderizar();

    expect(descricaoDoCartaoDeStatus()).toBe(
      "Aguardando confirmação de pagamento para iniciar a separação.",
    );
  });

  it("CONTROLE — pagamento online sem status (dado incompleto): não ganha a frase de pagar na entrega", async () => {
    pedidoAtual = {
      ...pedidoBase,
      paymentMethod: "online",
      paymentStatus: null,
    };

    await renderizar();

    expect(descricaoDoCartaoDeStatus()).not.toContain("paga na entrega");
    expect(descricaoDoCartaoDeStatus()).not.toContain("você paga");
  });

  it("CONTROLE — pagar na entrega JÁ confirmada pela loja: continua 'Pagamento confirmado'", async () => {
    pedidoAtual = {
      ...pedidoBase,
      paymentMethod: "cash",
      paymentStatus: "recebido_na_entrega",
    };

    await renderizar();

    expect(descricaoDoCartaoDeStatus()).toBe(
      "Pagamento confirmado. A loja vai iniciar a separação.",
    );
  });
});

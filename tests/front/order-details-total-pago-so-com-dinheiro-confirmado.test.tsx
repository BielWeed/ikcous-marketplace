// @vitest-environment jsdom
//
// BLOQUEIA B1 (revisor Opus, rodada 2 do redesenho, 25/09/2026): o cartão
// "Resumo" mostrava "Total pago" sempre que `order.status !== "cancelled"` —
// inclusive para PIX `pending`+`aguardando` (ninguém pagou nada ainda),
// `recusado`, `expirado`, `estornado`, e pagamento na entrega ainda NÃO
// confirmado. Isso é uma afirmação falsa sobre dinheiro: a tela dizia "pago"
// para um pedido que pode nem ter sido cobrado.
//
// A regra correta: "Total pago" só quando o dinheiro de fato ENTROU
// (`paymentStatusKey` devolve `pago`, `pago_apos_expirar` ou
// `recebido_na_entrega`) E o pedido não está cancelado — cancelado nunca
// afirma "pago" aqui, mesmo com dinheiro confirmado (quem conta essa
// história é a descrição do cartão de status e a linha de devolução, não o
// rótulo do total). Em qualquer outro caso, o rótulo é só "Total".
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// pedido-mostra-pagamento-confirmado.test.tsx, cujo dublê de hooks este
// arquivo reaproveita.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, PaymentStatus } from "@/types";

const pedidoBase: Order = {
  id: "pedido-total",
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

function pedidoCom(
  status: Order["status"],
  paymentStatus: PaymentStatus | null | undefined,
): Order {
  return { ...pedidoBase, status, paymentStatus };
}

describe("OrderDetailsView — o rótulo do total só diz 'pago' quando o dinheiro entrou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
          orderId="pedido-total"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  /** O rótulo do total é o único `span` cujo texto é exatamente "Total" ou
   * "Total pago" — os dois nunca coexistem na mesma renderização. */
  function rotuloDoTotal(): string | undefined {
    return Array.from(hospedeiro.querySelectorAll("span"))
      .map((el) => el.textContent ?? "")
      .find((t) => t === "Total" || t === "Total pago");
  }

  it("pending + aguardando: 'Total' — ninguém pagou nada ainda", async () => {
    pedidoAtual = pedidoCom("pending", "aguardando");

    await renderizar();

    expect(rotuloDoTotal()).toBe("Total");
  });

  it("pending + recusado: 'Total' — o pagamento não foi aprovado", async () => {
    pedidoAtual = pedidoCom("pending", "recusado");

    await renderizar();

    expect(rotuloDoTotal()).toBe("Total");
  });

  it("pending + nulo (sem cobrança online): 'Total'", async () => {
    pedidoAtual = pedidoCom("pending", null);

    await renderizar();

    expect(rotuloDoTotal()).toBe("Total");
  });

  it("shipping + pago: 'Total pago' — o dinheiro já entrou e o produto já saiu", async () => {
    pedidoAtual = pedidoCom("shipping", "pago");

    await renderizar();

    expect(rotuloDoTotal()).toBe("Total pago");
  });

  it("processing + recebido_na_entrega: 'Total pago' — a loja confirmou o recebimento", async () => {
    pedidoAtual = pedidoCom("processing", "recebido_na_entrega");

    await renderizar();

    expect(rotuloDoTotal()).toBe("Total pago");
  });

  it("cancelled + pago: 'Total' — cancelado nunca afirma 'pago' aqui, mesmo com dinheiro confirmado", async () => {
    pedidoAtual = pedidoCom("cancelled", "pago");

    await renderizar();

    expect(rotuloDoTotal()).toBe("Total");
  });

  it("cancelled + aguardando: 'Total' (controle — cancelado e nunca pago)", async () => {
    pedidoAtual = pedidoCom("cancelled", "aguardando");

    await renderizar();

    expect(rotuloDoTotal()).toBe("Total");
  });
});

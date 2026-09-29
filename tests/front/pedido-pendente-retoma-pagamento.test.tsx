// @vitest-environment jsdom
//
// FRETE 10 (frente 10 da missão de pagamentos, 29/09/2026) — retomada do
// pagamento a partir do card do pedido.
//
// Relato do Gabriel: o cliente inicia o pagamento, sai sem concluir (engano
// ou interrupção), volta ao card do pedido pendente e NÃO CONSEGUE abrir de
// novo para terminar de pagar. Causa raiz (diagnóstico em código): o
// `orderId`/`aguardandoPagamento` do checkout vivem em `useState` do
// CheckoutView — morrem quando a tela desmonta — e o OrderDetailsView não
// oferece NENHUMA ação de pagamento (só WhatsApp). O backend já retoma com
// segurança (mesmo QR na reconsulta; cobrança nova com chave nova quando a
// anterior morreu; 409 terminal quando o pedido não é mais cobrável) — o que
// falta é a porta da frente.
//
// Este teste prende a porta: o botão "Retomar pagamento" existe EXATAMENTE
// para pedido `pending` + `paymentStatus 'aguardando'` + usuário logado
// (P6: convidado não paga online), e chama `onRetomarPagamento` com o id do
// pedido. Todos os estados onde retomar seria errado ficam sem o botão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, PaymentStatus } from "@/types";

const pedidoBase: Order = {
  id: "pedido-retomar",
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
let usuarioAtual: { id: string } | null = { id: "user-1" };
const onRetomarPagamento = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual }),
}));

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

function botaoRetomar(hospedeiro: HTMLDivElement) {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Retomar pagamento"),
  );
}

describe("OrderDetailsView — retomada do pagamento pelo card do pedido pendente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    onRetomarPagamento.mockClear();
    pedidoAtual = { ...pedidoBase, status: "pending" };
    usuarioAtual = { id: "user-1" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-retomar"
          onBack={() => {}}
          onNavigate={() => {}}
          onRetomarPagamento={onRetomarPagamento}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("pending + aguardando + logado: botão existe e chama onRetomarPagamento com o id do pedido", async () => {
    pedidoAtual = {
      ...pedidoBase,
      status: "pending",
      paymentStatus: "aguardando" as PaymentStatus,
    };
    await renderizar();

    const botao = botaoRetomar(hospedeiro);
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onRetomarPagamento).toHaveBeenCalledTimes(1);
    expect(onRetomarPagamento).toHaveBeenCalledWith("pedido-retomar");
  });

  it("pending + recusado: botão EXISTE (cobrança morta — a edge cria outra com segurança; revisão da frente 10)", async () => {
    pedidoAtual = {
      ...pedidoBase,
      status: "pending",
      paymentStatus: "recusado" as PaymentStatus,
    };
    await renderizar();

    const botao = botaoRetomar(hospedeiro);
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onRetomarPagamento).toHaveBeenCalledWith("pedido-retomar");
  });

  it("pending + pago: SEM botão (não há o que retomar)", async () => {
    pedidoAtual = {
      ...pedidoBase,
      status: "pending",
      paymentStatus: "pago" as PaymentStatus,
    };
    await renderizar();
    expect(botaoRetomar(hospedeiro)).toBeUndefined();
  });

  it("pending + expirado: SEM botão (o prazo morreu — o texto da tela já manda falar com a loja)", async () => {
    pedidoAtual = {
      ...pedidoBase,
      status: "pending",
      paymentStatus: "expirado" as PaymentStatus,
    };
    await renderizar();
    expect(botaoRetomar(hospedeiro)).toBeUndefined();
  });

  it("cancelled + aguardando: SEM botão (pedido morto — pagar não entregaria)", async () => {
    pedidoAtual = {
      ...pedidoBase,
      status: "cancelled",
      paymentStatus: "aguardando" as PaymentStatus,
    };
    await renderizar();
    expect(botaoRetomar(hospedeiro)).toBeUndefined();
  });

  it("pending + aguardando + SEM usuário (rastreio de convidado): SEM botão (P6 — online exige conta)", async () => {
    usuarioAtual = null;
    pedidoAtual = {
      ...pedidoBase,
      status: "pending",
      paymentStatus: "aguardando" as PaymentStatus,
    };
    await renderizar();
    expect(botaoRetomar(hospedeiro)).toBeUndefined();
  });
});

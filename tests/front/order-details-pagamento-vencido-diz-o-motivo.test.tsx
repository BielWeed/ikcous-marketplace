// @vitest-environment jsdom
//
// Defeito da cliente (14/10/2026): o pedido cuja reserva de 30 minutos
// venceu é cancelado pelo cron (`status='cancelled'` + `payment_status=
// 'expirado'`) e o detalhe só dizia "foi cancelado e não seguirá para
// entrega" — sem dizer o motivo. Quem apenas demorou para pagar achava que a
// loja cancelou, e não havia caminho óbvio para comprar de novo.
//
// Agora o pedido cancelado por vencimento diz que o prazo terminou, que é só
// comprar de novo, e leva à vitrine pelo mesmo `onNavigate("home")` das outras
// telas de fim de compra. Os demais cancelados ficam como estavam.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, OrderStatus, PaymentStatus } from "@/types";

const pedidoBase: Order = {
  id: "pedido-vencido",
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
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  status: "cancelled",
  paymentStatus: "expirado",
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

const FRASE_DO_VENCIMENTO =
  "O prazo do pagamento terminou e o pedido foi cancelado. É só comprar de novo.";
const FRASE_GENERICA = "Este pedido foi cancelado e não seguirá para entrega.";

describe("OrderDetailsView — pedido cancelado porque o pagamento venceu diz o motivo", () => {
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

  async function renderizar(
    status: OrderStatus,
    pagamento: PaymentStatus | null,
    onNavigate: (view: string) => void = () => {},
  ) {
    pedidoAtual = { ...pedidoBase, status, paymentStatus: pagamento };
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-vencido"
          onBack={() => {}}
          onNavigate={onNavigate}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
  }

  const texto = () => hospedeiro.textContent ?? "";
  const botaoDaLoja = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Voltar para a loja"),
    );

  it("cancelado + expirado: explica o vencimento e o botão leva à vitrine", async () => {
    const onNavigate = vi.fn();

    await renderizar("cancelled", "expirado", onNavigate);

    expect(texto()).toContain(FRASE_DO_VENCIMENTO);
    expect(texto()).not.toContain(FRASE_GENERICA);

    const botao = botaoDaLoja();
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  const controles: Array<{
    nome: string;
    status: OrderStatus;
    pagamento: PaymentStatus | null;
    frase: string;
  }> = [
    {
      nome: "cancelado sem cobrança online (a frase genérica de sempre)",
      status: "cancelled",
      pagamento: null,
      frase: FRASE_GENERICA,
    },
    {
      nome: "cancelado + recusado (a frase genérica de sempre)",
      status: "cancelled",
      pagamento: "recusado",
      frase: FRASE_GENERICA,
    },
    {
      nome: "cancelado + aguardando (o aviso 'não pague' de sempre)",
      status: "cancelled",
      pagamento: "aguardando",
      frase: "não pague — o pedido não será entregue",
    },
  ];

  it.each(controles)(
    "$nome: não ganha o texto nem o botão do vencimento",
    async ({ status, pagamento, frase }) => {
      await renderizar(status, pagamento);

      expect(texto()).toContain(frase);
      expect(texto()).not.toContain(FRASE_DO_VENCIMENTO);
      expect(botaoDaLoja()).toBeUndefined();
    },
  );

  it("pedido pendente com pagamento vencido (ainda não cancelado): não mostra o botão de vitrine", async () => {
    await renderizar("pending", "expirado");

    expect(texto()).not.toContain(FRASE_DO_VENCIMENTO);
    expect(botaoDaLoja()).toBeUndefined();
  });
});

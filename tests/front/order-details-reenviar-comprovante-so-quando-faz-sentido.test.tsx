// @vitest-environment jsdom
//
// Defeito (14/10/2026, caçador de leitura de código no commit 28602766): o
// botão "Reenviar comprovante" do detalhe do pedido aparecia em TODO pedido. A
// edge `send-order-confirmation` não olha o status do pedido e a reserva do
// e-mail (`reivindicar_email_de_confirmacao`) vale UMA vez por pedido. Com o
// PIX online ainda aguardando, tocar no botão gastava essa única vaga com o
// e-mail "aguardando a confirmação do pagamento" (a edge monta esse texto
// sempre que a forma é `online` e o pagamento não é `pago`), e depois o e-mail
// de "pagamento confirmado" e o aviso de "pagamento depois do cancelamento"
// nunca mais saíam. E quem já tinha recebido só ouvia "já foi enviado".
//
// A regra do botão (só no app; a edge não muda): aparece quando o e-mail que a
// edge mandaria é o comprovante de verdade — pagamento ONLINE já confirmado
// (`pago`), ou compra que não é cobrança online (pagar na entrega/retirada,
// com `payment_status` nulo ou `recebido_na_entrega`). Pagamento online
// aguardando, recusado, expirado, estornado ou pago depois de expirar NÃO
// mostra o botão. Conservador de propósito: forma de entrega com status de
// cobrança online ("aguardando", etc.) também esconde.
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// pedido-mostra-pagamento-confirmado.test.tsx, cujo dublê de hooks este
// arquivo reaproveita.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, PaymentMethod, PaymentStatus } from "@/types";

const pedidoBase: Order = {
  id: "pedido-comprovante",
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
  paymentMethod: "online",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

let pedidoAtual: Order = pedidoBase;

const reenviarComprovante = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: vi.fn(),
    reenviarComprovante,
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

type Caso = [
  descricao: string,
  forma: PaymentMethod,
  pagamento: PaymentStatus | null,
  status: Order["status"],
  aparece: boolean,
];

const CASOS: Caso[] = [
  // O e-mail que sairia é o comprovante de verdade: o botão aparece.
  ["online + pago", "online", "pago", "pending", true],
  ["online + pago, já em separação", "online", "pago", "processing", true],
  ["online + pago, entregue", "online", "pago", "delivered", true],
  ["pagar na entrega (dinheiro, sem cobrança)", "cash", null, "pending", true],
  ["pagar na entrega (cartão, sem cobrança)", "card", null, "pending", true],
  ["pagar na entrega (PIX, sem cobrança)", "pix", null, "processing", true],
  [
    "pagar na entrega, recebido pela loja",
    "cash",
    "recebido_na_entrega",
    "delivered",
    true,
  ],
  ["pagar na entrega, cancelado", "cash", null, "cancelled", true],
  // Pagamento online que NÃO é `pago`: o e-mail sairia como "aguardando" e
  // gastaria a única vaga — o botão some.
  ["online + aguardando", "online", "aguardando", "pending", false],
  ["online + recusado", "online", "recusado", "pending", false],
  ["online + expirado", "online", "expirado", "cancelled", false],
  ["online + estornado", "online", "estornado", "cancelled", false],
  [
    "online + pago depois de expirar",
    "online",
    "pago_apos_expirar",
    "cancelled",
    false,
  ],
  [
    "online + aguardando, cancelado pela cliente",
    "online",
    "aguardando",
    "cancelled",
    false,
  ],
  [
    "online sem status de pagamento (dado incompleto)",
    "online",
    null,
    "pending",
    false,
  ],
  [
    "online + recebido na entrega (combinação que não existe)",
    "online",
    "recebido_na_entrega",
    "pending",
    false,
  ],
  // Conservador: forma de entrega com status de cobrança online.
  [
    "entrega + aguardando (combinação estranha)",
    "cash",
    "aguardando",
    "pending",
    false,
  ],
  [
    "entrega + recusado (combinação estranha)",
    "card",
    "recusado",
    "pending",
    false,
  ],
];

describe("OrderDetailsView — 'Reenviar comprovante' só aparece quando reenviar faz sentido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    pedidoAtual = pedidoBase;
    reenviarComprovante.mockReset();
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
          orderId="pedido-comprovante"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const botaoDoComprovante = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Reenviar comprovante"),
    );

  it.each(CASOS)(
    "%s",
    async (_descricao, forma, pagamento, status, aparece) => {
      pedidoAtual = {
        ...pedidoBase,
        paymentMethod: forma,
        paymentStatus: pagamento,
        status,
      };

      await renderizar();

      expect(botaoDoComprovante() !== undefined).toBe(aparece);
    },
  );

  it("o botão que aparece continua funcionando: toca e pede o reenvio do pedido certo", async () => {
    pedidoAtual = {
      ...pedidoBase,
      paymentMethod: "online",
      paymentStatus: "pago",
    };
    reenviarComprovante.mockResolvedValue({ ok: true });

    await renderizar();
    await act(async () => {
      botaoDoComprovante()?.click();
    });

    expect(reenviarComprovante).toHaveBeenCalledTimes(1);
    expect(reenviarComprovante).toHaveBeenCalledWith("pedido-comprovante");
  });
});

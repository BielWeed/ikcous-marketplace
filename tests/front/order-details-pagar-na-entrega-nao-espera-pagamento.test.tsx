// @vitest-environment jsdom
//
// Defeito da cliente (14/10/2026): quem escolhe pagar NA ENTREGA ou NA
// RETIRADA tem o pedido gravado sem cobrança online (`payment_status` nulo,
// que o app lê como `sem_cobranca`). O detalhe do pedido caía no texto padrão
// do `pending` — "Aguardando confirmação de pagamento para iniciar a
// separação" — e a cliente ficava esperando um pagamento que nunca vai
// acontecer no app. Quem paga pelo app (PIX/cartão) continua lendo o texto
// de sempre.
//
// RENDER DE VERDADE: o texto é decidido dentro da tela, não em função
// exportada; o dublê é só dos hooks de dados (mesmo padrão de
// order-details-total-pago-so-com-dinheiro-confirmado.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, PaymentMethod, PaymentStatus } from "@/types";

const pedidoBase: Order = {
  id: "pedido-na-mao",
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

const ESPERA_PAGAMENTO =
  "Aguardando confirmação de pagamento para iniciar a separação.";
const PAGA_NA_ENTREGA =
  "A loja vai confirmar seu pedido. Você paga na entrega.";
const PAGA_NA_RETIRADA =
  "A loja vai confirmar seu pedido. Você paga na retirada.";

type Caso = {
  metodo: PaymentMethod;
  pagamento: PaymentStatus | null | undefined;
  retirada: boolean;
  esperado: string;
};

const TABELA: Caso[] = [
  // Pagar na mão: entrega e retirada, com o campo nulo ou ausente.
  {
    metodo: "cash",
    pagamento: null,
    retirada: false,
    esperado: PAGA_NA_ENTREGA,
  },
  {
    metodo: "cash",
    pagamento: null,
    retirada: true,
    esperado: PAGA_NA_RETIRADA,
  },
  {
    metodo: "cash",
    pagamento: undefined,
    retirada: false,
    esperado: PAGA_NA_ENTREGA,
  },
  {
    metodo: "card",
    pagamento: null,
    retirada: false,
    esperado: PAGA_NA_ENTREGA,
  },
  {
    metodo: "card",
    pagamento: null,
    retirada: true,
    esperado: PAGA_NA_RETIRADA,
  },
  {
    metodo: "pix",
    pagamento: null,
    retirada: false,
    esperado: PAGA_NA_ENTREGA,
  },
  {
    metodo: "pix",
    pagamento: null,
    retirada: true,
    esperado: PAGA_NA_RETIRADA,
  },
  // Pagar pelo app: o texto de sempre, em entrega ou retirada.
  {
    metodo: "online",
    pagamento: "aguardando",
    retirada: false,
    esperado: ESPERA_PAGAMENTO,
  },
  {
    metodo: "online",
    pagamento: "aguardando",
    retirada: true,
    esperado: ESPERA_PAGAMENTO,
  },
  {
    metodo: "online",
    pagamento: null,
    retirada: false,
    esperado: ESPERA_PAGAMENTO,
  },
  {
    metodo: "online",
    pagamento: "pago",
    retirada: false,
    esperado: "Pagamento confirmado. A loja vai iniciar a separação.",
  },
  // A loja já confirmou o recebimento: vale o texto de recebido.
  {
    metodo: "cash",
    pagamento: "recebido_na_entrega",
    retirada: false,
    esperado: "Pagamento confirmado. A loja vai iniciar a separação.",
  },
  // Pedido na mão mas com cobrança aberta (não nasce assim; controle): segue
  // o texto de aguardar, porque aí existe um pagamento a esperar.
  {
    metodo: "cash",
    pagamento: "aguardando",
    retirada: false,
    esperado: ESPERA_PAGAMENTO,
  },
];

describe("OrderDetailsView — pedido pago na entrega/retirada não manda esperar pagamento", () => {
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
          orderId="pedido-na-mao"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function textoDoCartaoDeStatus(): string {
    return (
      hospedeiro.querySelector('[data-testid="cartao-status"]')?.textContent ??
      ""
    );
  }

  it.each(TABELA)(
    "$metodo × $pagamento × retirada=$retirada",
    async ({ metodo, pagamento, retirada, esperado }) => {
      pedidoAtual = {
        ...pedidoBase,
        paymentMethod: metodo,
        paymentStatus: pagamento,
        retiradaNaLoja: retirada,
      };

      await renderizar();

      const texto = textoDoCartaoDeStatus();
      expect(texto).toContain(esperado);
      // Os três textos são exclusivos: nunca dois ao mesmo tempo.
      for (const outro of [
        ESPERA_PAGAMENTO,
        PAGA_NA_ENTREGA,
        PAGA_NA_RETIRADA,
      ]) {
        if (outro !== esperado) expect(texto).not.toContain(outro);
      }
    },
  );
});

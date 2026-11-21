// @vitest-environment jsdom
//
// Defeito da cliente (14/10/2026): o pedido cuja reserva de 30 minutos
// venceu é cancelado pelo cron (`status='cancelled'` + `payment_status=
// 'expirado'`) e o detalhe só dizia "foi cancelado e não seguirá para
// entrega" — sem dizer o motivo. Quem apenas demorou para pagar achava que a
// loja cancelou, e não havia caminho óbvio para comprar de novo.
//
// O pedido vencido explica o cancelamento e leva à vitrine. No cartão, pede
// para confirmar a aprovação com a loja antes de comprar de novo.
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

// A cliente que pagou no fim do prazo não pode ler "é só comprar de novo" sem
// aviso: a confirmação do Mercado Pago pode chegar minutos depois do
// vencimento, e comprar na hora seria pagar duas vezes.
const AVISO_DE_QUEM_JA_PAGOU =
  "Já pagou? Não faça outro pedido. Se a confirmação não aparecer, fale com a loja.";
const FRASE_DO_VENCIMENTO = `O prazo do pagamento terminou e o pedido foi cancelado. ${AVISO_DE_QUEM_JA_PAGOU} Se não pagou, é só comprar de novo.`;
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
    metodoOnline?: Order["metodoOnline"],
    opcoes?: Pick<Order, "paymentMethod" | "retiradaNaLoja">,
  ) {
    pedidoAtual = {
      ...pedidoBase,
      ...opcoes,
      status,
      paymentStatus: pagamento,
      metodoOnline,
    };
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

  it("PIX cancelado + expirado: mantém o aviso e o botão leva à vitrine", async () => {
    const onNavigate = vi.fn();

    await renderizar("cancelled", "expirado", onNavigate, "pix");

    expect(texto()).toContain(FRASE_DO_VENCIMENTO);
    expect(texto()).toContain(AVISO_DE_QUEM_JA_PAGOU);
    expect(texto()).not.toContain(FRASE_GENERICA);

    const botao = botaoDaLoja();
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it.each(["credito", "debito"] as const)(
    "cartão (%s) cancelado + expirado: orienta confirmar a aprovação antes de recomprar",
    async (metodoOnline) => {
      await renderizar("cancelled", "expirado", undefined, metodoOnline);

      expect(texto()).toContain(
        "O prazo do pagamento terminou e o pedido foi cancelado. Antes de comprar de novo, fale com a loja para confirmar se o pagamento do cartão foi aprovado.",
      );
      expect(texto()).not.toContain(AVISO_DE_QUEM_JA_PAGOU);
    },
  );

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
      frase: "não pague.",
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

  it("Pix pendente: orienta quem já pagou a não fazer outro pedido", async () => {
    await renderizar("pending", "aguardando", undefined, "pix");

    expect(texto()).toContain(
      `Aguardando confirmação de pagamento para iniciar a separação. ${AVISO_DE_QUEM_JA_PAGOU}`,
    );
  });

  it("Pix aguardando em separação: mantém a descrição e orienta quem já pagou", async () => {
    await renderizar("processing", "aguardando", undefined, "pix");

    expect(texto()).toContain(
      "Seu pedido está sendo preparado com todo cuidado e atenção.",
    );
    expect(texto()).toContain(AVISO_DE_QUEM_JA_PAGOU);
  });

  it.each([false, true])(
    "Pix aguardando após a separação (retirada: %s): orienta quem já pagou",
    async (retiradaNaLoja) => {
      await renderizar("shipping", "aguardando", undefined, "pix", {
        paymentMethod: "online",
        retiradaNaLoja,
      });

      expect(texto()).toContain(
        retiradaNaLoja
          ? "Seu pedido está pronto! Venha retirar na loja."
          : "Seu pedido já saiu para entrega e chegará em breve.",
      );
      expect(texto()).toContain(AVISO_DE_QUEM_JA_PAGOU);
    },
  );

  it("Pix pago em separação: não mostra o aviso", async () => {
    await renderizar("processing", "pago", undefined, "pix");

    expect(texto()).not.toContain(AVISO_DE_QUEM_JA_PAGOU);
  });

  it("cartão online aguardando em separação: não mostra o aviso", async () => {
    await renderizar("processing", "aguardando", undefined, "credito");

    expect(texto()).not.toContain(AVISO_DE_QUEM_JA_PAGOU);
  });

  it("dinheiro na entrega em separação: não mostra o aviso", async () => {
    await renderizar("processing", null, undefined, undefined, {
      paymentMethod: "cash",
    });

    expect(texto()).not.toContain(AVISO_DE_QUEM_JA_PAGOU);
  });

  it("Pix aguardando em pedido cancelado: orienta a não pagar, sem o aviso de Pix ativo", async () => {
    await renderizar("cancelled", "aguardando", undefined, "pix");

    expect(texto()).toContain("não pague.");
    expect(texto()).not.toContain(AVISO_DE_QUEM_JA_PAGOU);
  });

  it("pedido pendente com pagamento vencido (ainda não cancelado): não mostra o botão de vitrine", async () => {
    await renderizar("pending", "expirado");

    expect(texto()).not.toContain(FRASE_DO_VENCIMENTO);
    expect(botaoDaLoja()).toBeUndefined();
  });
});

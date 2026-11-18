// @vitest-environment jsdom
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("imprime a forma e a situação sem mandar cobrar pedidos pagos ou cancelados", () => {
  const base: Order = {
    id: "pedido-teste",
    customer: {
      name: "Cliente Teste",
      whatsapp: "",
      address: "",
      number: "",
      neighborhood: "",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    status: "pending",
    createdAt: "",
    updatedAt: "",
    cancelledAfterShipping: false,
  };
  const casos: [Partial<Order>, string, string][] = [
    [
      {
        paymentMethod: "cash",
        subtotal: 150,
        discount: 30,
        shipping: 15,
        total: 135,
      },
      "Dinheiro",
      "Cobrar na entrega: R$ 135,00 (Dinheiro)",
    ],
    [
      { total: 0, subtotal: 100, shipping: 15, discount: 0 },
      "Pagamento pelo site",
      "Pagamento pendente",
    ],
    [{ metodoOnline: "pix", paymentStatus: "pago" }, "PIX pelo site", "Pago"],
    [
      { metodoOnline: "credito", paymentStatus: "pago" },
      "Cartão de crédito pelo site",
      "Pago",
    ],
    [
      { paymentMethod: "cash" },
      "Dinheiro",
      "Cobrar na entrega: R$ 100,00 (Dinheiro)",
    ],
    [
      { paymentStatus: "aguardando" },
      "Pagamento pelo site",
      "Pagamento pendente",
    ],
    [
      { paymentMethod: "cash", status: "cancelled" },
      "Dinheiro",
      "Cancelado · nada a receber",
    ],
    [{ paymentStatus: "estornado" }, "Pagamento pelo site", "Estornado"],
    [
      {
        status: "cancelled",
        paymentStatus: "estornado",
        pagamentoRecebidoEm: "2026-11-18T10:00:00Z",
      },
      "Pagamento pelo site",
      "Estornado",
    ],
    [
      { paymentMethod: "cash", pagamentoRecebidoEm: "2026-11-18T10:00:00Z" },
      "Dinheiro",
      "Pago",
    ],
    [
      { paymentMethod: "cash", canal: "presencial" },
      "Dinheiro",
      "Cobrar na loja: R$ 100,00 (Dinheiro)",
    ],
    [
      { paymentMethod: "cash", retiradaNaLoja: true },
      "Dinheiro",
      "Cobrar na retirada: R$ 100,00 (Dinheiro)",
    ],
    [
      {
        paymentMethod: "cash",
        canal: "presencial",
        paymentStatus: "recebido_na_entrega",
      },
      "Dinheiro",
      "Pago",
    ],
    [
      { paymentMethod: "cash", total: 0, discount: 100 },
      "Sem valor a pagar",
      "Sem valor a cobrar",
    ],
  ];
  for (const [dados, forma, situacao] of casos) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() => root.render(<OrderReceipt order={{ ...base, ...dados }} />));
      const papel = document.querySelector("[data-tema-fixo]")!;
      expect(papel.textContent).toContain(`Pagamento: ${forma}`);
      expect(papel.textContent).toContain(situacao);
      if (!situacao.startsWith("Cobrar"))
        expect(papel.textContent).not.toContain("Cobrar");
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  }
});

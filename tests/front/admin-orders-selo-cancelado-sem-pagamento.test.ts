// Achado 3 da rodada 6: pedido CANCELADO que nunca foi pago continuava com o
// selo âmbar "Aguardando pagamento" (cartão, ficha e planilha). Cancelar não
// mexe no `payment_status`, então o par cancelado + aguardando existe de
// verdade. O selo passa a ser neutro e diz "Cancelado — sem pagamento".
import {
  PaymentStatusBadge,
  rotuloDoPagamento,
} from "@/components/admin/orders/OrderStatusBadge";
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order as Pedido } from "@/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

function pedido(alteracoes: Partial<Pedido> = {}): Pedido {
  return {
    id: "pedido-abc123",
    customer: {
      name: "João Silva",
      whatsapp: "11987654321",
      city: "São Paulo",
      state: "SP",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    status: "cancelled",
    paymentStatus: "aguardando",
    createdAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    updatedAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    cancelledAfterShipping: false,
    ...alteracoes,
  };
}

describe("selo de pagamento do pedido cancelado que nunca foi pago", () => {
  it("cancelado + aguardando diz 'Cancelado — sem pagamento', não 'Aguardando pagamento'", () => {
    expect(rotuloDoPagamento("aguardando", "cancelled")).toBe(
      "Cancelado — sem pagamento",
    );
    const html = renderToStaticMarkup(
      createElement(PaymentStatusBadge, {
        paymentStatus: "aguardando",
        orderStatus: "cancelled",
      }),
    );
    expect(html).toContain(">Cancelado — sem pagamento</span>");
    expect(html).not.toContain("Aguardando pagamento");
  });

  it("é selo neutro e resolvido: sem âmbar, sem piscar, sem 'precisa de atenção'", () => {
    const html = renderToStaticMarkup(
      createElement(PaymentStatusBadge, {
        paymentStatus: "aguardando",
        orderStatus: "cancelled",
      }),
    );
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("amber");
    expect(html).not.toContain("precisa de atenção");
    expect(rotuloDoPagamento("aguardando", "cancelled")).not.toContain(
      "precisa de atenção",
    );
  });

  it("no cartão (selo compacto) o rótulo curto cabe e o título guarda a frase inteira", () => {
    const html = renderToStaticMarkup(
      createElement(PaymentStatusBadge, {
        paymentStatus: "aguardando",
        orderStatus: "cancelled",
        compact: true,
      }),
    );
    expect(html).toContain('title="Cancelado — sem pagamento"');
    expect(html).toContain(">Sem pagamento</span>");
  });

  it("a planilha exporta o mesmo rótulo do selo", () => {
    expect(pedidosParaCsv([pedido()])).toContain(";Cancelado — sem pagamento;");
  });

  it("o limite: pedido ainda ATIVO aguardando continua 'Aguardando pagamento'", () => {
    for (const status of [
      "pending",
      "processing",
      "shipping",
      "delivered",
      null,
      undefined,
    ] as const) {
      expect(rotuloDoPagamento("aguardando", status)).toBe(
        "Aguardando pagamento",
      );
    }
    expect(pedidosParaCsv([pedido({ status: "pending" })])).toContain(
      ";Aguardando pagamento;",
    );
  });

  it("não encosta nos outros cruzamentos com cancelado", () => {
    expect(rotuloDoPagamento("pago", "cancelled")).toBe(
      "Pago e cancelado — precisa de atenção",
    );
    expect(rotuloDoPagamento("estornado", "cancelled")).toBe("Estornado");
    expect(rotuloDoPagamento("expirado", "cancelled")).toBe("Expirado");
    expect(rotuloDoPagamento("recusado", "cancelled")).toBe("Recusado");
  });
});

// A decisão "o entregador cobra ou não?" (`situacaoDoPagamentoNaEntrega`) com
// as duas situações em que a conta zera ou estorna, e o valor que vai escrito:
//   · pedido de total ZERO (cupom de 100%) não tem o que cobrar: "sem_valor",
//     mesmo que já conste como pago;
//   · mas estornado ainda vence tudo, inclusive o total zero;
//   · o valor sai sempre com duas casas e arredondado: o entregador lê
//     "R$ 12,35", nunca "12,345" nem "0".
import { situacaoDoPagamentoNaEntrega } from "@/lib/situacao-do-pagamento-na-entrega";
import type { Order } from "@/types";
import { describe, expect, it } from "vitest";

function pedido(extra: Partial<Order>): Order {
  return {
    id: "pedido-1234567890",
    customer: {
      name: "Maria Teste",
      whatsapp: "11999999999",
      address: "Rua das Flores",
      number: "120",
      neighborhood: "Centro",
    },
    items: [],
    subtotal: 0,
    shipping: 0,
    discount: 0,
    total: 0,
    paymentMethod: "cash",
    status: "processing",
    createdAt: "2026-08-20T10:00:00Z",
    updatedAt: "2026-08-20T10:00:00Z",
    cancelledAfterShipping: false,
    ...extra,
  };
}

describe("situacaoDoPagamentoNaEntrega — total zero", () => {
  it("total zero ainda não pago: sem valor a cobrar, e o valor sai '0,00'", () => {
    expect(
      situacaoDoPagamentoNaEntrega(pedido({ paymentStatus: "aguardando" })),
    ).toEqual({ situacao: "sem_valor", forma: "Dinheiro", valor: "0,00" });
  });

  it("total zero que consta como pago continua sendo 'sem valor', não 'pago'", () => {
    expect(
      situacaoDoPagamentoNaEntrega(pedido({ paymentStatus: "pago" })).situacao,
    ).toBe("sem_valor");
    expect(
      situacaoDoPagamentoNaEntrega(
        pedido({ pagamentoRecebidoEm: "2026-08-20T12:00:00Z" }),
      ).situacao,
    ).toBe("sem_valor");
  });

  it("total zero estornado: estornado vence o 'sem valor'", () => {
    expect(
      situacaoDoPagamentoNaEntrega(pedido({ paymentStatus: "estornado" }))
        .situacao,
    ).toBe("estornado");
  });

  it("total zero por conta que NÃO fecha (tem produto e frete): não é 'sem valor'", () => {
    expect(
      situacaoDoPagamentoNaEntrega(
        pedido({ subtotal: 50, shipping: 10, discount: 0, total: 0 }),
      ).situacao,
    ).not.toBe("sem_valor");
  });
});

describe("situacaoDoPagamentoNaEntrega — o valor escrito", () => {
  it.each([
    [12.345, "12,35"],
    [1234.5, "1.234,50"],
    [10, "10,00"],
    [0.1, "0,10"],
    [1000000, "1.000.000,00"],
  ])("R$ %s sai '%s'", (total, esperado) => {
    expect(
      situacaoDoPagamentoNaEntrega(
        pedido({
          total,
          subtotal: total,
          paymentMethod: "pix",
          paymentStatus: "aguardando",
        }),
      ).valor,
    ).toBe(esperado);
  });
});

// A decisão "o entregador cobra ou não?" que vai no papel e na mensagem ao
// entregador (`situacaoDoPagamentoNaEntrega`). O erro caro é cobrar DE NOVO um
// pedido que já foi pago, ou deixar de cobrar um que não foi. Três bordas que
// o teste do papel (que só olha dinheiro) não prendia:
//   - PIX expirado e pago depois (`pago_apos_expirar`) é pago, igual a `pago`;
//   - PIX e cartão na entrega, ainda não pagos, são "cobrar" — não "pendente";
//   - pagamento pelo site ainda não confirmado é "pendente" (nada a cobrar na mão).
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
    subtotal: 1234.5,
    shipping: 0,
    discount: 0,
    total: 1234.5,
    paymentMethod: "pix",
    status: "processing",
    createdAt: "2026-08-20T10:00:00Z",
    updatedAt: "2026-08-20T10:00:00Z",
    cancelledAfterShipping: false,
    ...extra,
  };
}

describe("situacaoDoPagamentoNaEntrega", () => {
  it.each(["pago", "pago_apos_expirar", "recebido_na_entrega"] as const)(
    "pagamento '%s' é pago em qualquer forma — o entregador não cobra de novo",
    (paymentStatus) => {
      for (const paymentMethod of ["pix", "card", "cash"] as const) {
        expect(
          situacaoDoPagamentoNaEntrega(pedido({ paymentMethod, paymentStatus }))
            .situacao,
        ).toBe("pago");
      }
    },
  );

  it.each([
    ["pix", "Pix"],
    ["card", "Cartão"],
    ["cash", "Dinheiro"],
  ] as const)(
    "%s ainda não pago: é para COBRAR, com o nome da forma e o valor em pt-BR",
    (paymentMethod, forma) => {
      expect(
        situacaoDoPagamentoNaEntrega(
          pedido({ paymentMethod, paymentStatus: "aguardando" }),
        ),
      ).toEqual({ situacao: "cobrar", forma, valor: "1.234,50" });
    },
  );

  it("pagamento pelo site ainda não confirmado é pendente, sem forma para cobrar", () => {
    expect(
      situacaoDoPagamentoNaEntrega(
        pedido({ paymentMethod: "online", paymentStatus: "aguardando" }),
      ),
    ).toEqual({ situacao: "pendente", forma: undefined, valor: "1.234,50" });
  });

  it("dinheiro recebido registrado (pagamentoRecebidoEm) vale como pago mesmo sem o status", () => {
    expect(
      situacaoDoPagamentoNaEntrega(
        pedido({
          paymentMethod: "cash",
          paymentStatus: "aguardando",
          pagamentoRecebidoEm: "2026-08-20T12:00:00Z",
        }),
      ).situacao,
    ).toBe("pago");
  });

  it("estornado vence tudo, até o recebimento registrado", () => {
    expect(
      situacaoDoPagamentoNaEntrega(
        pedido({
          paymentStatus: "estornado",
          pagamentoRecebidoEm: "2026-08-20T12:00:00Z",
        }),
      ).situacao,
    ).toBe("estornado");
  });
});

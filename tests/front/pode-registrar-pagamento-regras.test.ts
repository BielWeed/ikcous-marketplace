// A loja só marca "recebido" o que o gateway NÃO confirma: pedido pago pelo
// site (online) é confirmado pelo Mercado Pago, e pedido cancelado não recebe
// nem desfaz pagamento. A função é a única fonte dessa regra (cartão da lista
// e ficha do pedido) e não tinha teste próprio: este arquivo prende as duas
// recusas e as três formas de pagamento que PODEM registrar.
import { podeRegistrarPagamento } from "@/components/admin/orders/podeRegistrarPagamento";
import type { Order, OrderStatus, PaymentMethod } from "@/types";
import { describe, expect, it } from "vitest";

const pedido = (
  paymentMethod: PaymentMethod,
  status: OrderStatus,
  extra: Partial<Order> = {},
) => ({ id: "pedido-1", paymentMethod, status, ...extra }) as Order;

describe("podeRegistrarPagamento", () => {
  it.each<PaymentMethod>(["cash", "pix", "card"])(
    "pagamento na entrega (%s) em pedido em andamento pode registrar",
    (forma) => {
      expect(podeRegistrarPagamento(pedido(forma, "processing"))).toBe(true);
    },
  );

  it.each<OrderStatus>([
    "pending",
    "processing",
    "shipping",
    "delivered",
    "cancelled",
  ])("pedido pago pelo site (online) nunca registra, em %s", (status) => {
    expect(podeRegistrarPagamento(pedido("online", status))).toBe(false);
  });

  it.each<PaymentMethod>(["cash", "pix", "card"])(
    "pedido cancelado (%s) não registra nem desfaz",
    (forma) => {
      expect(podeRegistrarPagamento(pedido(forma, "cancelled"))).toBe(false);
    },
  );

  it("entregue sem cobrança online ainda pode registrar (o recebimento vem depois)", () => {
    expect(podeRegistrarPagamento(pedido("cash", "delivered"))).toBe(true);
  });

  it("pedido já marcado como recebido e depois cancelado deixa de oferecer Desfazer", () => {
    const recebidoECancelado = pedido("cash", "cancelled", {
      paymentStatus: "recebido_na_entrega",
      pagamentoRecebidoEm: "2026-11-01T10:00:00.000Z",
    });
    expect(podeRegistrarPagamento(recebidoECancelado)).toBe(false);
  });

  it("não olha o status do pagamento: online 'pago' e online 'aguardando' recusam igual", () => {
    expect(
      podeRegistrarPagamento(
        pedido("online", "processing", { paymentStatus: "pago" }),
      ),
    ).toBe(false);
    expect(
      podeRegistrarPagamento(
        pedido("online", "processing", { paymentStatus: "aguardando" }),
      ),
    ).toBe(false);
  });
});

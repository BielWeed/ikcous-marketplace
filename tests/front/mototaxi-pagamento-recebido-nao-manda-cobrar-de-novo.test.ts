import { mensagemMototaxi } from "@/components/admin/minha-loja/contato";
import type { Order } from "@/types";
import { expect, it } from "vitest";

const pedido: Order = {
  id: "c35ce4dd-9876-4321-8123-abcdef3884be",
  shippingOptionId: "local-delivery",
  customer: {
    name: "Cliente fictícia",
    whatsapp: "11912345678",
    address: "Rua Inventada",
    number: "12",
    complement: "apto 4",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    cep: "01000-000",
    reference: "portão azul",
  },
  items: [
    {
      productId: "p",
      name: "Caneca & café",
      quantity: 2,
      price: 25,
      image: "",
    },
  ],
  subtotal: 50,
  shipping: 8,
  discount: 0,
  total: 58,
  paymentMethod: "cash",
  paymentStatus: null,
  status: "processing",
  createdAt: "",
  updatedAt: "",
  cancelledAfterShipping: false,
};

it("não manda cobrar de novo quando a loja já confirmou o recebimento, mesmo sem status de pagamento", () => {
  const msg = mensagemMototaxi(
    { ...pedido, pagamentoRecebidoEm: "2026-11-10T12:00:00.000Z" },
    "Loja fictícia",
  );

  expect(msg).toContain("Já pago — não cobrar");
  expect(msg).not.toContain("Cobrar na entrega");
});

it("manda cobrar na entrega quando não há status nem confirmação de recebimento", () => {
  const msg = mensagemMototaxi(pedido, "Loja fictícia");

  expect(msg).toContain("Cobrar na entrega: R$ 58,00 (Dinheiro)");
  expect(msg).not.toContain("Já pago");
});

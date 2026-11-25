// Caça por mutação (25/11/2026), mensagem do WhatsApp do mototáxi.
// A linha de pagamento é a que decide se o entregador cobra na porta. Havia
// teste para "Já pago" e para "estornado", mas nenhum para:
//   - pedido de R$ 0,00 (cupom de 100%): "Sem valor a cobrar", nunca "Cobrar";
//   - pedido a cobrar: a frase inteira com o valor em reais e a forma;
//   - pedido pago pelo app e ainda não confirmado: "não cobrar na entrega".
// E o corte da observação longa: se o corte cai num espaço, as reticências
// não ficam soltas depois de um espaço ("texto …").
import { mensagemMototaxi } from "@/components/admin/minha-loja/contato";
import type { Order } from "@/types";
import { describe, expect, it } from "vitest";

const base: Order = {
  id: "c35ce4dd-9876-4321-8123-abcdef3884be",
  shippingOptionId: "local-delivery",
  customer: {
    name: "Cliente fictícia",
    whatsapp: "11912345678",
    address: "Rua Inventada",
    number: "12",
    complement: "",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    cep: "01000-000",
    reference: "",
  },
  items: [
    { productId: "p", name: "Caneca", quantity: 2, price: 25, image: "" },
  ],
  subtotal: 50,
  shipping: 8,
  discount: 0,
  total: 58,
  paymentMethod: "cash",
  status: "processing",
  createdAt: "",
  updatedAt: "",
  cancelledAfterShipping: false,
};

const linhaDoPagamento = (mensagem: string) =>
  mensagem
    .split("\n")
    .find(
      (l) =>
        l.startsWith("Cobrar") ||
        l.startsWith("Sem valor") ||
        l.startsWith("Já pago") ||
        l.startsWith("Pagamento"),
    );

describe("mensagemMototaxi: linha de pagamento de cada situação", () => {
  it("pedido a cobrar: valor em reais com centavos e a forma entre parênteses", () => {
    expect(linhaDoPagamento(mensagemMototaxi(base, "Loja"))).toBe(
      "Cobrar na entrega: R$ 58,00 (Dinheiro)",
    );
    expect(
      linhaDoPagamento(
        mensagemMototaxi(
          { ...base, paymentMethod: "card", total: 1234.5 },
          "Loja",
        ),
      ),
    ).toBe("Cobrar na entrega: R$ 1.234,50 (Cartão)");
  });

  it("pedido de R$ 0,00 (cupom de 100%): 'Sem valor a cobrar', não manda cobrar", () => {
    const zerado: Order = {
      ...base,
      subtotal: 50,
      discount: 50,
      shipping: 0,
      total: 0,
    };
    const mensagem = mensagemMototaxi(zerado, "Loja");

    expect(linhaDoPagamento(mensagem)).toBe("Sem valor a cobrar");
    expect(mensagem).not.toContain("Cobrar na entrega");
  });

  it("pedido de R$ 0,00 já marcado como estornado continua pedindo conferência", () => {
    const zerado: Order = {
      ...base,
      subtotal: 50,
      discount: 50,
      shipping: 0,
      total: 0,
      paymentStatus: "estornado",
    };

    expect(linhaDoPagamento(mensagemMototaxi(zerado, "Loja"))).toBe(
      "Pagamento estornado — conferir antes de enviar",
    );
  });

  it("pagamento pelo app ainda pendente: manda NÃO cobrar na entrega", () => {
    const aguardando: Order = {
      ...base,
      paymentMethod: "online",
      paymentStatus: "aguardando",
    };

    expect(linhaDoPagamento(mensagemMototaxi(aguardando, "Loja"))).toBe(
      "Pagamento pelo app pendente — não cobrar na entrega",
    );
  });
});

describe("mensagemMototaxi: observação cortada em cima de um espaço", () => {
  const linhaDaObservacao = (mensagem: string) =>
    mensagem.split("\n").find((l) => l.startsWith("Observações do pedido:"));

  it("o espaço que sobra no fim do corte não fica antes das reticências", () => {
    // 298 letras + espaço (o 299º caractere) + 10 letras: 309 > 300, corta em 299.
    const nota = `${"a".repeat(298)} ${"b".repeat(10)}`;

    expect(
      linhaDaObservacao(mensagemMototaxi({ ...base, notes: nota }, "Loja")),
    ).toBe(`Observações do pedido: ${"a".repeat(298)}…`);
  });
});

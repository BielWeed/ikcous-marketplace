// Pedido de R$ 0,00 (cupom de 100% que zera a compra): a forma de pagamento
// não é "dinheiro" nem "pagar na entrega" — não há nada a pagar. Decisão do
// dono, 15/10/2026: só TELAS e textos; o servidor segue gravando o pedido
// como "pagar na entrega" e isto NÃO muda.
//
// A regra mora numa função só (`pedidoSemValorAPagar`) e no rótulo único
// (`rotuloDaFormaDoPedido`); toda tela que mostra a forma de pagamento passa
// por aqui. O controle (total acima de zero) tem de continuar byte a byte
// como era.
import { calcularResumoFicha } from "@/components/admin/users/ficha-resumo";
import {
  ROTULO_SEM_VALOR_A_PAGAR,
  pedidoSemValorAPagar,
  rotuloDaFormaDoPedido,
} from "@/lib/forma-de-pagamento";
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order } from "@/types";
import { describe, expect, it } from "vitest";

function pedido(alteracoes: Partial<Order> = {}): Order {
  return {
    id: "pedido-abc123",
    customer: { name: "Maria", whatsapp: "11987654321" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 100,
    total: 0,
    paymentMethod: "cash",
    status: "delivered",
    paymentStatus: "recebido_na_entrega",
    createdAt: new Date(2026, 9, 15, 9, 7).toISOString(),
    updatedAt: new Date(2026, 9, 15, 9, 7).toISOString(),
    cancelledAfterShipping: false,
    ...alteracoes,
  };
}

describe("pedidoSemValorAPagar", () => {
  it("total zero (e a conta em centavos) é sem valor a pagar", () => {
    expect(pedidoSemValorAPagar({ total: 0 })).toBe(true);
    expect(pedidoSemValorAPagar({ total: 0.004 })).toBe(true);
  });

  it("total com valor, ausente ou inválido NUNCA vira sem valor a pagar", () => {
    expect(pedidoSemValorAPagar({ total: 10 })).toBe(false);
    expect(pedidoSemValorAPagar({ total: 0.01 })).toBe(false);
    expect(pedidoSemValorAPagar({})).toBe(false);
    expect(pedidoSemValorAPagar({ total: null })).toBe(false);
    expect(pedidoSemValorAPagar({ total: undefined })).toBe(false);
    expect(pedidoSemValorAPagar({ total: Number.NaN })).toBe(false);
  });
});

describe("rotuloDaFormaDoPedido com total zero", () => {
  it.each([
    ["cash", "site"],
    ["pix", "site"],
    ["card", "site"],
    ["cash", "presencial"],
    ["card", "presencial"],
    [null, "site"],
    ["qualquer-outro", "site"],
  ] as const)(
    "%s no canal %s com total 0 -> 'Sem valor a pagar'",
    (paymentMethod, canal) => {
      expect(rotuloDaFormaDoPedido({ paymentMethod, canal, total: 0 })).toBe(
        "Sem valor a pagar",
      );
      expect(ROTULO_SEM_VALOR_A_PAGAR).toBe("Sem valor a pagar");
    },
  );

  it("CONTROLE: o mesmo pedido com total 10 continua com o rótulo de antes", () => {
    expect(rotuloDaFormaDoPedido({ paymentMethod: "cash", total: 10 })).toBe(
      "Dinheiro",
    );
    expect(rotuloDaFormaDoPedido({ paymentMethod: "pix", total: 10 })).toBe(
      "PIX Instantâneo",
    );
    expect(rotuloDaFormaDoPedido({ paymentMethod: "card", total: 10 })).toBe(
      "Cartão na entrega",
    );
    expect(
      rotuloDaFormaDoPedido({
        paymentMethod: "card",
        canal: "presencial",
        total: 10,
      }),
    ).toBe("Cartão na maquininha");
    expect(
      rotuloDaFormaDoPedido({
        paymentMethod: "online",
        metodoOnline: "pix",
        total: 10,
      }),
    ).toBe("PIX pelo site");
  });
});

describe("onde o rótulo aparece sem tela própria", () => {
  it("a planilha e a lista de pedidos da lojista usam o MESMO rótulo (coluna 'Forma de pagamento')", () => {
    const csv = pedidosParaCsv([pedido()]);
    const colunas = csv.split("\r\n")[1].split(";");
    // Número;Data;Cliente;Telefone;Status;FORMA;Status do pagamento;Total...
    expect(colunas[5]).toBe("Sem valor a pagar");
  });

  it("CONTROLE: planilha com total 10 continua com 'Dinheiro'", () => {
    const csv = pedidosParaCsv([pedido({ total: 10, discount: 0 })]);
    expect(csv.split("\r\n")[1].split(";")[5]).toBe("Dinheiro");
  });
});

describe("brinde entregue conta nas vendas (ficha do cliente)", () => {
  it("pedido de R$ 0 entregue e com 'Recebi' registrado conta como pedido pago, com R$ 0 de dinheiro", () => {
    const resumo = calcularResumoFicha([pedido()]);
    expect(resumo.pedidosQueContam).toHaveLength(1);
    expect(resumo.pedidosPagos).toHaveLength(1);
    expect(resumo.totalGasto).toBe(0);
  });

  it("sem o 'Recebi' (pagamento nulo) o brinde NÃO contaria — é por isso que a ficha o registra ao entregar", () => {
    const resumo = calcularResumoFicha([pedido({ paymentStatus: null })]);
    expect(resumo.pedidosPagos).toHaveLength(0);
  });
});

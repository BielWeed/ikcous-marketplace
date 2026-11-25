// Caça por mutação na planilha de pedidos (25/11/2026). Dois defeitos de uma
// linha em `src/lib/pedidos-csv.ts` passavam em todos os testes:
//   1. o estorno é arredondado em centavos, não cortado: R$ 0,29 vezes 100 dá
//      28,999999999999996 em ponto flutuante, e cortar (`Math.floor`) faria a
//      planilha do contador dizer "estornou R$ 0,28" e "restou R$ 9,72";
//   2. pedido ENTREGUE e estornado continua pedindo atenção na planilha — só a
//      ficha do pedido tem a prova de que a devolução foi concluída, e lista e
//      planilha seguem no alerta (chargeback perdido tem o mesmo par de status).
// Só fixtures inventadas: nenhum dado de cliente de verdade.
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order as Pedido } from "@/types";
import { describe, expect, it } from "vitest";

function pedido(alteracoes: Partial<Pedido> = {}): Pedido {
  return {
    id: "pedido-caca-2511",
    customer: {
      name: "Cliente Inventado",
      whatsapp: "11900000000",
      city: "Campinas",
      state: "SP",
    },
    items: [],
    subtotal: 10,
    shipping: 0,
    discount: 0,
    total: 10,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus: "pago",
    createdAt: "2026-09-08T12:07:00Z",
    updatedAt: "2026-09-08T12:07:00Z",
    cancelledAfterShipping: false,
    ...alteracoes,
  };
}

function linha(p: Pedido): string[] {
  return pedidosParaCsv([p]).split("\r\n")[1].split(";");
}

describe("planilha de pedidos — o centavo do estorno é arredondado, nunca cortado", () => {
  it("R$ 0,29 estornado de R$ 10,00: sai 0,29 e 9,71 (0,29 × 100 = 28,999… em ponto flutuante)", () => {
    expect(linha(pedido({ valorEstornado: 0.29 })).slice(16)).toEqual([
      "0,29",
      "9,71",
    ]);
  });

  it("R$ 1,15 estornado de R$ 10,00: sai 1,15 e 8,85 (1,15 × 100 = 114,999… em ponto flutuante)", () => {
    expect(linha(pedido({ valorEstornado: 1.15 })).slice(16)).toEqual([
      "1,15",
      "8,85",
    ]);
  });
});

describe("planilha de pedidos — estornado e entregue segue pedindo atenção", () => {
  it("pedido do site entregue e estornado: a coluna de status do pagamento pede atenção", () => {
    const colunas = linha(
      pedido({
        status: "delivered",
        paymentStatus: "estornado",
        valorEstornado: 10,
      }),
    );
    expect(colunas[6]).toBe("Estornado — precisa de atenção");
  });

  it("controle: pedido pago e entregue continua só 'Pago'", () => {
    const colunas = linha(
      pedido({ status: "delivered", paymentStatus: "pago" }),
    );
    expect(colunas[6]).toBe("Pago");
  });
});

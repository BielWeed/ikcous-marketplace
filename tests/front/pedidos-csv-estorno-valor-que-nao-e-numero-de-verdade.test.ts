// Protege as duas colunas de estorno da planilha de pedidos contra valor que
// não é um dinheiro de verdade. O banco devolve `numeric`, e um valor
// estourado ou um total negativo (dado corrompido) não pode virar "estorno de
// infinito" nem estorno negativo na planilha que a lojista leva ao contador.
// Mutantes que isto mata: trocar `!Number.isFinite` por `Number.isNaN` (o
// infinito passaria e sairia "total estornado") e tirar o `Math.max(0, ...)`
// do total (o estorno sairia negativo).
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order as Pedido } from "@/types";
import { describe, expect, it } from "vitest";

function pedido(alteracoes: Partial<Pedido> = {}): Pedido {
  return {
    id: "pedido-estorno-1",
    customer: {
      name: "Cliente Inventado",
      whatsapp: "11900000000",
      city: "Campinas",
      state: "SP",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus: "pago",
    createdAt: "2026-09-08T12:07:00Z",
    updatedAt: "2026-09-08T12:07:00Z",
    cancelledAfterShipping: false,
    ...alteracoes,
  };
}

function colunasDeEstorno(p: Pedido): string[] {
  return pedidosParaCsv([p]).split("\r\n")[1].split(";").slice(16);
}

describe("planilha de pedidos: estorno que não é um número de verdade", () => {
  it("estorno infinito não vira 'estornou o total': as duas colunas saem em branco", () => {
    expect(
      colunasDeEstorno(pedido({ valorEstornado: Number.POSITIVE_INFINITY })),
    ).toEqual(["", ""]);
  });

  it("estorno menos infinito também sai em branco", () => {
    expect(
      colunasDeEstorno(pedido({ valorEstornado: Number.NEGATIVE_INFINITY })),
    ).toEqual(["", ""]);
  });

  it("total negativo (dado corrompido) não gera estorno negativo: limita em zero", () => {
    const p = pedido({ total: -10, valorEstornado: 5 });
    expect(colunasDeEstorno(p)).toEqual(["0,00", "0,00"]);
    // O Total original continua como veio: a planilha não esconde o dado ruim.
    expect(pedidosParaCsv([p]).split("\r\n")[1].split(";")[7]).toBe("-10,00");
  });

  it("controle: estorno finito e normal continua saindo com as duas colunas", () => {
    expect(colunasDeEstorno(pedido({ valorEstornado: 40 }))).toEqual([
      "40,00",
      "60,00",
    ]);
  });
});

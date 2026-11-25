// Caça de mutação "só testes" (pedidos, 25/11/2026). A planilha de pedidos é o
// que a lojista leva ao contador, e oito mutantes de `pedidos-csv.ts` passavam
// por toda a suíte de planilha. O que cada teste protege, em linguagem de loja:
//
//  - Subtotal, Frete e Desconto são colunas DIFERENTES: os testes antigos
//    usavam subtotal = total e frete = desconto = 0, então ler uma coluna no
//    lugar da outra não aparecia. Aqui cada uma tem um valor próprio.
//  - O número do pedido é o FIM do id (os 6 últimos caracteres), nunca os 5
//    ou os 7: ids de teste curtos escondiam o corte.
//  - Itens de um mesmo pedido saem separados por " | ": um separador trocado
//    por ";" quebraria a linha da planilha em colunas a mais.
//  - Texto do cliente que começa com "-" não vira fórmula na planilha (junto
//    de "=", "+" e "@"), nem com espaço antes.
//  - Aspas dentro do texto são duplicadas TODAS (nome com apelido entre aspas):
//    trocar `replaceAll` por `replace` só dobrava a primeira.
//  - Estorno: pedido pago com estorno zero mostra "0,00" e o total cheio;
//    pedido ESTORNADO com zero acumulado deixa as duas colunas em branco.
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order as Pedido } from "@/types";
import { describe, expect, it } from "vitest";

function pedido(alteracoes: Partial<Pedido> = {}): Pedido {
  return {
    id: "123e4567-e89b-12d3-a456-426614174abc",
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

/** Linha de dados (a segunda) já cortada em células; só serve se nenhuma célula tiver ";". */
function celulas(p: Pedido): string[] {
  return pedidosParaCsv([p]).split("\r\n")[1].split(";");
}

const COLUNA = {
  numero: 0,
  cliente: 2,
  total: 7,
  itens: 10,
  subtotal: 11,
  frete: 12,
  desconto: 13,
  estorno: 16,
  totalMenosEstorno: 17,
} as const;

describe("planilha de pedidos: dinheiro em cada coluna", () => {
  it("Subtotal, Frete, Desconto e Total saem cada um na sua coluna, com vírgula", () => {
    const c = celulas(
      pedido({ subtotal: 120, shipping: 15.5, discount: 25, total: 110.5 }),
    );

    expect(c[COLUNA.subtotal]).toBe("120,00");
    expect(c[COLUNA.frete]).toBe("15,50");
    expect(c[COLUNA.desconto]).toBe("25,00");
    expect(c[COLUNA.total]).toBe("110,50");
  });
});

describe("planilha de pedidos: número do pedido", () => {
  it("são os 6 últimos caracteres do id, em maiúsculas, com # na frente", () => {
    expect(celulas(pedido())[COLUNA.numero]).toBe("#174ABC");
  });

  it("id mais curto que 6 caracteres sai inteiro (sem cortar nem inventar)", () => {
    expect(celulas(pedido({ id: "ab12" }))[COLUNA.numero]).toBe("#AB12");
  });
});

describe("planilha de pedidos: itens do mesmo pedido", () => {
  it("dois itens saem na mesma célula separados por ' | ', cada um com quantidade e preço", () => {
    const c = celulas(
      pedido({
        items: [
          {
            productId: "p1",
            name: "Camiseta",
            price: 49.9,
            quantity: 1,
            image: "",
          },
          {
            productId: "p2",
            name: "Calça",
            price: 10,
            quantity: 2,
            image: "",
          },
        ],
      }),
    );

    expect(c[COLUNA.itens]).toBe("Camiseta (1 x 49,90) | Calça (2 x 10,00)");
  });
});

describe("planilha de pedidos: texto do cliente é texto, nunca fórmula nem aspas soltas", () => {
  it("nome que começa com '-' recebe o apóstrofo (como '=', '+' e '@')", () => {
    const c = celulas(pedido({ customer: { name: "-2+3", whatsapp: "" } }));

    expect(c[COLUNA.cliente]).toBe("'-2+3");
  });

  it("nome com espaços e depois '-' também recebe o apóstrofo", () => {
    const c = celulas(pedido({ customer: { name: "  -1", whatsapp: "" } }));

    expect(c[COLUNA.cliente]).toBe("'  -1");
  });

  it("controle: nome com '-' no MEIO não leva apóstrofo", () => {
    const c = celulas(
      pedido({ customer: { name: "Ana-Maria", whatsapp: "" } }),
    );

    expect(c[COLUNA.cliente]).toBe("Ana-Maria");
  });

  it("aspas dentro do nome são dobradas todas, e a célula inteira vai entre aspas", () => {
    const linha = pedidosParaCsv([
      pedido({ customer: { name: 'Maria "Mimi" "Lu" Silva', whatsapp: "" } }),
    ]).split("\r\n")[1];

    expect(linha).toContain(';"Maria ""Mimi"" ""Lu"" Silva";');
  });
});

describe("planilha de pedidos: colunas de estorno com valor zero", () => {
  it("pedido pago com estorno 0 mostra 0,00 e o total cheio (nada foi devolvido)", () => {
    const c = celulas(pedido({ paymentStatus: "pago", valorEstornado: 0 }));

    expect(c[COLUNA.estorno]).toBe("0,00");
    expect(c[COLUNA.totalMenosEstorno]).toBe("100,00");
  });

  it("pedido ESTORNADO com zero acumulado deixa as duas colunas em branco", () => {
    const c = celulas(
      pedido({ paymentStatus: "estornado", valorEstornado: 0 }),
    );

    expect(c[COLUNA.estorno]).toBe("");
    expect(c[COLUNA.totalMenosEstorno]).toBe("");
  });

  it("controle: pedido estornado com R$ 30 acumulados mostra 30,00 e 70,00", () => {
    const c = celulas(
      pedido({ paymentStatus: "estornado", valorEstornado: 30 }),
    );

    expect(c[COLUNA.estorno]).toBe("30,00");
    expect(c[COLUNA.totalMenosEstorno]).toBe("70,00");
  });
});

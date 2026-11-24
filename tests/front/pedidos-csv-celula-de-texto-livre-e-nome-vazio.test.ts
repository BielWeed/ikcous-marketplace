import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order as Pedido } from "@/types";
import { describe, expect, it } from "vitest";

const CRLF = "\r\n";

function pedido(alteracoes: Partial<Pedido> = {}): Pedido {
  return {
    id: "pedido-abc123",
    customer: {
      name: "Maria Souza",
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
    paymentStatus: "aguardando",
    createdAt: "2026-09-08T12:07:00Z",
    updatedAt: "2026-09-08T12:07:00Z",
    cancelledAfterShipping: false,
    ...alteracoes,
  };
}

// A linha do pedido, já separada nas colunas. Só serve quando nenhuma célula
// tem ";" ou quebra de linha dentro.
function colunasDaPrimeiraLinha(csv: string): string[] {
  return csv.split(CRLF)[1].split(";");
}

describe("planilha de pedidos: célula que o cliente digitou", () => {
  it("nome que começa com TAB vira texto (apóstrofo na frente), mesmo sem fórmula depois", () => {
    // Excel trata célula que abre com TAB como entrada especial; o apóstrofo
    // a mantém como texto. Sem o ramo do TAB, só "=+@-" eram protegidos.
    const csv = pedidosParaCsv([
      pedido({
        customer: {
          name: "\tMaria",
          whatsapp: "11900000000",
          city: "Campinas",
          state: "SP",
        },
      }),
    ]);

    expect(colunasDaPrimeiraLinha(csv)[2]).toBe("'\tMaria");
  });

  it("nome que começa com quebra de linha vira texto e a célula inteira fica entre aspas", () => {
    const csv = pedidosParaCsv([
      pedido({
        customer: {
          name: "\nMaria",
          whatsapp: "11900000000",
          city: "Campinas",
          state: "SP",
        },
      }),
    ]);

    // Uma só linha de pedido: o CRLF que separa registros não aparece dentro
    // da célula, e o LF dela fica protegido pelas aspas.
    expect(csv).toContain(`;"'\nMaria";`);
    expect(csv.split(CRLF)).toHaveLength(2);
  });

  it("nome que começa com retorno de carro (CR) vira texto e fica entre aspas", () => {
    const csv = pedidosParaCsv([
      pedido({
        customer: {
          name: "\rMaria",
          whatsapp: "11900000000",
          city: "Campinas",
          state: "SP",
        },
      }),
    ]);

    expect(csv).toContain(`;"'\rMaria";`);
  });

  it("nome com TAB no meio não ganha apóstrofo (só o começo é perigoso)", () => {
    const csv = pedidosParaCsv([
      pedido({
        customer: {
          name: "Maria\tSouza",
          whatsapp: "11900000000",
          city: "Campinas",
          state: "SP",
        },
      }),
    ]);

    expect(colunasDaPrimeiraLinha(csv)[2]).toBe("Maria\tSouza");
  });
});

describe("planilha de pedidos: cliente sem nome", () => {
  it("nome vazio ('') sai como 'Cliente', não como célula em branco", () => {
    const csv = pedidosParaCsv([
      pedido({
        customer: {
          name: "",
          whatsapp: "11900000000",
          city: "Campinas",
          state: "SP",
        },
      }),
    ]);

    expect(colunasDaPrimeiraLinha(csv)[2]).toBe("Cliente");
  });

  it("pedido sem cliente nenhum sai com 'Cliente' e telefone, cidade e UF em branco", () => {
    const csv = pedidosParaCsv([
      pedido({ customer: undefined as unknown as Pedido["customer"] }),
    ]);
    const colunas = colunasDaPrimeiraLinha(csv);

    expect(colunas[2]).toBe("Cliente");
    expect(colunas[3]).toBe("");
    expect(colunas[8]).toBe("");
    expect(colunas[9]).toBe("");
  });
});

// C4.3 — o CSV do painel ganha a coluna Canal (última, para não deslocar
// planilha salva por posição) e a coluna "Status do pagamento" passa a dizer
// "Recebido no balcão" numa venda presencial, em vez de mentir "na entrega".
// Molde: tests/front/admin-orders-exporta-csv.test.ts.
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order as Pedido } from "@/types";
import { describe, expect, it } from "vitest";

function pedido(alteracoes: Partial<Pedido> = {}): Pedido {
  return {
    id: "pedido-abc123",
    customer: {
      name: "João Silva",
      whatsapp: "11987654321",
      city: "São Paulo",
      state: "SP",
    },
    items: [],
    subtotal: 1234.5,
    shipping: 0,
    discount: 0,
    total: 1234.5,
    paymentMethod: "cash",
    status: "delivered",
    paymentStatus: "recebido_na_entrega",
    createdAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    updatedAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    cancelledAfterShipping: false,
    ...alteracoes,
  };
}

describe("pedidosParaCsv com a coluna Canal", () => {
  it("venda presencial vira 'Balcão' na última célula e 'Recebido no balcão' na coluna de pagamento", () => {
    const csv = pedidosParaCsv([pedido({ canal: "presencial" })]);
    const linha = csv.split("\r\n")[1];
    expect(linha.endsWith(";Balcão")).toBe(true);
    expect(csv).toContain(";Recebido no balcão;");
  });

  it("venda online vira 'Site' na última célula e 'Recebido na entrega' na coluna de pagamento", () => {
    const csv = pedidosParaCsv([pedido({ canal: "online" })]);
    const linha = csv.split("\r\n")[1];
    expect(linha.endsWith(";Site")).toBe(true);
    expect(csv).toContain(";Recebido na entrega;");
  });

  it("pedido sem `canal` (dado velho de fixture) vira 'Site' — nada quebra para trás", () => {
    const csv = pedidosParaCsv([pedido()]);
    const linha = csv.split("\r\n")[1];
    expect(linha.endsWith(";Site")).toBe(true);
  });

  it("o cabeçalho e a linha têm o mesmo número de separadores (14 ';', 15 colunas)", () => {
    const csv = pedidosParaCsv([pedido({ canal: "presencial" })]);
    const [cabecalho, linha] = csv.split("\r\n");
    const separadoresDoCabecalho = cabecalho.split(";").length - 1;
    const separadoresDaLinha = linha.split(";").length - 1;
    expect(separadoresDoCabecalho).toBe(14);
    expect(separadoresDaLinha).toBe(14);
  });

  it("'Balcão' com acento não quebra o escape CSV nem o BOM", () => {
    const csv = pedidosParaCsv([pedido({ canal: "presencial" })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // Nem aspas nem apóstrofo de neutralização: "Balcão" não começa com
    // =, +, -, @ nem contém ; " \r \n, então `escaparCampo` devolve como está.
    expect(csv).toContain(";Balcão");
    expect(csv).not.toContain('"Balcão"');
  });
});

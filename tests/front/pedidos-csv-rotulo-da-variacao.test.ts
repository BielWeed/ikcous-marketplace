import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order as Pedido } from "@/types";
import { describe, expect, it } from "vitest";

// A planilha é o que a lojista usa para separar a mercadoria: dois pedidos da
// mesma camiseta, tamanho M e tamanho GG, não podem sair com o mesmo texto.
function pedido(variantId?: string, nome = "Camiseta Básica"): Pedido {
  return {
    id: "pedido-abc123",
    customer: { name: "Ana", whatsapp: "11987654321" },
    items: [
      {
        productId: "produto-1",
        variantId,
        name: nome,
        quantity: 1,
        price: 49.9,
        image: "",
      },
    ],
    subtotal: 49.9,
    shipping: 0,
    discount: 0,
    total: 49.9,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus: "aguardando",
    createdAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    updatedAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    cancelledAfterShipping: false,
  };
}

const itensDa = (csv: string) => csv.split("\r\n")[1].split(";")[10];

describe("pedidosParaCsv com o rótulo da variação", () => {
  it("escreve 'Nome - Tamanho M (1 x 49,90)' e separa M de GG", () => {
    const rotulos = { "var-m": "Tamanho M", "var-gg": "Tamanho GG" };
    expect(itensDa(pedidosParaCsv([pedido("var-m")], rotulos))).toBe(
      "Camiseta Básica - Tamanho M (1 x 49,90)",
    );
    expect(itensDa(pedidosParaCsv([pedido("var-gg")], rotulos))).toBe(
      "Camiseta Básica - Tamanho GG (1 x 49,90)",
    );
  });

  it("item sem variação, ou sem rótulo no mapa, sai como antes", () => {
    expect(itensDa(pedidosParaCsv([pedido()], { "var-m": "Tamanho M" }))).toBe(
      "Camiseta Básica (1 x 49,90)",
    );
    expect(itensDa(pedidosParaCsv([pedido("var-x")], {}))).toBe(
      "Camiseta Básica (1 x 49,90)",
    );
    expect(itensDa(pedidosParaCsv([pedido("var-x")]))).toBe(
      "Camiseta Básica (1 x 49,90)",
    );
  });

  it("combinação 'Cor Azul · Tamanho M' entra inteira e as 15 colunas seguem iguais", () => {
    const csv = pedidosParaCsv([pedido("var-c")], {
      "var-c": "Cor Azul · Tamanho M",
    });
    expect(itensDa(csv)).toBe(
      "Camiseta Básica - Cor Azul · Tamanho M (1 x 49,90)",
    );
    expect(csv.split("\r\n")[1].split(";")).toHaveLength(15);
  });

  it("o rótulo também passa pela proteção contra fórmula e pelo escape de ponto e vírgula", () => {
    // (o `;` entre aspas não dá para separar por `;`, então confere por trecho)
    expect(pedidosParaCsv([pedido("v")], { v: "Cor A; B" })).toContain(
      ';"Camiseta Básica - Cor A; B (1 x 49,90)";',
    );
    expect(
      itensDa(pedidosParaCsv([pedido("v", "=1+1")], { v: "Tamanho M" })),
    ).toBe("'=1+1 - Tamanho M (1 x 49,90)");
  });
});

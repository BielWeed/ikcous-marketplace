// Achado b13 (caça de 03/11/2026) — na planilha de pedidos, a retirada na loja
// já pronta saía "Em Trânsito" enquanto a lista e a ficha do mesmo pedido
// diziam "Pronto para retirar". O CSV passa a usar `rotuloDoStatus`, a mesma
// regra das telas. Só o TEXTO muda; o cabeçalho (e a posição das colunas)
// continua igual.
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order as Pedido } from "@/types";
import { describe, expect, it } from "vitest";

function pedido(alteracoes: Partial<Pedido> = {}): Pedido {
  return {
    id: "pedido-abc123",
    customer: { name: "João Silva", whatsapp: "11987654321" },
    items: [],
    subtotal: 10,
    shipping: 0,
    discount: 0,
    total: 10,
    paymentMethod: "pix",
    status: "shipping",
    paymentStatus: "pago",
    createdAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    updatedAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    cancelledAfterShipping: false,
    ...alteracoes,
  };
}

function celulaDoStatus(p: Pedido): string {
  const [, linha] = pedidosParaCsv([p]).replace("\uFEFF", "").split("\r\n");
  return linha.split(";")[4];
}

describe("CSV de pedidos — coluna Status e retirada na loja", () => {
  it("retirada na loja em 'shipping' sai 'Pronto para retirar'", () => {
    expect(celulaDoStatus(pedido({ retiradaNaLoja: true }))).toBe(
      "Pronto para retirar",
    );
  });

  it("entrega (retirada falsa ou ausente) continua 'Em Trânsito'", () => {
    expect(celulaDoStatus(pedido({ retiradaNaLoja: false }))).toBe(
      "Em Trânsito",
    );
    expect(celulaDoStatus(pedido())).toBe("Em Trânsito");
  });

  it("retirada em outros status mantém o rótulo normal", () => {
    expect(
      celulaDoStatus(pedido({ retiradaNaLoja: true, status: "delivered" })),
    ).toBe("Finalizado");
  });
});

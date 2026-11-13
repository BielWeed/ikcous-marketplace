// A planilha de pedidos ganha a coluna "Entrega" (a última, depois de Canal,
// para não deslocar planilha salva por posição): a lojista separa o que busca,
// o que entrega ela mesma e o que vai por transportadora.
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order as Pedido } from "@/types";
import { describe, expect, it } from "vitest";

const CABECALHO_ATE_CANAL =
  "Número do pedido;Data;Cliente;Telefone;Status;Forma de pagamento;Status do pagamento;Total;Cidade;UF;Itens;Subtotal;Frete;Desconto;Canal";

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
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus: "aguardando_pagamento",
    createdAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    updatedAt: new Date(2026, 8, 8, 9, 7).toISOString(),
    cancelledAfterShipping: false,
    ...alteracoes,
  };
}

const colunasDaLinha = (csv: string) => csv.split("\r\n")[1].split(";");

describe("pedidosParaCsv com a coluna Entrega", () => {
  it("o cabeçalho antigo continua idêntico até 'Canal' e 'Entrega' vem por último", () => {
    const cabecalho = pedidosParaCsv([pedido()])
      .slice(1) /* tira o BOM */
      .split("\r\n")[0];
    expect(cabecalho.startsWith(`${CABECALHO_ATE_CANAL};`)).toBe(true);
    expect(cabecalho).toBe(`${CABECALHO_ATE_CANAL};Entrega`);
  });

  it("retirada na loja sai como 'Retirada na loja'", () => {
    const csv = pedidosParaCsv([
      pedido({ retiradaNaLoja: true, shippingOptionId: "store-pickup" }),
    ]);
    const colunas = colunasDaLinha(csv);
    expect(colunas).toHaveLength(16);
    expect(colunas[15]).toBe("Retirada na loja");
    expect(colunas[14]).toBe("Site");
  });

  it("entrega local (a própria loja entrega) sai como 'Entrega própria'", () => {
    const csv = pedidosParaCsv([
      pedido({ retiradaNaLoja: false, shippingOptionId: "local-delivery" }),
    ]);
    expect(colunasDaLinha(csv)[15]).toBe("Entrega própria");
  });

  it("envio por transportadora sai como 'Envio'", () => {
    const csv = pedidosParaCsv([
      pedido({ retiradaNaLoja: false, shippingOptionId: "sedex" }),
    ]);
    expect(colunasDaLinha(csv)[15]).toBe("Envio");
  });

  it("venda presencial (balcão) não tem entrega: sai 'Balcão'", () => {
    const csv = pedidosParaCsv([pedido({ canal: "presencial" })]);
    const colunas = colunasDaLinha(csv);
    expect(colunas[14]).toBe("Balcão");
    expect(colunas[15]).toBe("Balcão");
  });

  it("pedido antigo sem os campos de entrega vira 'Envio' e não quebra a linha", () => {
    // O fixture `pedido()` não declara nenhum dos dois: é o cache velho.
    const antigo = pedido();
    expect("retiradaNaLoja" in antigo).toBe(false);
    expect("shippingOptionId" in antigo).toBe(false);
    const colunas = colunasDaLinha(pedidosParaCsv([antigo]));
    expect(colunas).toHaveLength(16);
    expect(colunas[15]).toBe("Envio");
  });

  it("shippingOptionId nulo (carregador sem o retrato) também vira 'Envio'", () => {
    const csv = pedidosParaCsv([pedido({ shippingOptionId: null })]);
    expect(colunasDaLinha(csv)[15]).toBe("Envio");
  });

  it("retirada ganha de entrega local quando os dois sinais aparecem", () => {
    const csv = pedidosParaCsv([
      pedido({ retiradaNaLoja: true, shippingOptionId: "local-delivery" }),
    ]);
    expect(colunasDaLinha(csv)[15]).toBe("Retirada na loja");
  });
});

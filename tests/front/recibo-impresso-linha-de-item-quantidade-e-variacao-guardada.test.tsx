// @vitest-environment jsdom
//
// A linha de item do recibo IMPRESSO (OrderReceipt.tsx) tem três regras que
// nenhum outro teste prendia:
//   1. o valor da linha é preço x QUANTIDADE (3 unidades de R$ 12,50 = R$ 37,50),
//      formatado em pt-BR com milhar;
//   2. a variação gravada NA COMPRA (variacaoNomeNaCompra/ValorNaCompra) é o que
//      a lojista lê para separar o pedido, e ela VENCE o rótulo que a ficha
//      recalcula do catálogo (`variacoes`), que pode ter sido renomeado depois;
//   3. item sem variação não deixa um bloco de rótulo vazio embaixo do nome.
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Item = Order["items"][number];

function pedidoComItens(items: Item[]): Order {
  return {
    id: "pedido-1234567890",
    customer: {
      name: "Maria Teste",
      whatsapp: "11999999999",
      address: "Rua das Flores",
      number: "120",
      neighborhood: "Centro",
    },
    items,
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    cancelledAfterShipping: false,
  };
}

function item(extra: Partial<Item>): Item {
  return {
    productId: "prod-1",
    name: "Camiseta Lisa",
    price: 12.5,
    quantity: 1,
    image: "",
    ...extra,
  };
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderReceipt — linha de item do papel", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function imprimir(
    pedido: Order,
    variacoes?: Record<string, string>,
  ): Promise<HTMLElement[]> {
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} variacoes={variacoes} />);
    });
    const titulo = Array.from(document.querySelectorAll("p")).find(
      (p) => p.textContent === "ITENS:",
    );
    expect(titulo).toBeDefined();
    // Uma <div> por item dentro do bloco ITENS.
    return Array.from(
      titulo!.parentElement!.querySelectorAll<HTMLElement>(".space-y-1 > div"),
    );
  }

  it("o valor da linha é preço x quantidade, com milhar e vírgula do pt-BR", async () => {
    const linhas = await imprimir(
      pedidoComItens([
        item({ name: "Camiseta Lisa", price: 12.5, quantity: 3 }),
        item({
          productId: "prod-2",
          name: "Bolsa Couro",
          price: 1234.5,
          quantity: 2,
        }),
      ]),
    );
    expect(linhas).toHaveLength(2);
    expect(linhas[0]?.textContent).toContain("3x Camiseta Lisa");
    expect(linhas[0]?.textContent).toContain("R$ 37,50");
    expect(linhas[0]?.textContent).not.toContain("R$ 12,50");
    expect(linhas[1]?.textContent).toContain("2x Bolsa Couro");
    expect(linhas[1]?.textContent).toContain("R$ 2.469,00");
  });

  it("a variação gravada na compra aparece sob o nome, no formato 'Cor Azul · Tamanho M'", async () => {
    const linhas = await imprimir(
      pedidoComItens([
        item({
          variacaoNomeNaCompra: "Cor / Tamanho",
          variacaoValorNaCompra: "Azul / M",
        }),
      ]),
    );
    const rotulo = linhas[0]?.querySelector("span.block");
    expect(rotulo?.textContent).toBe("Cor Azul · Tamanho M");
  });

  it("a variação gravada na compra vence o rótulo do catálogo (que pode ter sido renomeado depois)", async () => {
    const linhas = await imprimir(
      pedidoComItens([
        item({
          variantId: "var-1",
          variacaoNomeNaCompra: "Tamanho",
          variacaoValorNaCompra: "M",
        }),
      ]),
      { "var-1": "Tamanho Médio (renomeado)" },
    );
    const rotulo = linhas[0]?.querySelector("span.block");
    expect(rotulo?.textContent).toBe("Tamanho M");
    expect(linhas[0]?.textContent).not.toContain("renomeado");
  });

  it("sem variação gravada, o rótulo do catálogo preenche o que faltou", async () => {
    const linhas = await imprimir(
      pedidoComItens([item({ variantId: "var-1" })]),
      { "var-1": "Cor Rosa" },
    );
    expect(linhas[0]?.querySelector("span.block")?.textContent).toBe(
      "Cor Rosa",
    );
  });

  it("item sem variação (nem gravada nem no catálogo) não deixa bloco de rótulo vazio", async () => {
    const linhas = await imprimir(
      pedidoComItens([
        item({ name: "Sem variação" }),
        item({
          productId: "prod-2",
          name: "Id sem rótulo",
          variantId: "var-9",
        }),
        item({
          productId: "prod-3",
          name: "Rótulo vazio",
          variantId: "var-3",
        }),
      ]),
      { "var-3": "" },
    );
    expect(linhas).toHaveLength(3);
    for (const linha of linhas) {
      expect(linha.querySelector("span.block")).toBeNull();
    }
  });
});

// @vitest-environment jsdom
//
// O pedido IMPRESSO mostrava só "rua, número" e o bairro; a ficha na tela
// (OrderDetail.tsx) mostra também complemento, cidade/UF, CEP e referência.
// O motoboy recebia "Rua X, 120 / Bairro" sem o "bloco B, apto 302" e sem a
// referência de como chegar. O papel passa a trazer as mesmas linhas da tela,
// e campo vazio não deixa linha em branco nem vírgula solta.
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function pedidoCom(cliente: Partial<Order["customer"]>): Order {
  return {
    id: "pedido-1234567890",
    customer: {
      name: "Maria Teste",
      whatsapp: "11999999999",
      address: "Rua das Flores",
      number: "120",
      neighborhood: "Centro",
      ...cliente,
    },
    items: [
      {
        productId: "prod-1",
        name: "Produto Teste",
        price: 100,
        quantity: 1,
        image: "",
      },
    ],
    subtotal: 100,
    shipping: 15,
    discount: 0,
    total: 115,
    paymentMethod: "pix",
    status: "pending",
    createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    cancelledAfterShipping: false,
  };
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderReceipt — o papel traz o endereço completo", () => {
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

  async function imprimir(pedido: Order): Promise<string[]> {
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} />);
    });
    // As linhas do bloco CLIENTE (uma por <p>), sem o título.
    const bloco = Array.from(hospedeiro.querySelectorAll("p")).find(
      (p) => p.textContent === "CLIENTE:",
    )?.parentElement;
    expect(bloco).toBeDefined();
    return Array.from(bloco!.querySelectorAll("p"))
      .map((p) => p.textContent ?? "")
      .slice(1);
  }

  it("mostra complemento, cidade/UF, CEP e referência — as mesmas linhas da ficha na tela", async () => {
    const linhas = await imprimir(
      pedidoCom({
        complement: "bloco B, apto 302",
        city: "Uberlândia",
        state: "MG",
        cep: "38400-000",
        reference: "portão verde, ao lado da padaria",
      }),
    );
    expect(linhas).toEqual([
      "Maria Teste",
      "11999999999",
      "Rua das Flores, 120 - bloco B, apto 302",
      "Centro • Uberlândia/MG • CEP: 38400-000 • Ref: portão verde, ao lado da padaria",
    ]);
  });

  it("campo vazio não deixa linha em branco, vírgula solta nem rótulo sem valor", async () => {
    const linhas = await imprimir(
      pedidoCom({
        complement: "",
        city: "",
        state: "MG",
        cep: "",
        reference: "   ",
      }),
    );
    // Estado sem cidade não aparece sozinho; referência só com espaço não vira
    // "Ref:" vazio.
    expect(linhas).toEqual([
      "Maria Teste",
      "11999999999",
      "Rua das Flores, 120",
      "Centro",
    ]);
  });

  it("endereço mínimo (sem complemento, cidade, CEP nem referência) fica igual ao de antes", async () => {
    const linhas = await imprimir(pedidoCom({}));
    expect(linhas).toEqual([
      "Maria Teste",
      "11999999999",
      "Rua das Flores, 120",
      "Centro",
    ]);
  });

  it("sem número da casa: não imprime vírgula solta; sem bairro nem nada depois: some a linha", async () => {
    const linhas = await imprimir(
      pedidoCom({ number: "", neighborhood: "", complement: "fundos" }),
    );
    expect(linhas).toEqual([
      "Maria Teste",
      "11999999999",
      "Rua das Flores - fundos",
    ]);
  });

  it("cidade sem bairro: a linha começa na cidade, sem separador na frente", async () => {
    const linhas = await imprimir(
      pedidoCom({ neighborhood: "", city: "Uberlândia", state: "MG" }),
    );
    expect(linhas[3]).toBe("Uberlândia/MG");
  });
});

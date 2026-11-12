// @vitest-environment jsdom
//
// Pedido de ENTREGA com frete zero: a tela da cliente (OrderDetailsView) diz
// "Grátis", mas o recibo impresso dizia "Frete R$ 0,00". A mesma venda tinha
// dois textos diferentes, um na tela e outro no papel. O papel agora diz
// "Grátis" nesse caso; a retirada na loja segue como sempre (R$ 0,00) e a
// entrega com frete cobrado segue mostrando o valor.
//
// Sem @testing-library/react — mesmo padrão de render direto com createRoot +
// act dos demais testes do recibo (ver recibo-impresso-mostra-o-desconto).
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function pedidoBase(overrides: Partial<Order> = {}): Order {
  return {
    id: "pedido-1234567890",
    customer: {
      name: "Maria Teste",
      whatsapp: "11999999999",
      address: "Rua das Flores",
      number: "100",
      neighborhood: "Centro",
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
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    cancelledAfterShipping: false,
    ...overrides,
  };
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderReceipt — frete zero na entrega diz 'Grátis', como a tela da cliente", () => {
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

  async function linhaDoFrete(pedido: Order): Promise<string | undefined> {
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} />);
    });
    const rotulo = [...document.body.querySelectorAll("span")].find(
      (el) => el.textContent === "Frete",
    );
    return rotulo?.nextElementSibling?.textContent ?? undefined;
  }

  it("entrega com frete 0: o papel diz 'Grátis', não 'R$ 0,00'", async () => {
    const frete = await linhaDoFrete(pedidoBase({ shipping: 0 }));
    expect(frete).toBe("Grátis");
  });

  it("entrega sem o campo de frete (nulo): também 'Grátis'", async () => {
    const frete = await linhaDoFrete(
      pedidoBase({ shipping: undefined as unknown as number }),
    );
    expect(frete).toBe("Grátis");
  });

  it("controle: entrega com frete cobrado segue mostrando o valor", async () => {
    const frete = await linhaDoFrete(
      pedidoBase({ shipping: 12.5, total: 112.5 }),
    );
    expect(frete).toBe("R$ 12,50");
  });

  it("controle: retirada na loja com frete 0 segue como sempre ('R$ 0,00')", async () => {
    const frete = await linhaDoFrete(
      pedidoBase({
        shipping: 0,
        retiradaNaLoja: true,
        enderecoDeRetirada: "Rua da Loja, 1",
      }),
    );
    expect(frete).toBe("R$ 0,00");
  });

  it("controle: venda de balcão continua sem linha de frete", async () => {
    const frete = await linhaDoFrete(pedidoBase({ canal: "presencial" }));
    expect(frete).toBeUndefined();
  });
});

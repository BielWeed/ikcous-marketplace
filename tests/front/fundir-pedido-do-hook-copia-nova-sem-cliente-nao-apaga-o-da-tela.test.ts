// A cópia do pedido que o realtime entrega pode vir SEM o objeto `customer`
// (campo ausente). A fusão em `src/lib/fundir-pedido-do-hook.ts` nunca pode
// transformar isso em tela sem cliente: o nome, o WhatsApp e o endereço que o
// `loadOrder` trouxe ficam. Os dois caminhos de fusão têm a mesma garantia.
import {
  fundirPedidoDoHook,
  manterItensEEnderecoDaTela,
} from "@/lib/fundir-pedido-do-hook";
import type { Order } from "@/types";
import { describe, expect, it } from "vitest";

const CLIENTE = {
  name: "Maria Teste",
  whatsapp: "11999990000",
  address: "Rua das Flores, 10",
};

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "pedido-1",
    customer: CLIENTE,
    items: [
      {
        productId: "prod-a",
        name: "Camiseta azul",
        price: 50,
        quantity: 1,
        image: "a.jpg",
      },
    ],
    subtotal: 50,
    shipping: 0,
    discount: 0,
    total: 50,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus: "aguardando",
    createdAt: "2026-11-24T10:00:00.000Z",
    updatedAt: "2026-11-24T10:05:00.000Z",
    cancelledAfterShipping: false,
    ...parcial,
  };
}

// Cliente de retirada na loja: sem endereço, então o ramo do endereço não decide.
const CLIENTE_SEM_ENDERECO = {
  name: "Maria Teste",
  whatsapp: "11999990000",
} as Order["customer"];

const semCliente = (): Partial<Order> => ({
  customer: undefined as unknown as Order["customer"],
});

describe("fundirPedidoDoHook — cópia nova sem `customer`", () => {
  it("a cópia mais nova sem cliente mantém o cliente da tela e leva o resto", () => {
    const daTela = pedido();
    const doHook = pedido({
      ...semCliente(),
      paymentStatus: "pago",
      updatedAt: "2026-11-24T10:06:00.000Z",
    });

    const fundido = fundirPedidoDoHook(daTela, doHook);

    expect(fundido.paymentStatus).toBe("pago");
    expect(fundido.customer).toEqual(CLIENTE);
  });
});

describe("sem endereço em nenhuma das duas cópias (retirada na loja)", () => {
  it("fundirPedidoDoHook: cópia nova sem cliente não apaga o cliente da tela", () => {
    const fundido = fundirPedidoDoHook(
      pedido({ customer: CLIENTE_SEM_ENDERECO }),
      pedido({
        ...semCliente(),
        paymentStatus: "pago",
        updatedAt: "2026-11-24T10:06:00.000Z",
      }),
    );

    expect(fundido.paymentStatus).toBe("pago");
    expect(fundido.customer).toEqual(CLIENTE_SEM_ENDERECO);
  });

  it("manterItensEEnderecoDaTela: cópia nova sem cliente não apaga o cliente da tela", () => {
    const resultado = manterItensEEnderecoDaTela(
      pedido({ customer: CLIENTE_SEM_ENDERECO }),
      pedido({ ...semCliente(), paymentStatus: "pago" }),
    );

    expect(resultado.paymentStatus).toBe("pago");
    expect(resultado.customer).toEqual(CLIENTE_SEM_ENDERECO);
  });
});

describe("manterItensEEnderecoDaTela — cópia nova sem `customer`", () => {
  it("mantém o cliente da tela", () => {
    const daTela = pedido();
    const nova = pedido({ ...semCliente(), paymentStatus: "pago" });

    const resultado = manterItensEEnderecoDaTela(daTela, nova);

    expect(resultado.paymentStatus).toBe("pago");
    expect(resultado.customer).toEqual(CLIENTE);
  });
});

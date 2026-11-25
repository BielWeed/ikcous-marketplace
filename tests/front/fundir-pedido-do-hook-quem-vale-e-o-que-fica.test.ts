// FUNDIR O PEDIDO DO HOOK NA TELA ABERTA — as bordas da decisão "a cópia do
// realtime é mais nova?" e da fusão que nunca esvazia a tela. Pedido fictício.
import { describe, expect, it } from "vitest";

import {
  fundirPedidoDoHook,
  manterItensEEnderecoDaTela,
} from "@/lib/fundir-pedido-do-hook";
import type { Order, OrderItem } from "@/types";

const ITEM_A: OrderItem = {
  productId: "prod-a",
  name: "Camiseta azul",
  price: 50,
  quantity: 1,
  image: "a.jpg",
};
const ITEM_B: OrderItem = {
  productId: "prod-b",
  name: "Bone preto",
  price: 30,
  quantity: 2,
  image: "b.jpg",
};

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "pedido-1",
    customer: {
      name: "Maria Teste",
      whatsapp: "11999990000",
      address: "Rua das Flores",
    },
    items: [ITEM_A],
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

const SEM_ENDERECO = {
  name: "Maria Teste",
  whatsapp: "11999990000",
};

describe("fundirPedidoDoHook — só a cópia ESTRITAMENTE mais nova vale", () => {
  it("cópia do hook mais nova: os campos dela vencem", () => {
    const atual = pedido();
    const doHook = pedido({
      paymentStatus: "pago",
      status: "processing",
      updatedAt: "2026-11-24T10:05:00.001Z",
    });
    const fundido = fundirPedidoDoHook(atual, doHook);
    expect(fundido.paymentStatus).toBe("pago");
    expect(fundido.status).toBe("processing");
    expect(fundido.updatedAt).toBe("2026-11-24T10:05:00.001Z");
  });

  it("mesma data (empate): a tela fica como está, MESMA referência", () => {
    const atual = pedido();
    const doHook = pedido({ paymentStatus: "pago" });
    expect(fundirPedidoDoHook(atual, doHook)).toBe(atual);
  });

  it("cópia do hook mais velha: nunca desfaz o que a tela acabou de buscar", () => {
    const atual = pedido({ paymentStatus: "pago" });
    const doHook = pedido({
      paymentStatus: "aguardando",
      updatedAt: "2026-11-24T10:04:59.999Z",
    });
    expect(fundirPedidoDoHook(atual, doHook)).toBe(atual);
  });

  it("data ilegível na cópia do hook, ou ausente na tela: a tela fica, mesma referência", () => {
    const atual = pedido();
    expect(
      fundirPedidoDoHook(
        atual,
        pedido({ paymentStatus: "pago", updatedAt: "ontem de manhã" }),
      ),
    ).toBe(atual);
    expect(
      fundirPedidoDoHook(
        atual,
        pedido({
          paymentStatus: "pago",
          updatedAt: undefined as unknown as string,
        }),
      ),
    ).toBe(atual);

    const telaSemData = pedido({ updatedAt: undefined as unknown as string });
    expect(
      fundirPedidoDoHook(telaSemData, pedido({ paymentStatus: "pago" })),
    ).toBe(telaSemData);
    const telaComDataTorta = pedido({ updatedAt: "lixo" });
    expect(
      fundirPedidoDoHook(telaComDataTorta, pedido({ paymentStatus: "pago" })),
    ).toBe(telaComDataTorta);
  });

  it("campo undefined na cópia nova não apaga o que a tela já tem", () => {
    const atual = pedido({
      trackingCode: "BR123",
      notes: "deixar na portaria",
    });
    const doHook = pedido({
      paymentStatus: "pago",
      updatedAt: "2026-11-24T11:00:00.000Z",
      trackingCode: undefined,
      notes: undefined,
    });
    const fundido = fundirPedidoDoHook(atual, doHook);
    expect(fundido.trackingCode).toBe("BR123");
    expect(fundido.notes).toBe("deixar na portaria");
    expect(fundido.paymentStatus).toBe("pago");
  });

  it("null na cópia nova APAGA: só undefined é 'não veio'", () => {
    const atual = pedido({ pagamentoRecebidoEm: "2026-11-24T10:00:00.000Z" });
    const doHook = pedido({
      updatedAt: "2026-11-24T11:00:00.000Z",
      pagamentoRecebidoEm: null,
    });
    expect(fundirPedidoDoHook(atual, doHook).pagamentoRecebidoEm).toBeNull();
  });
});

describe("fundirPedidoDoHook — itens e endereço que o realtime não traz", () => {
  const NOVA = "2026-11-24T11:00:00.000Z";

  it("cópia nova sem itens (lista vazia): ficam os itens da tela", () => {
    const atual = pedido({ items: [ITEM_A, ITEM_B] });
    const fundido = fundirPedidoDoHook(
      atual,
      pedido({ items: [], updatedAt: NOVA }),
    );
    expect(fundido.items).toEqual([ITEM_A, ITEM_B]);
  });

  it("cópia nova com itens: os dela valem", () => {
    const atual = pedido({ items: [ITEM_A] });
    const fundido = fundirPedidoDoHook(
      atual,
      pedido({ items: [ITEM_B], updatedAt: NOVA }),
    );
    expect(fundido.items).toEqual([ITEM_B]);
  });

  it("cópia nova com itens ausentes (undefined, cache antigo): ficam os da tela", () => {
    const atual = pedido({ items: [ITEM_A] });
    const fundido = fundirPedidoDoHook(
      atual,
      pedido({ items: undefined as unknown as OrderItem[], updatedAt: NOVA }),
    );
    expect(fundido.items).toEqual([ITEM_A]);
  });

  it("cópia nova sem endereço: o cliente da tela (com endereço) fica inteiro", () => {
    const atual = pedido();
    const fundido = fundirPedidoDoHook(
      atual,
      pedido({ customer: SEM_ENDERECO, updatedAt: NOVA }),
    );
    expect(fundido.customer).toBe(atual.customer);
  });

  it("cópia nova sem cliente nenhum: fica o cliente da tela", () => {
    const atual = pedido();
    const fundido = fundirPedidoDoHook(
      atual,
      pedido({
        customer: undefined as unknown as Order["customer"],
        updatedAt: NOVA,
      }),
    );
    expect(fundido.customer).toBe(atual.customer);
  });

  it("cópia nova com endereço: o cliente dela vale", () => {
    const atual = pedido();
    const doHook = pedido({
      customer: {
        name: "Maria Teste",
        whatsapp: "11999990000",
        address: "Avenida Nova, 10",
      },
      updatedAt: NOVA,
    });
    expect(fundirPedidoDoHook(atual, doHook).customer.address).toBe(
      "Avenida Nova, 10",
    );
  });

  it("nem a tela nem a cópia nova têm endereço: o cliente da cópia nova vale", () => {
    const atual = pedido({ customer: SEM_ENDERECO });
    const doHook = pedido({
      customer: { ...SEM_ENDERECO, name: "Maria Souza" },
      updatedAt: NOVA,
    });
    expect(fundirPedidoDoHook(atual, doHook).customer.name).toBe("Maria Souza");
  });
});

describe("manterItensEEnderecoDaTela — a cópia nova nunca esvazia a tela", () => {
  it("nova sem itens e sem endereço: ficam os da tela; o resto vem da nova", () => {
    const daTela = pedido({ items: [ITEM_A, ITEM_B], status: "pending" });
    const nova = pedido({
      items: [],
      customer: SEM_ENDERECO,
      status: "processing",
    });
    const resultado = manterItensEEnderecoDaTela(daTela, nova);
    expect(resultado.items).toEqual([ITEM_A, ITEM_B]);
    expect(resultado.customer).toBe(daTela.customer);
    expect(resultado.status).toBe("processing");
  });

  it("nova sem itens ausentes (undefined): ficam os da tela", () => {
    const daTela = pedido({ items: [ITEM_A] });
    const nova = pedido({ items: undefined as unknown as OrderItem[] });
    expect(manterItensEEnderecoDaTela(daTela, nova).items).toEqual([ITEM_A]);
  });

  it("nova sem cliente nenhum: fica o cliente da tela", () => {
    const daTela = pedido();
    const nova = pedido({
      customer: undefined as unknown as Order["customer"],
    });
    expect(manterItensEEnderecoDaTela(daTela, nova).customer).toBe(
      daTela.customer,
    );
  });

  it("nova com itens e endereço: vale como veio", () => {
    const daTela = pedido({ items: [ITEM_A] });
    const nova = pedido({
      items: [ITEM_B],
      customer: {
        name: "Maria Teste",
        whatsapp: "11999990000",
        address: "Avenida Nova, 10",
      },
    });
    const resultado = manterItensEEnderecoDaTela(daTela, nova);
    expect(resultado.items).toEqual([ITEM_B]);
    expect(resultado.customer.address).toBe("Avenida Nova, 10");
  });

  it("nem a tela tem endereço: o cliente da nova vale", () => {
    const daTela = pedido({ customer: SEM_ENDERECO });
    const nova = pedido({ customer: { ...SEM_ENDERECO, name: "Maria Souza" } });
    expect(manterItensEEnderecoDaTela(daTela, nova).customer.name).toBe(
      "Maria Souza",
    );
  });
});

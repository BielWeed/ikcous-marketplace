// `escolherVersaoDoPedido` (`src/lib/versao-do-pedido.ts`): duas bordas que
// `versao-do-pedido.test.ts` deixava passar.
//
//  1. Pedidos de ids DIFERENTES não se comparam: a que chegou é a do pedido
//     novo, MESMO que a data dela seja mais velha que a do pedido que estava na
//     tela (trocar de pedido na tela não pode voltar o pedido antigo).
//  2. Campo que aparece só na versão que chegou (código de rastreio, etiqueta)
//     é conteúdo diferente: com a mesma `updatedAt`, a tela passa a mostrar o
//     campo novo. Comparar só os campos que a tela já tinha deixaria o pedido
//     congelado sem o rastreio.
import { escolherVersaoDoPedido } from "@/lib/versao-do-pedido";
import type { Order } from "@/types";
import { describe, expect, it } from "vitest";

const base: Order = {
  id: "pedido-1",
  customer: { name: "Cliente", whatsapp: "34999999999" },
  items: [
    { productId: "p1", name: "Blusa", price: 10, quantity: 1, image: "" },
  ],
  subtotal: 10,
  shipping: 0,
  discount: 0,
  total: 10,
  paymentMethod: "online",
  status: "pending",
  paymentStatus: "aguardando",
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
  cancelledAfterShipping: false,
};

describe("escolherVersaoDoPedido — ids diferentes", () => {
  it("o pedido que chegou ganha mesmo com data mais velha que a do pedido da tela", () => {
    const outroPedidoMaisVelho: Order = {
      ...base,
      id: "pedido-2",
      updatedAt: "2026-10-14T08:00:00.000Z",
    };
    expect(escolherVersaoDoPedido(base, outroPedidoMaisVelho)).toBe(
      outroPedidoMaisVelho,
    );
  });
});

describe("escolherVersaoDoPedido — campo que só existe na versão que chegou", () => {
  it("mesma data, mas a que chegou tem o rastreio: ganha a que chegou", () => {
    const comRastreio: Order = { ...base, trackingCode: "BR123456789" };
    expect(escolherVersaoDoPedido(base, comRastreio)).toBe(comRastreio);
  });

  it("mesma data, a da tela tem um campo que a que chegou não tem: ganha a que chegou", () => {
    const comRastreio: Order = { ...base, trackingCode: "BR123456789" };
    expect(escolherVersaoDoPedido(comRastreio, base)).toBe(base);
  });

  it("mesmo conteúdo, objetos novos: continua valendo a referência da tela", () => {
    const copia: Order = { ...base, items: base.items.map((i) => ({ ...i })) };
    expect(escolherVersaoDoPedido(base, copia)).toBe(base);
  });
});

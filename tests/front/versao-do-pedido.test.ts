// A regra de "qual versão do pedido a tela mostra" (versao-do-pedido.ts),
// medida sem montar tela: mais velha nunca ganha, igual não troca nada (mesma
// referência, nenhum render à toa), diferente e não mais velha ganha.
import { describe, expect, it } from "vitest";

import { escolherVersaoDoPedido } from "@/lib/versao-do-pedido";
import type { Order } from "@/types";

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

describe("escolherVersaoDoPedido", () => {
  it("versão mais nova e diferente: ganha a que chegou", () => {
    const nova = {
      ...base,
      paymentStatus: "pago" as const,
      updatedAt: "2026-10-14T10:05:00.000Z",
    };
    expect(escolherVersaoDoPedido(base, nova)).toBe(nova);
  });

  it("versão estritamente mais velha: fica a que já estava", () => {
    const velha = { ...base, updatedAt: "2026-10-14T09:00:00.000Z" };
    expect(escolherVersaoDoPedido(base, velha)).toBe(base);
  });

  it("mesmo conteúdo em objeto novo (uma busca refeita): fica a mesma referência", () => {
    const copia: Order = JSON.parse(JSON.stringify(base));
    expect(escolherVersaoDoPedido(base, copia)).toBe(base);
  });

  it("mesma data de atualização, conteúdo diferente (o cancelamento otimista da lista e o desfazer dele): ganha a que chegou", () => {
    const cancelado = { ...base, status: "cancelled" as const };
    expect(escolherVersaoDoPedido(base, cancelado)).toBe(cancelado);
    expect(escolherVersaoDoPedido(cancelado, base)).toBe(base);
  });

  it("data ausente ou ilegível não conta como 'velha': decide o conteúdo", () => {
    const semData = {
      ...base,
      paymentStatus: "pago" as const,
      updatedAt: undefined as unknown as string,
    };
    expect(escolherVersaoDoPedido(base, semData)).toBe(semData);
  });

  it("diferença só dentro de um item também conta como conteúdo diferente", () => {
    const outraQuantidade = {
      ...base,
      items: [{ ...base.items[0], quantity: 2 }],
    };
    expect(escolherVersaoDoPedido(base, outraQuantidade)).toBe(outraQuantidade);
  });

  it("pedido de outro id: vale o que chegou", () => {
    const outro = { ...base, id: "pedido-2" };
    expect(escolherVersaoDoPedido(base, outro)).toBe(outro);
  });
});

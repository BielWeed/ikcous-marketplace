// A comparação por CONTEÚDO que decide se a tela troca de versão do pedido
// (`src/lib/versao-do-pedido.ts`). O teste do módulo usa pedidos "bem
// comportados"; aqui ficam as formas de dado que o servidor também entrega e
// que, tratadas errado, derrubam a tela ou deixam um dado velho na frente:
//   · campo nulo numa versão e objeto na outra NÃO pode lançar erro (a leitura
//     de chaves de `null` quebraria a tela do pedido aberta);
//   · lista e objeto com as mesmas entradas não são o mesmo conteúdo;
//   · campo com número inválido (NaN) igual nas duas versões é o MESMO conteúdo
//     (senão a tela re-renderiza a cada eco do tempo real, sem mudança);
//   · campos de nomes diferentes são conteúdo diferente, mesmo com valor ausente.
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

const comCampo = (campo: string, valor: unknown): Order =>
  ({ ...base, [campo]: valor }) as Order;

describe("escolherVersaoDoPedido — formas de dado do servidor", () => {
  it("campo nulo na tela e objeto na versão nova: ganha a nova, sem lançar erro", () => {
    const atual = comCampo("extra", null);
    const chegou = comCampo("extra", { codigo: "AB123" });
    expect(escolherVersaoDoPedido(atual, chegou)).toBe(chegou);
  });

  it("objeto na tela e campo nulo na versão nova: ganha a nova, sem lançar erro", () => {
    const atual = comCampo("extra", { codigo: "AB123" });
    const chegou = comCampo("extra", null);
    expect(escolherVersaoDoPedido(atual, chegou)).toBe(chegou);
  });

  it("número, texto ou booleano de um lado e objeto VAZIO do outro: conteúdo diferente, nos dois sentidos", () => {
    for (const valor of [5, "texto", true]) {
      const comValor = comCampo("extra", valor);
      const comObjeto = comCampo("extra", {});
      expect(escolherVersaoDoPedido(comValor, comObjeto), String(valor)).toBe(
        comObjeto,
      );
      expect(escolherVersaoDoPedido(comObjeto, comValor), String(valor)).toBe(
        comValor,
      );
    }
  });

  it("lista na tela e objeto com as mesmas entradas na versão nova: conteúdo diferente", () => {
    const atual = comCampo("extra", ["a", "b"]);
    const chegou = comCampo("extra", { 0: "a", 1: "b" });
    expect(escolherVersaoDoPedido(atual, chegou)).toBe(chegou);
  });

  it("objeto na tela e lista com as mesmas entradas na versão nova: conteúdo diferente", () => {
    const atual = comCampo("extra", { 0: "a", 1: "b" });
    const chegou = comCampo("extra", ["a", "b"]);
    expect(escolherVersaoDoPedido(atual, chegou)).toBe(chegou);
  });

  it("número inválido (NaN) igual nas duas versões é o mesmo conteúdo: fica a da tela", () => {
    const atual = comCampo("total", Number.NaN);
    const chegou = comCampo("total", Number.NaN);
    expect(escolherVersaoDoPedido(atual, chegou)).toBe(atual);
  });

  it("campo ausente numa versão e outro campo ausente na outra: conteúdo diferente", () => {
    const atual = comCampo("campoA", undefined);
    const chegou = comCampo("campoB", undefined);
    expect(escolherVersaoDoPedido(atual, chegou)).toBe(chegou);
  });

  it("lista de itens com a mesma quantidade mas item trocado: ganha a nova", () => {
    const chegou: Order = {
      ...base,
      items: [
        { productId: "p2", name: "Calça", price: 10, quantity: 1, image: "" },
      ],
    };
    expect(escolherVersaoDoPedido(base, chegou)).toBe(chegou);
  });

  it("mesmas listas em objetos novos: fica a da tela (nenhum render à toa)", () => {
    const chegou: Order = JSON.parse(JSON.stringify(base));
    expect(escolherVersaoDoPedido(base, chegou)).toBe(base);
  });
});

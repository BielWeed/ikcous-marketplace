import { mesmoIdDePedido } from "@/lib/numero-do-pedido";
import { describe, expect, it } from "vitest";

// `mesmoIdDePedido` decide se a tela de detalhe "achou" o pedido do link. Errar
// para menos mostra "Pedido não encontrado" para um link certo; errar para
// mais (dois ids ausentes se acharem iguais) abriria um pedido que não é o do
// link. O teste vizinho (`numero-do-pedido.test.ts`) só cobre `numeroDoPedido`.
const ID = "3f2b8c1e-7a44-4d0e-9b61-0c5d2e8a91ab";

describe("mesmoIdDePedido", () => {
  it("o mesmo id é o mesmo pedido", () => {
    expect(mesmoIdDePedido(ID, ID)).toBe(true);
  });

  it("não diferencia maiúscula de minúscula (link colado em caixa alta)", () => {
    expect(mesmoIdDePedido(ID.toUpperCase(), ID)).toBe(true);
    expect(mesmoIdDePedido(ID, ID.toUpperCase())).toBe(true);
  });

  it("ids diferentes, mesmo parecidos, não são o mesmo pedido", () => {
    expect(mesmoIdDePedido(ID, `${ID.slice(0, -1)}c`)).toBe(false);
    expect(mesmoIdDePedido(ID, ID.slice(1))).toBe(false);
  });

  it("ausente nunca é igual a nada, nem a outro ausente", () => {
    expect(mesmoIdDePedido(undefined, undefined)).toBe(false);
    expect(mesmoIdDePedido(null, null)).toBe(false);
    expect(mesmoIdDePedido("", "")).toBe(false);
    expect(mesmoIdDePedido(undefined, ID)).toBe(false);
    expect(mesmoIdDePedido(ID, null)).toBe(false);
    expect(mesmoIdDePedido("", ID)).toBe(false);
  });
});

// Duas comparações que decidem o que sai no papel e nas telas e que nenhum
// teste prendia nas bordas:
//   - "Recebe: X" só aparece se X for OUTRA pessoa. A comparação ignora acento,
//     caixa e espaço sobrando — também no nome de QUEM COMPROU (não só no de quem
//     recebe), senão "José  Antonio" (dois espaços, comum em digitação) viraria
//     "outra pessoa" e o papel traria um "Recebe:" repetido;
//   - `mesmoIdDePedido` compara o id do link com o do banco sem diferença de
//     maiúscula, e nunca casa ausência com ausência.
import { mesmoIdDePedido } from "@/lib/numero-do-pedido";
import { quemVaiReceberSeForOutro } from "@/lib/quem-vai-receber";
import { describe, expect, it } from "vitest";

describe("quemVaiReceberSeForOutro — o nome de quem comprou também é normalizado", () => {
  it("comprador com espaço duplo e caixa diferente é a mesma pessoa", () => {
    expect(quemVaiReceberSeForOutro("José  ANTONIO", "jose antonio")).toBe("");
    expect(
      quemVaiReceberSeForOutro("  Maria   da Silva ", "MARIA DA SILVA"),
    ).toBe("");
  });

  it("devolve o nome de quem recebe com espaços ajustados quando é outra pessoa", () => {
    expect(quemVaiReceberSeForOutro("Maria Souza", "  Ana   Sousa ")).toBe(
      "Ana Sousa",
    );
  });

  it("sem nome de comprador, qualquer nome de quem recebe vale", () => {
    expect(quemVaiReceberSeForOutro(undefined, "Ana")).toBe("Ana");
    expect(quemVaiReceberSeForOutro(null, "Ana")).toBe("Ana");
  });
});

describe("mesmoIdDePedido", () => {
  it("ignora maiúscula: o link guarda a caixa colada, o banco devolve minúscula", () => {
    expect(
      mesmoIdDePedido(
        "AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB",
        "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb",
      ),
    ).toBe(true);
  });

  it("ids diferentes não casam", () => {
    expect(mesmoIdDePedido("abc-1", "abc-2")).toBe(false);
  });

  it("ausente não casa com ausente nem com id", () => {
    expect(mesmoIdDePedido(undefined, undefined)).toBe(false);
    expect(mesmoIdDePedido(null, null)).toBe(false);
    expect(mesmoIdDePedido("", "")).toBe(false);
    expect(mesmoIdDePedido("abc", undefined)).toBe(false);
    expect(mesmoIdDePedido(null, "abc")).toBe(false);
  });
});

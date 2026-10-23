// Nome de loja so com simbolos ("★★") dava iniciais vazias e o avatar ficava
// em branco. Agora cai numa letra de reserva (nome de marca do build) e, por
// ultimo, num caractere neutro.
import { describe, expect, it } from "vitest";

import { iniciaisDaLoja } from "@/lib/iniciais-da-loja";

describe("iniciaisDaLoja com reserva", () => {
  it.each([
    ["Savy", "SA"],
    ["Savy Collection", "SC"],
  ])("'%s' vira '%s'", (nome, esperado) => {
    expect(iniciaisDaLoja(nome, "Aurora")).toBe(esperado);
  });

  it.each(["★★", "", "   "])(
    "'%s' cai na primeira letra do nome de marca",
    (nome) => {
      expect(iniciaisDaLoja(nome, "Aurora")).toBe("A");
    },
  );

  it("sem nada aproveitável, devolve um caractere neutro (nunca vazio)", () => {
    expect(iniciaisDaLoja("★★", "")).toBe("•");
    expect(iniciaisDaLoja("", "★")).toBe("•");
    expect(iniciaisDaLoja("★★")).toBe("•");
  });
});

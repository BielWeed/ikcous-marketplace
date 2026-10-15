// Concordância de "restam/resta" fora da vitrine (o #894 cobriu o cartão e a
// página do produto): com 1 unidade sobrando, "Só restam 1" estava errado.
import { describe, expect, it } from "vitest";

import { textoSoRestam } from "@/lib/texto-estoque-baixo";

describe("textoSoRestam — concordância em número", () => {
  it("1 unidade: 'Só resta 1'", () => {
    expect(textoSoRestam(1)).toBe("Só resta 1");
  });

  it("2 ou mais: 'Só restam N'", () => {
    expect(textoSoRestam(2)).toBe("Só restam 2");
    expect(textoSoRestam(3)).toBe("Só restam 3");
  });
});

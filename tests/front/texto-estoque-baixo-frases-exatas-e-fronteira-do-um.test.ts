// As duas frases de estoque baixo (`src/lib/texto-estoque-baixo.ts`): o teste
// que existia só olhava `textoSoRestam`. Aqui as duas frases, palavra por
// palavra, e a fronteira do singular: SÓ o 1 é singular; zero e os demais
// (inclusive número quebrado de dado ruim) ficam no plural, e o número escrito
// é sempre o mesmo que veio.
import { textoEstoqueBaixo, textoSoRestam } from "@/lib/texto-estoque-baixo";
import { describe, expect, it } from "vitest";

describe("textoEstoqueBaixo (vitrine)", () => {
  it("uma unidade: singular, com exclamação e o número 1", () => {
    expect(textoEstoqueBaixo(1)).toBe("Resta apenas 1!");
  });

  it.each([
    [2, "Restam apenas 2!"],
    [5, "Restam apenas 5!"],
    [10, "Restam apenas 10!"],
  ])("%i unidades: plural com o número", (quantidade, esperado) => {
    expect(textoEstoqueBaixo(quantidade)).toBe(esperado);
  });

  it("zero não é singular", () => {
    expect(textoEstoqueBaixo(0)).toBe("Restam apenas 0!");
  });
});

describe("textoSoRestam (toasts e avisos do carrinho)", () => {
  it("uma unidade: singular, sem exclamação", () => {
    expect(textoSoRestam(1)).toBe("Só resta 1");
  });

  it.each([
    [2, "Só restam 2"],
    [7, "Só restam 7"],
    [100, "Só restam 100"],
  ])("%i unidades: plural com o número", (quantidade, esperado) => {
    expect(textoSoRestam(quantidade)).toBe(esperado);
  });

  it("zero não é singular", () => {
    expect(textoSoRestam(0)).toBe("Só restam 0");
  });

  it("as duas frases usam a mesma fronteira do singular", () => {
    for (const quantidade of [-1, 0, 1, 1.5, 2]) {
      const singularNaVitrine =
        textoEstoqueBaixo(quantidade).startsWith("Resta ");
      const singularNoCarrinho =
        textoSoRestam(quantidade).startsWith("Só resta ");
      expect(singularNaVitrine, String(quantidade)).toBe(singularNoCarrinho);
      expect(singularNaVitrine, String(quantidade)).toBe(quantidade === 1);
    }
  });
});

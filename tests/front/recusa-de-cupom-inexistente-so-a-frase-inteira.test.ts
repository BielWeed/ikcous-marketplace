// `ehRecusaDeCupomInexistente` decide se o checkout tenta o código por OUTRA
// grafia (segunda consulta ao servidor). Só a frase inteira de "este código não
// existe" pode disparar isso. Achado por mutação, 24/11/2026: tirar a âncora
// do começo, a do fim, ou aceitar só a grafia com acento passava com a suíte
// verde — uma frase que apenas CONTÉM "cupom inválido ou expirado" (ou a mesma
// frase sem acento) mudava o que o checkout faz com a recusa.
import { ehRecusaDeCupomInexistente } from "@/lib/codigo-do-cupom";
import { describe, expect, it } from "vitest";

describe("ehRecusaDeCupomInexistente — frase inteira, nem mais nem menos", () => {
  it("frase que só CONTÉM a recusa não conta; a mesma frase sem acento, sem ponto ou em caixa alta conta", () => {
    expect(
      ehRecusaDeCupomInexistente("Erro: Cupom inválido ou expirado."),
    ).toBe(false);
    expect(
      ehRecusaDeCupomInexistente(
        "Cupom inválido ou expirado por limite de uso",
      ),
    ).toBe(false);
    expect(ehRecusaDeCupomInexistente("Cupom inválido ou expirado!!")).toBe(
      false,
    );

    expect(ehRecusaDeCupomInexistente("Cupom invalido ou expirado.")).toBe(
      true,
    );
    expect(ehRecusaDeCupomInexistente("Cupom inválido ou expirado")).toBe(true);
    expect(ehRecusaDeCupomInexistente("CUPOM INVÁLIDO OU EXPIRADO.")).toBe(
      true,
    );
  });
});

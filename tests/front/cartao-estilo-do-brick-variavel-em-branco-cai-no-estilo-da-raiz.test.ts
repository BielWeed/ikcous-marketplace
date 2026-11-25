// @vitest-environment jsdom
//
// A cor da loja no Card Payment Brick quando o navegador NÃO devolve a
// variável calculada (`src/components/checkout/estilo-do-brick.ts`).
// Achado por mutação: tirar o plano B de `lerVariavel` (o valor do atributo
// `style` da própria raiz) não derrubava teste nenhum, porque o jsdom calcula
// a variável sozinho. Num navegador de verdade, a raiz solta (fora da página)
// devolve o calculado vazio — e sem o plano B o Brick sairia com a cor
// padrão do Mercado Pago em vez da cor da loja.
import { afterEach, describe, expect, it, vi } from "vitest";

import { estiloDoBrick } from "@/components/checkout/estilo-do-brick";

function raizComEstilo(primaria: string, sobre: string): HTMLElement {
  const raiz = document.createElement("div");
  raiz.style.setProperty("--primary", primaria);
  raiz.style.setProperty("--primary-foreground", sobre);
  return raiz;
}

function calculadoDevolve(porVariavel: Record<string, string>): void {
  const mapa = new Map(Object.entries(porVariavel));
  vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: (nome: string) => mapa.get(nome) ?? "",
      }) as unknown as CSSStyleDeclaration,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("estiloDoBrick — plano B quando o calculado vem em branco", () => {
  it("calculado vazio: vale o valor do atributo style da raiz", () => {
    calculadoDevolve({});
    const v = estiloDoBrick(raizComEstilo("120 100% 50%", "0 0% 0%")).style
      .customVariables;
    expect(v.baseColor).toBe("#00ff00");
    expect(v.outlinePrimaryColor).toBe("#00ff00");
    expect(v.buttonTextColor).toBe("#000000");
  });

  it("calculado só com espaços (como o navegador devolve variável sem valor): também cai no atributo style", () => {
    calculadoDevolve({ "--primary": "   ", "--primary-foreground": " \n " });
    const v = estiloDoBrick(raizComEstilo("120 100% 50%", "0 0% 0%")).style
      .customVariables;
    expect(v.baseColor).toBe("#00ff00");
    expect(v.buttonTextColor).toBe("#000000");
  });

  it("calculado preenchido VENCE o atributo style (o plano B só entra quando falta)", () => {
    calculadoDevolve({
      "--primary": " 240 100% 50%",
      "--primary-foreground": "0 0% 100% ",
    });
    const v = estiloDoBrick(raizComEstilo("120 100% 50%", "0 0% 0%")).style
      .customVariables;
    expect(v.baseColor).toBe("#0000ff");
    expect(v.buttonTextColor).toBe("#ffffff");
  });

  it("calculado vazio e sem atributo style: nenhuma cor da loja entra (nada inventado)", () => {
    calculadoDevolve({});
    const v = estiloDoBrick(document.createElement("div")).style
      .customVariables;
    expect(v.baseColor).toBeUndefined();
    expect(v.buttonTextColor).toBeUndefined();
    expect(v.fontSizeMedium).toBe("16px");
  });
});

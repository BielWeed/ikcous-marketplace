// @vitest-environment jsdom
//
// A cor da loja no Card Payment Brick (`src/components/checkout/estilo-do-brick.ts`):
// a conversão HSL do Tailwind -> hexadecimal (cores de referência do CSS), cada
// regra que faz um valor virar "não é cor" e a escala das variantes de hover.
// O teste do redesenho só cobre três cores e seis entradas ruins.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  estiloDoBrick,
  hslDoTailwindParaHex,
} from "@/components/checkout/estilo-do-brick";

describe("hslDoTailwindParaHex — cores de referência do CSS", () => {
  it.each([
    ["0 0% 0%", "#000000"],
    ["0 0% 100%", "#ffffff"],
    ["0 100% 50%", "#ff0000"],
    ["30 100% 50%", "#ff8000"],
    ["60 100% 50%", "#ffff00"],
    ["120 100% 50%", "#00ff00"],
    ["180 100% 50%", "#00ffff"],
    ["240 100% 50%", "#0000ff"],
    ["300 100% 50%", "#ff00ff"],
    ["0 100% 25%", "#800000"],
    ["210 50% 50%", "#4080bf"],
    ["0 0% 50%", "#808080"],
    ["0 100% 75%", "#ff8080"],
    ["210 50% 75%", "#9fbfdf"],
    ["90 100% 50%", "#80ff00"],
  ])("hsl(%s) -> %s", (entrada, hex) => {
    expect(hslDoTailwindParaHex(entrada)).toBe(hex);
  });

  it("canal baixo sai com dois dígitos (zero à esquerda)", () => {
    expect(hslDoTailwindParaHex("0 100% 2%")).toBe("#0a0000");
    expect(hslDoTailwindParaHex("120 100% 2%")).toBe("#000a00");
    expect(hslDoTailwindParaHex("240 100% 2%")).toBe("#00000a");
  });

  it("matiz de 360 volta ao 0 e matiz negativo dá a volta ao círculo", () => {
    expect(hslDoTailwindParaHex("360 100% 50%")).toBe("#ff0000");
    expect(hslDoTailwindParaHex("-60 100% 50%")).toBe("#ff00ff");
    expect(hslDoTailwindParaHex("-120 100% 50%")).toBe("#0000ff");
  });

  it("matiz acima de 360 dá a volta: 450 é o mesmo que 90, 720 o mesmo que 0", () => {
    expect(hslDoTailwindParaHex("450 100% 50%")).toBe("#80ff00");
    expect(hslDoTailwindParaHex("361 100% 50%")).toBe(
      hslDoTailwindParaHex("1 100% 50%"),
    );
    expect(hslDoTailwindParaHex("720 100% 50%")).toBe("#ff0000");
  });

  it("espaço sobrando em volta e entre as partes é aceito; decimais também", () => {
    expect(hslDoTailwindParaHex("  240   5.9%\t10%  ")).toBe("#18181b");
    expect(hslDoTailwindParaHex("0.0 100.0% 50.0%")).toBe("#ff0000");
  });
});

describe("hslDoTailwindParaHex — limites de saturação e luminosidade", () => {
  it("0 e 100 valem (preto, branco e cinza são cores de verdade)", () => {
    expect(hslDoTailwindParaHex("0 0% 0%")).toBe("#000000");
    expect(hslDoTailwindParaHex("0 100% 0%")).toBe("#000000");
    expect(hslDoTailwindParaHex("0 100% 100%")).toBe("#ffffff");
    expect(hslDoTailwindParaHex("200 0% 40%")).toBe("#666666");
    expect(hslDoTailwindParaHex("200 100% 100%")).toBe("#ffffff");
  });

  it("um pouco abaixo de 0 ou acima de 100 não é cor, em qualquer dos dois campos", () => {
    for (const v of [
      "0 -0.1% 50%",
      "0 100.1% 50%",
      "0 50% -0.1%",
      "0 50% 100.1%",
      "0 101% 50%",
      "0 50% 101%",
    ]) {
      expect(hslDoTailwindParaHex(v)).toBeNull();
    }
  });
});

describe("hslDoTailwindParaHex — o que não é HSL do Tailwind", () => {
  it("quantidade de partes diferente de três", () => {
    for (const v of ["", "   ", "240", "240 50%", "240 50% 50% 50%"]) {
      expect(hslDoTailwindParaHex(v)).toBeNull();
    }
  });

  it("saturação e luminosidade PRECISAM do sinal de porcentagem, cada uma", () => {
    expect(hslDoTailwindParaHex("0 50 50")).toBeNull();
    expect(hslDoTailwindParaHex("0 50% 50")).toBeNull();
    expect(hslDoTailwindParaHex("0 50 50%")).toBeNull();
  });

  it("o matiz não leva porcentagem", () => {
    expect(hslDoTailwindParaHex("50% 50% 50%")).toBeNull();
  });

  it("número malformado em qualquer campo: dois pontos, notação científica, letra, sinal solto", () => {
    for (const v of [
      "1.2.3 50% 50%",
      "0 1.2.3% 50%",
      "0 50% 1.2.3%",
      "1e2 50% 50%",
      "0 1e1% 50%",
      "0 50% 1e1%",
      "abc 50% 50%",
      "0 abc% 50%",
      "0 50% abc%",
      "- 50% 50%",
      "0 -% 50%",
      "0 50% .%",
      "0 50% %",
      "Infinity 50% 50%",
    ]) {
      expect(hslDoTailwindParaHex(v)).toBeNull();
    }
  });
});

describe("estiloDoBrick — variáveis do :root e escala das variantes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("style");
  });

  function definir(primaria: string | null, sobre: string | null) {
    const estilo = document.documentElement.style;
    if (primaria !== null) estilo.setProperty("--primary", primaria);
    if (sobre !== null) estilo.setProperty("--primary-foreground", sobre);
  }

  it("a variante de hover tira 8 pontos de luminosidade e a segunda tira 16", () => {
    definir("0 100% 20%", "0 0% 98%");
    const v = estiloDoBrick().style.customVariables;
    expect(v.baseColor).toBe(hslDoTailwindParaHex("0 100% 20%"));
    expect(v.baseColorFirstVariant).toBe(hslDoTailwindParaHex("0 100% 12%"));
    expect(v.baseColorSecondVariant).toBe(hslDoTailwindParaHex("0 100% 4%"));
  });

  it("a luminosidade não passa de zero: cor já escura vira preto nas duas variantes", () => {
    definir("0 100% 5%", "0 0% 98%");
    const v = estiloDoBrick().style.customVariables;
    expect(v.baseColor).toBe("#1a0000");
    expect(v.baseColorFirstVariant).toBe("#000000");
    expect(v.baseColorSecondVariant).toBe("#000000");
  });

  it("no ponto exato: 16 de luminosidade deixa a primeira variante em 8 e a segunda em 0", () => {
    definir("0 100% 16%", "0 0% 98%");
    const v = estiloDoBrick().style.customVariables;
    expect(v.baseColorFirstVariant).toBe(hslDoTailwindParaHex("0 100% 8%"));
    expect(v.baseColorSecondVariant).toBe("#000000");
  });

  it("a cor e o texto sobre ela são os dois conferidos: sem um deles NENHUMA cor da loja entra", () => {
    definir("0 100% 50%", null);
    const semTexto = estiloDoBrick().style.customVariables;
    expect(semTexto.baseColor).toBeUndefined();
    expect(semTexto.baseColorFirstVariant).toBeUndefined();
    expect(semTexto.outlinePrimaryColor).toBeUndefined();
    expect(semTexto.buttonTextColor).toBeUndefined();

    document.documentElement.removeAttribute("style");
    definir(null, "0 0% 98%");
    const semCor = estiloDoBrick().style.customVariables;
    expect(semCor.baseColor).toBeUndefined();
    expect(semCor.buttonTextColor).toBeUndefined();

    document.documentElement.removeAttribute("style");
    definir("0 100% 50%", "texto qualquer");
    const textoRuim = estiloDoBrick().style.customVariables;
    expect(textoRuim.baseColor).toBeUndefined();
    expect(textoRuim.outlinePrimaryColor).toBeUndefined();
  });

  it("espaço em volta do valor das variáveis não atrapalha", () => {
    definir("  0 100% 50%  ", "  0 0% 100%  ");
    const v = estiloDoBrick().style.customVariables;
    expect(v.baseColor).toBe("#ff0000");
    expect(v.buttonTextColor).toBe("#ffffff");
  });

  it("variável que vem de uma folha de estilo (não do atributo style) também vale", () => {
    const folha = document.createElement("style");
    folha.textContent =
      ":root { --primary: 120 100% 50%; --primary-foreground: 0 0% 0%; }";
    document.head.appendChild(folha);
    try {
      const v = estiloDoBrick().style.customVariables;
      expect(v.baseColor).toBe("#00ff00");
      expect(v.buttonTextColor).toBe("#000000");
    } finally {
      folha.remove();
    }
  });

  it("lê as variáveis da raiz que for passada (não só do :root)", () => {
    const outra = document.createElement("div");
    outra.style.setProperty("--primary", "120 100% 50%");
    outra.style.setProperty("--primary-foreground", "0 0% 0%");
    const v = estiloDoBrick(outra).style.customVariables;
    expect(v.baseColor).toBe("#00ff00");
    expect(v.outlinePrimaryColor).toBe("#00ff00");
    expect(v.buttonTextColor).toBe("#000000");
  });

  it("sem document (SSR) e sem raiz, só saem tamanho e legibilidade", () => {
    vi.stubGlobal("document", undefined);
    const { hideFormTitle, style } = estiloDoBrick();
    expect(hideFormTitle).toBe(true);
    expect(style.customVariables.baseColor).toBeUndefined();
    expect(style.customVariables.fontSizeMedium).toBe("16px");
  });

  it("os valores fixos de moldura, contraste e alvo de toque", () => {
    expect(estiloDoBrick(null).style.customVariables).toEqual({
      formBackgroundColor: "#ffffff",
      inputBackgroundColor: "#ffffff",
      formPadding: "0px",
      textPrimaryColor: "#18181b",
      textSecondaryColor: "#52525b",
      errorColor: "#b91c1c",
      fontSizeSmall: "16px",
      fontSizeMedium: "16px",
      inputVerticalPadding: "14px",
      inputHorizontalPadding: "12px",
      inputBorderWidth: "1px",
      inputFocusedBorderWidth: "2px",
      borderRadiusMedium: "12px",
    });
  });
});

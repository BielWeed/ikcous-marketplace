// `hexToTailwindHsl` é quem transforma a cor da loja no token que o navegador
// pinta (`--primary`, `--primary-legivel`, `--secondary`, `--accent`). Todos os
// testes vizinhos a usam como ORÁCULO DE SI MESMA (`expect(token).toBe(
// hexToTailwindHsl(cor))`), então uma conta errada passa nos dois lados da
// comparação. Aqui os valores são ABSOLUTOS, de cores conhecidas (as do próprio
// Tailwind), e o teste roda em ambiente node: sem `document`, também prova que
// as funções que escrevem no documento não explodem fora do navegador.
//
// Pega, por mutação: a volta de +6 no matiz de quem tem verde abaixo do azul
// (rosa/magenta saía com matiz NEGATIVO), o arredondamento (round virando
// floor mexe um ponto na saturação/luz/matiz), a forma curta #rgb, e a guarda
// de "não há document".
import {
  aplicarCorDaLoja,
  applyBranding,
  applyThemeColor,
  hexToTailwindHsl,
} from "@/config/branding";
import { describe, expect, it } from "vitest";

describe("hexToTailwindHsl — valores conhecidos", () => {
  it.each([
    ["vermelho puro", "#ff0000", "0 100% 50%"],
    ["verde puro", "#00ff00", "120 100% 50%"],
    ["azul puro", "#0000ff", "240 100% 50%"],
    ["amarelo", "#ffff00", "60 100% 50%"],
    ["ciano", "#00ffff", "180 100% 50%"],
    ["magenta", "#ff00ff", "300 100% 50%"],
    ["branco", "#ffffff", "0 0% 100%"],
    ["preto", "#000000", "0 0% 0%"],
    ["cinza médio", "#808080", "0 0% 50%"],
  ])("%s (%s) → %s", (_nome, hex, esperado) => {
    expect(hexToTailwindHsl(hex)).toBe(esperado);
  });

  it("vermelho com azul acima do verde: o matiz volta para perto de 360, nunca negativo", () => {
    // #ff0080: (g - b) / d é negativo; sem a volta de +6 saía "-30 100% 50%".
    expect(hexToTailwindHsl("#ff0080")).toBe("330 100% 50%");
    // Rosa claro conhecido (lightpink): 351 100% 86%.
    expect(hexToTailwindHsl("#ffb6c1")).toBe("351 100% 86%");
  });

  it("cor clara usa a saturação do lado claro; cor escura, a do lado escuro", () => {
    // Luz acima de 50%: s = d / (2 - max - min).
    expect(hexToTailwindHsl("#e4e4e7")).toBe("240 6% 90%");
    expect(hexToTailwindHsl("#ffb6c1")).toBe("351 100% 86%");
    // Luz abaixo de 50%: s = d / (max + min).
    expect(hexToTailwindHsl("#1e3a8a")).toBe("224 64% 33%");
    expect(hexToTailwindHsl("#18181b")).toBe("240 6% 10%");
  });

  it("arredonda para o inteiro mais próximo (não corta para baixo)", () => {
    // Tailwind blue-500: 217,2 91,2% 59,8% → luz sobe para 60.
    expect(hexToTailwindHsl("#3b82f6")).toBe("217 91% 60%");
    // Tailwind green-500: 142,1 70,6% 45,3% → saturação sobe para 71.
    expect(hexToTailwindHsl("#22c55e")).toBe("142 71% 45%");
    // Tailwind amber-500: 37,7 92,1% 50,2% → matiz sobe para 38.
    expect(hexToTailwindHsl("#f59e0b")).toBe("38 92% 50%");
  });

  it("aceita maiúscula, forma curta e a cor sem o '#'", () => {
    expect(hexToTailwindHsl("#3B82F6")).toBe("217 91% 60%");
    expect(hexToTailwindHsl("3b82f6")).toBe("217 91% 60%");
    expect(hexToTailwindHsl("#f00")).toBe("0 100% 50%");
    expect(hexToTailwindHsl("#FFF")).toBe("0 0% 100%");
    // #1af = #11aaff: o dígito curto é DOBRADO, não completado com zero.
    expect(hexToTailwindHsl("#1af")).toBe(hexToTailwindHsl("#11aaff"));
    expect(hexToTailwindHsl("#1af")).not.toBe("0 0% 0%");
  });

  it("tamanho que não é 3 nem 6 dígitos cai em preto, sem inventar cor", () => {
    for (const ruim of ["", "#", "#12", "#1234", "#12345", "#1234567"]) {
      expect(hexToTailwindHsl(ruim)).toBe("0 0% 0%");
    }
    // #RRGGBBAA não é aceito: o canal alfa não vira cor.
    expect(hexToTailwindHsl("#3b82f6ff")).toBe("0 0% 0%");
  });
});

describe("sem document (fora do navegador): nada lança", () => {
  it("aplicarCorDaLoja, applyThemeColor e applyBranding saem calados", () => {
    expect(typeof document).toBe("undefined");
    expect(() => aplicarCorDaLoja("#ffd400")).not.toThrow();
    expect(() => applyThemeColor("#ffd400")).not.toThrow();
    expect(() => applyBranding()).not.toThrow();
  });
});

// Caça por mutação em `src/lib/financeiro.ts` (dinheiro do painel): o que os
// testes de `financeiro-lib` não pegavam —
//   - eixo de gráfico compacto com valor negativo e com zero;
//   - percentual com número que não existe (NaN / infinito) e o "−0,0%";
//   - número de parcelas inválido (0, negativo, fracionado);
//   - dinheiro digitado com "r$" minúsculo ou com o sinal de menos tipográfico;
//   - texto que começa com ponto ou vírgula, que não deve ser adivinhado.
import {
  formatarBRLCompacto,
  formatarPercentual,
  parseValorBR,
  valorDaParcela,
} from "@/lib/financeiro";
import { describe, expect, it } from "vitest";

const semNbsp = (texto: string) => texto.replace(/[\u00a0\u202f]/g, " ");

describe("formatarBRLCompacto — eixo do gráfico", () => {
  it("zero não ganha sinal de menos", () => {
    expect(formatarBRLCompacto(0)).toBe("R$ 0");
    expect(formatarBRLCompacto(-0)).toBe("R$ 0");
  });

  it("valor negativo leva o sinal tipográfico e o número SEM o '-' do Intl", () => {
    const texto = semNbsp(formatarBRLCompacto(-1500));
    expect(texto.startsWith("−R$ ")).toBe(true);
    // Se o valor absoluto não fosse aplicado o texto traria dois sinais.
    expect(texto).not.toContain("-");
    expect(texto).toBe(semNbsp(formatarBRLCompacto(1500)).replace("R$", "−R$"));
  });

  it("positivo não leva sinal", () => {
    expect(semNbsp(formatarBRLCompacto(1500)).startsWith("R$ ")).toBe(true);
  });
});

describe("formatarPercentual do financeiro", () => {
  it("sem base (null) ou número que não existe vira travessão, nunca 'NaN%'", () => {
    expect(formatarPercentual(null)).toBe("—");
    expect(formatarPercentual(Number.NaN)).toBe("—");
    expect(formatarPercentual(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatarPercentual(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("o que arredonda para zero não ganha sinal de menos", () => {
    expect(formatarPercentual(-0.04)).toBe("0,0%");
    expect(formatarPercentual(0)).toBe("0,0%");
  });

  it("negativo de verdade leva o sinal tipográfico; positivo não leva sinal", () => {
    expect(formatarPercentual(-12.34)).toBe("−12,3%");
    expect(formatarPercentual(12.34)).toBe("12,3%");
  });
});

describe("valorDaParcela — número de parcelas fora do normal", () => {
  it("zero parcelas é tratado como 1 (nunca divide por zero)", () => {
    expect(valorDaParcela(100, 0)).toEqual({ parcela: 100, exata: true });
  });

  it("parcelas negativas também viram 1", () => {
    expect(valorDaParcela(100, -3)).toEqual({ parcela: 100, exata: true });
  });

  it("parcelas fracionadas contam só a parte inteira (2,9 vale 2)", () => {
    expect(valorDaParcela(100, 2.9)).toEqual({ parcela: 50, exata: true });
  });

  it("divisão que não fecha: parcela arredonda para baixo e avisa que não é exata", () => {
    expect(valorDaParcela(100, 3)).toEqual({ parcela: 33.33, exata: false });
  });
});

describe("parseValorBR — escrita que não é a mais comum", () => {
  it("'r$' em minúsculo também é tirado", () => {
    expect(parseValorBR("r$ 10")).toBe(10);
    expect(parseValorBR("R$10,50")).toBe(10.5);
  });

  it("sinal de menos tipográfico (U+2212) vale como menos, com e sem R$", () => {
    expect(parseValorBR("−10")).toBe(-10);
    expect(parseValorBR("−R$ 10,50")).toBe(-10.5);
    expect(parseValorBR("-R$ 10,50")).toBe(-10.5);
  });

  it("começar pelo ponto ou pela vírgula não é adivinhado: devolve null", () => {
    // ".234" poderia ser "234" (milhar sem o 1º grupo): a casa não adivinha.
    expect(parseValorBR(".234")).toBeNull();
    expect(parseValorBR(",50")).toBeNull();
  });

  it("vazio, só espaços e só o sinal não viram zero", () => {
    expect(parseValorBR("")).toBeNull();
    expect(parseValorBR("   ")).toBeNull();
    expect(parseValorBR("-")).toBeNull();
    expect(parseValorBR("R$")).toBeNull();
    expect(parseValorBR(null)).toBeNull();
    expect(parseValorBR(undefined)).toBeNull();
  });

  it("número que não é finito não vira dinheiro", () => {
    expect(parseValorBR(Number.NaN)).toBeNull();
    expect(parseValorBR(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

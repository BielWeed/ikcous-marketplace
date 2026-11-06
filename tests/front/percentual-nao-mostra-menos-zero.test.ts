// Resultado perto de zero chegava à tela como "-0%" (Início: "Margem estimada
// -0%") e "-0,0%" (margens e retorno dos produtos): o número é negativo, mas
// arredondado na casa que a tela mostra ele é zero, e "-0" lê como prejuízo.
// Só a exibição muda: o cálculo da margem continua com o valor inteiro.
import { formatarPercentual } from "@/lib/crm";
import { percentualComUmaCasa, semMenosZero } from "@/lib/percentual";
import { describe, expect, it } from "vitest";

describe("percentualComUmaCasa (margem e retorno dos produtos)", () => {
  it.each([-0.01, -0.04, -0, 0, 0.04])(
    "%s vira 0,0%, sem sinal de menos",
    (valor) => {
      expect(percentualComUmaCasa(valor)).toBe("0,0%");
    },
  );

  it("o que arredonda para fora do zero mantém o sinal e a vírgula", () => {
    expect(percentualComUmaCasa(-0.06)).toBe("-0,1%");
    expect(percentualComUmaCasa(-33.333)).toBe("-33,3%");
    expect(percentualComUmaCasa(130.15)).toBe("130,2%");
    expect(percentualComUmaCasa(33.3333)).toBe("33,3%");
  });
});

describe("formatarPercentual do Início/CRM (margem estimada)", () => {
  it("-0,3 sem casa decimal vira 0%, não -0%", () => {
    expect(formatarPercentual(-0.3, 0)).toBe("0%");
  });

  it.each([-0.01, -0.04, -0])("%s com uma casa vira 0%", (valor) => {
    expect(formatarPercentual(valor)).toBe("0%");
  });

  it("valor que não arredonda para zero fica como estava", () => {
    expect(formatarPercentual(-0.06)).toBe("-0,1%");
    expect(formatarPercentual(-2.8, 0)).toBe("-3%");
    expect(formatarPercentual(28.46)).toBe("28,5%");
    expect(formatarPercentual(null)).toBe("—");
  });
});

describe("semMenosZero", () => {
  it("só troca por 0 o que arredonda para zero na precisão pedida", () => {
    expect(Object.is(semMenosZero(-0.3, 0), 0)).toBe(true);
    expect(Object.is(semMenosZero(-0.04, 1), 0)).toBe(true);
    expect(semMenosZero(-0.5, 0)).toBe(-0.5);
    expect(semMenosZero(-0.06, 1)).toBe(-0.06);
    expect(semMenosZero(12.34, 1)).toBe(12.34);
  });
});

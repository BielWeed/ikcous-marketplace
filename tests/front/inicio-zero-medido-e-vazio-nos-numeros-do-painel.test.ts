// Três fronteiras de número do Início e do CRM que nenhum teste segurava
// (achadas por mutação em 24/11/2026):
//  - quem vendeu ZERO hoje contra uma base que existe teve queda de 100%: a
//    variação não pode tratar o zero do período atual como "não sei" (só a base
//    zero ou ausente não tem percentual);
//  - o valor compacto (R$ 15 mil) vale para o módulo: prejuízo de R$ 15.000
//    também sai compacto, e valor ausente (`undefined`, como o cartão que ainda
//    carrega) sai "—", nunca "R$ NaN".
import { formatarMoedaCompacta, variacaoPercentual } from "@/lib/crm";
import { describe, expect, it } from "vitest";

describe("variação percentual: zero medido no período atual", () => {
  it("vendeu R$ 0 contra uma base de R$ 100: queda de 100%, não 'sem base de comparação'", () => {
    expect(variacaoPercentual(0, 100)).toBe(-100);
    expect(variacaoPercentual(0, 250)).toBe(-100);
  });

  it("lucro zero contra um mês anterior no prejuízo é melhora, não ausência", () => {
    expect(variacaoPercentual(0, -100)).toBe(100);
  });

  it("zero contra zero e ausente continuam sem percentual", () => {
    expect(variacaoPercentual(0, 0)).toBeNull();
    expect(variacaoPercentual(0, null)).toBeNull();
    expect(variacaoPercentual(null, 100)).toBeNull();
    expect(variacaoPercentual(undefined, 100)).toBeNull();
  });
});

describe("formatarMoedaCompacta: sinal e ausência", () => {
  it("valor negativo a partir de R$ 10 mil também sai compacto", () => {
    const compacto = formatarMoedaCompacta(-15_000);
    expect(compacto).toMatch(/mil/);
    expect(compacto).not.toContain("15.000");
    expect(compacto).toBe(`-${formatarMoedaCompacta(15_000)}`);
  });

  it("valor negativo pequeno continua exato", () => {
    expect(formatarMoedaCompacta(-9_999)).toContain("9.999,00");
  });

  it("valor ausente sai '—', tanto null quanto undefined (nunca 'R$ NaN')", () => {
    expect(formatarMoedaCompacta(null)).toBe("—");
    expect(formatarMoedaCompacta(undefined)).toBe("—");
  });
});

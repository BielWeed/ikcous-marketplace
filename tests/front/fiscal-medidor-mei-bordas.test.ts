// Gestão Fiscal, caça por mutação: o medidor do limite do MEI nas bordas do ano de
// abertura, nos valores zerados ou negativos e na cobertura da receita do app.
//
// O que cada teste protege (em português simples):
//   - o teto do ano de abertura é R$ 6.750 x os meses de atividade, contando o mês da
//     abertura inteiro: aberta em 31/12 conta 1 mês, aberta em 01/07 e em 15/07 contam 6;
//   - cada faixa vale no centavo: até 100% dentro, de 100% a 120% "excesso de até 20%",
//     acima de 120% "excesso de mais de 20%";
//   - devolução maior que a venda (acumulado negativo) e receita zero mostram 0%, nunca
//     um número negativo nem "-0";
//   - ano sem conferência (2025, 2027) e abertura depois do ano não têm conta;
//   - a cobertura: o número do app só é a receita do ano quando o app já vendia no começo
//     do período medido.
//
// Valores à mão: 6.750 x 12 = 81.000 | x 6 = 40.500 | x 1 = 6.750; 120% de 6.750 = 8.100,
// de 40.500 = 48.600.
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import {
  coberturaDaReceitaDoAno,
  medirLimiteDoMei,
} from "@/lib/fiscal/medidor-mei";

function medir(receitaAcumulada: number, ano: number, abertaEm: string | null) {
  return medirLimiteDoMei({
    receitaAcumulada,
    ano,
    cadastro: { abertaEm },
  });
}

/** O resultado "com conta", ou falha o teste. */
function comConta(
  receitaAcumulada: number,
  ano: number,
  abertaEm: string | null,
) {
  const m = medir(receitaAcumulada, ano, abertaEm);
  if (m.estado !== "com_conta") {
    throw new Error(`esperava conta, veio sem_conta (${m.motivo})`);
  }
  return m;
}

describe("medirLimiteDoMei: o teto proporcional do ano de abertura", () => {
  it.each([
    ["2026-12-31", 1, 6_750],
    ["2026-12-01", 1, 6_750],
    ["2026-11-30", 2, 13_500],
    ["2026-07-01", 6, 40_500],
    ["2026-07-15", 6, 40_500],
    ["2026-07-31", 6, 40_500],
    ["2026-02-28", 11, 74_250],
    ["2026-01-31", 12, 81_000],
  ])("aberta em %s: %i meses, teto de R$ %i", (abertaEm, meses, teto) => {
    const m = comConta(1, 2026, abertaEm);
    expect(m.mesesDeAtividade).toBe(meses);
    expect(m.tetoUsado).toBe(teto);
    expect(m.tetoProporcional).toBe(true);
  });

  it("aberta em 31/12 do ano ANTERIOR: ano cheio, teto de R$ 81.000, sem proporcional", () => {
    const m = comConta(1, 2026, "2025-12-31");
    expect(m.mesesDeAtividade).toBe(12);
    expect(m.tetoUsado).toBe(81_000);
    expect(m.tetoProporcional).toBe(false);
  });

  it("sem data de abertura: ano cheio, teto de R$ 81.000", () => {
    const m = comConta(1, 2026, null);
    expect(m.mesesDeAtividade).toBe(12);
    expect(m.tetoUsado).toBe(81_000);
    expect(m.tetoProporcional).toBe(false);
  });
});

describe("medirLimiteDoMei: as faixas no centavo, no ano de abertura", () => {
  // Aberta em 31/12/2026: 1 mês, teto de R$ 6.750.
  it.each([
    [6_750, "dentro"],
    [6_750.01, "excesso_ate_20"],
    [8_100, "excesso_ate_20"],
    [8_100.01, "excesso_acima_20"],
  ])("1 mês de atividade, R$ %f: %s", (receita, faixa) => {
    expect(comConta(receita, 2026, "2026-12-31").faixa).toBe(faixa);
  });

  // Aberta em 15/07/2026: 6 meses, teto de R$ 40.500.
  it.each([
    [40_499.99, "dentro"],
    [40_500, "dentro"],
    [40_500.01, "excesso_ate_20"],
    [48_600, "excesso_ate_20"],
    [48_600.01, "excesso_acima_20"],
  ])("6 meses de atividade, R$ %f: %s", (receita, faixa) => {
    expect(comConta(receita, 2026, "2026-07-15").faixa).toBe(faixa);
  });

  it("o percentual acompanha a faixa: 100% e 120% exatos no ano de abertura de 1 mês", () => {
    expect(comConta(6_750, 2026, "2026-12-31").percentual).toBeCloseTo(100, 9);
    expect(comConta(8_100, 2026, "2026-12-31").percentual).toBeCloseTo(120, 9);
    expect(comConta(3_375, 2026, "2026-12-31").percentual).toBeCloseTo(50, 9);
  });

  it("o mesmo valor que é 'dentro' no ano cheio é excesso no ano de abertura", () => {
    expect(comConta(40_501, 2026, null).faixa).toBe("dentro");
    expect(comConta(40_501, 2026, "2026-07-15").faixa).toBe("excesso_ate_20");
  });
});

describe("medirLimiteDoMei: receita zero, negativa e valor que não é número", () => {
  it("receita zero: 0%, dentro", () => {
    const m = comConta(0, 2026, null);
    expect(m.percentual).toBe(0);
    expect(m.faixa).toBe("dentro");
  });

  it("devolução maior que a venda (acumulado negativo): 0% (sem sinal de menos), dentro", () => {
    const m = comConta(-1_234.56, 2026, null);
    expect(Object.is(m.percentual, 0)).toBe(true);
    expect(m.faixa).toBe("dentro");
  });

  it("acumulado negativo no ano de abertura também é 0%", () => {
    const m = comConta(-50, 2026, "2026-12-31");
    expect(Object.is(m.percentual, 0)).toBe(true);
    expect(m.faixa).toBe("dentro");
  });

  it.each([
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
  ])("receita %f não é número: sem conta", (receita) => {
    expect(medir(receita, 2026, null)).toEqual({
      estado: "sem_conta",
      motivo: "receita_invalida",
    });
  });
});

describe("medirLimiteDoMei: ano sem conferência e abertura que não bate", () => {
  it.each([[2025], [2027], [2028], [1999]])(
    "ano %i não está conferido: sem conta, mesmo com abertura em 2026",
    (ano) => {
      expect(medir(1_000, ano, "2026-03-01")).toEqual({
        estado: "sem_conta",
        motivo: "ano_nao_conferido",
      });
    },
  );

  it("aberta DEPOIS do ano medido: sem conta", () => {
    expect(medir(1_000, 2026, "2027-01-01")).toEqual({
      estado: "sem_conta",
      motivo: "abertura_depois_do_ano",
    });
  });

  it.each([["2026-02-30"], ["2026-13-01"], ["26-01-01"], ["2026/01/01"], [""]])(
    "data de abertura %j não existe: sem conta",
    (abertaEm) => {
      expect(medir(1_000, 2026, abertaEm)).toEqual({
        estado: "sem_conta",
        motivo: "abertura_invalida",
      });
    },
  );
});

describe("coberturaDaReceitaDoAno: o número do app é o do período inteiro?", () => {
  const cobertura = (
    ano: number,
    abertaEm: string | null,
    vendeNoAppDesde: string | null,
  ) =>
    coberturaDaReceitaDoAno({ ano, cadastro: { abertaEm, vendeNoAppDesde } });

  it("o app vende desde janeiro do ano medido: completa", () => {
    expect(cobertura(2026, null, "2026-01-01")).toEqual({ tipo: "completa" });
  });

  it("o app vende desde dezembro do ano anterior: completa", () => {
    expect(cobertura(2026, null, "2025-12-01")).toEqual({ tipo: "completa" });
  });

  it("o app começou em fevereiro: parcial, e diz desde quando", () => {
    expect(cobertura(2026, null, "2026-02-01")).toEqual({
      tipo: "parcial",
      motivo: "comecou_depois_do_inicio",
      desde: "2026-02-01",
    });
  });

  it("sem a data de início das vendas: parcial, nunca se supõe cobertura", () => {
    expect(cobertura(2026, null, null)).toEqual({
      tipo: "parcial",
      motivo: "sem_data_de_inicio",
    });
  });

  it("data de início das vendas que não existe: trata como ausente", () => {
    expect(cobertura(2026, null, "2026-02-30")).toEqual({
      tipo: "parcial",
      motivo: "sem_data_de_inicio",
    });
  });

  it("aberta em março de 2026 e o app vende desde março: completa (antes da abertura não há venda)", () => {
    expect(cobertura(2026, "2026-03-10", "2026-03-01")).toEqual({
      tipo: "completa",
    });
  });

  it("aberta em março de 2026 e o app só começou em abril: parcial", () => {
    expect(cobertura(2026, "2026-03-10", "2026-04-01")).toEqual({
      tipo: "parcial",
      motivo: "comecou_depois_do_inicio",
      desde: "2026-04-01",
    });
  });

  it("aberta em 2024: a abertura antiga não adianta, vale janeiro do ano medido", () => {
    expect(cobertura(2026, "2024-05-02", "2026-01-01")).toEqual({
      tipo: "completa",
    });
    expect(cobertura(2026, "2024-05-02", "2026-02-01")).toEqual({
      tipo: "parcial",
      motivo: "comecou_depois_do_inicio",
      desde: "2026-02-01",
    });
  });

  it("abertura com data que não existe é ignorada: vale janeiro do ano medido", () => {
    expect(cobertura(2026, "2026-03-32", "2026-02-01")).toEqual({
      tipo: "parcial",
      motivo: "comecou_depois_do_inicio",
      desde: "2026-02-01",
    });
  });

  it("aberta em dezembro: o app que começou em dezembro cobre o período medido", () => {
    expect(cobertura(2026, "2026-12-31", "2026-12-01")).toEqual({
      tipo: "completa",
    });
  });
});

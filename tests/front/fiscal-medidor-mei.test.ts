// Gestão Fiscal, tarefa 7: o medidor do limite do MEI ("quanto do limite do ano você já
// usou"). Função pura: recebe a receita acumulada do ano, o ano e o cadastro.
//
// Os números vêm de docs/fiscal/2026-11-24-parametros-conferidos.md (L1, L2, L3):
//   - teto anual de 2026: R$ 81.000; no ano de abertura, R$ 6.750 x meses de atividade
//     (fração de mês conta como mês inteiro);
//   - até 100% do teto está dentro; de 100% a 120% é excesso de até 20%; acima de 120%
//     é excesso de mais de 20%. Exatamente 100% e exatamente 120% ficam na faixa de baixo.
//
// Os limites das faixas são testados com UM CENTAVO de cada lado. Fixtures inventadas.
import { describe, expect, it } from "vitest";

import {
  type CoberturaDaReceita,
  type FaixaDoMei,
  type MedidorDoMei,
  coberturaDaReceitaDoAno,
  medirLimiteDoMei,
} from "@/lib/fiscal/medidor-mei";

function medir(
  receitaAcumulada: number,
  opcoes: { ano?: number; abertaEm?: string | null } = {},
): MedidorDoMei {
  return medirLimiteDoMei({
    receitaAcumulada,
    ano: opcoes.ano ?? 2026,
    cadastro: { abertaEm: opcoes.abertaEm ?? null },
  });
}

/** Resultado com conta, ou erro do teste: assim o `if` do tipo não se repete em todo caso. */
function comConta(m: MedidorDoMei) {
  if (m.estado !== "com_conta") {
    throw new Error(`esperava conta, veio sem_conta (${m.motivo})`);
  }
  return m;
}

const faixaDe = (m: MedidorDoMei): FaixaDoMei => comConta(m).faixa;

describe("medirLimiteDoMei: ano inteiro (teto de R$ 81.000)", () => {
  it("receita no meio do caminho: percentual, faixa dentro e teto cheio", () => {
    const m = comConta(medir(40_500));
    expect(m.percentual).toBeCloseTo(50, 10);
    expect(m.faixa).toBe("dentro");
    expect(m.tetoUsado).toBe(81_000);
    expect(m.tetoProporcional).toBe(false);
    expect(m.mesesDeAtividade).toBe(12);
  });

  it("100%: exatamente o teto ainda está dentro; um centavo a mais é excesso de até 20%", () => {
    expect(faixaDe(medir(80_999.99))).toBe("dentro");
    expect(faixaDe(medir(81_000))).toBe("dentro");
    expect(comConta(medir(81_000)).percentual).toBeCloseTo(100, 10);
    expect(faixaDe(medir(81_000.01))).toBe("excesso_ate_20");
  });

  it("120%: exatamente 20% acima ainda é 'até 20%'; um centavo a mais é 'acima de 20%'", () => {
    expect(faixaDe(medir(97_199.99))).toBe("excesso_ate_20");
    expect(faixaDe(medir(97_200))).toBe("excesso_ate_20");
    expect(comConta(medir(97_200)).percentual).toBeCloseTo(120, 10);
    expect(faixaDe(medir(97_200.01))).toBe("excesso_acima_20");
  });

  it("o percentual sai sem arredondar: quem mostra arredonda, a faixa é decidida em centavos", () => {
    // R$ 1.000 de R$ 81.000 = 1,2345679...%
    expect(comConta(medir(1_000)).percentual).toBeCloseTo(1.2345679012, 9);
    // R$ 81.000,81 é 100,001%: arredondado mostraria "100%", mas já passou do teto.
    const raspao = comConta(medir(81_000.81));
    expect(raspao.percentual).toBeGreaterThan(100);
    expect(raspao.percentual).toBeLessThan(100.01);
    expect(raspao.faixa).toBe("excesso_ate_20");
  });

  it("muito acima do teto continua sendo 'acima de 20%'", () => {
    const m = comConta(medir(500_000));
    expect(m.faixa).toBe("excesso_acima_20");
    expect(m.percentual).toBeGreaterThan(600);
  });

  it("soma de ponto flutuante que passa de raspão não troca a faixa (conta em centavos)", () => {
    // 80.999,99 + 0,01 pode dar 81.000,00000000001 em ponto flutuante: é R$ 81.000,00.
    expect(faixaDe(medir(80_999.99 + 0.01))).toBe("dentro");
    // 97.199,99 + 0,01 idem, na fronteira dos 120%.
    expect(faixaDe(medir(97_199.99 + 0.01))).toBe("excesso_ate_20");
    // Fração de centavo arredonda para o centavo, como o resto do Financeiro.
    expect(faixaDe(medir(81_000.004))).toBe("dentro");
  });
});

describe("medirLimiteDoMei: receita zero, devolução e dado ruim", () => {
  it("receita zero: 0%, dentro, sem dividir por nada", () => {
    const m = comConta(medir(0));
    expect(m.percentual).toBe(0);
    expect(m.faixa).toBe("dentro");
  });

  it("mês de muita devolução (acumulado negativo) não gera percentual negativo", () => {
    const m = comConta(medir(-1_250.5));
    expect(m.percentual).toBe(0);
    expect(Object.is(m.percentual, -0)).toBe(false);
    expect(m.faixa).toBe("dentro");
  });

  it.each([
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
    ["menos infinito", Number.NEGATIVE_INFINITY],
  ])("receita %s não vira percentual: sem_conta", (_nome, receita) => {
    expect(medir(receita)).toEqual({
      estado: "sem_conta",
      motivo: "receita_invalida",
    });
  });
});

describe("medirLimiteDoMei: teto proporcional no ano de abertura (R$ 6.750 x meses)", () => {
  it("aberta em março: março a dezembro são 10 meses, teto de R$ 67.500", () => {
    const m = comConta(medir(10_000, { abertaEm: "2026-03-10" }));
    expect(m.tetoUsado).toBe(67_500);
    expect(m.tetoProporcional).toBe(true);
    expect(m.mesesDeAtividade).toBe(10);
  });

  it("fração de mês conta como mês inteiro: dia 1 e dia 31 do mês dão os mesmos 10 meses", () => {
    expect(
      comConta(medir(0, { abertaEm: "2026-03-01" })).mesesDeAtividade,
    ).toBe(10);
    expect(
      comConta(medir(0, { abertaEm: "2026-03-31" })).mesesDeAtividade,
    ).toBe(10);
  });

  it("as faixas passam a medir o teto proporcional, com um centavo de cada lado", () => {
    const a = { abertaEm: "2026-03-10" }; // teto 67.500; 120% = 81.000
    expect(faixaDe(medir(67_499.99, a))).toBe("dentro");
    expect(faixaDe(medir(67_500, a))).toBe("dentro");
    expect(faixaDe(medir(67_500.01, a))).toBe("excesso_ate_20");
    expect(faixaDe(medir(80_999.99, a))).toBe("excesso_ate_20");
    expect(faixaDe(medir(81_000, a))).toBe("excesso_ate_20");
    expect(faixaDe(medir(81_000.01, a))).toBe("excesso_acima_20");
    expect(comConta(medir(33_750, a)).percentual).toBeCloseTo(50, 10);
  });

  it("aberta em dezembro: 1 mês, teto de R$ 6.750 (e 120% = R$ 8.100)", () => {
    const a = { abertaEm: "2026-12-31" };
    expect(comConta(medir(0, a)).tetoUsado).toBe(6_750);
    expect(faixaDe(medir(6_750, a))).toBe("dentro");
    expect(faixaDe(medir(6_750.01, a))).toBe("excesso_ate_20");
    expect(faixaDe(medir(8_100, a))).toBe("excesso_ate_20");
    expect(faixaDe(medir(8_100.01, a))).toBe("excesso_acima_20");
  });

  it("aberta em janeiro: 12 meses, o teto cheio, mas ainda é ano de abertura", () => {
    const m = comConta(medir(0, { abertaEm: "2026-01-02" }));
    expect(m.tetoUsado).toBe(81_000);
    expect(m.mesesDeAtividade).toBe(12);
    expect(m.tetoProporcional).toBe(true);
  });

  it("aberta em ano anterior: teto cheio, nada de proporcional", () => {
    const m = comConta(medir(0, { abertaEm: "2025-11-20" }));
    expect(m.tetoUsado).toBe(81_000);
    expect(m.tetoProporcional).toBe(false);
  });

  it("sem data de abertura informada: teto cheio (a data é opcional no cadastro)", () => {
    const m = comConta(medir(0, { abertaEm: null }));
    expect(m.tetoUsado).toBe(81_000);
    expect(m.tetoProporcional).toBe(false);
  });

  it("abertura DEPOIS do ano medido não tem conta honesta: sem_conta", () => {
    expect(medir(100, { abertaEm: "2027-01-10" })).toEqual({
      estado: "sem_conta",
      motivo: "abertura_depois_do_ano",
    });
  });

  it("data de abertura que não é data de calendário: sem_conta, nunca teto cheio no escuro", () => {
    for (const ruim of ["2026-02-30", "2026-13-01", "ontem", "2026-3-1"]) {
      expect(medir(100, { abertaEm: ruim }), ruim).toEqual({
        estado: "sem_conta",
        motivo: "abertura_invalida",
      });
    }
  });
});

describe("medirLimiteDoMei: ano que não foi conferido", () => {
  it.each([2025, 2027, 2028, 2035])(
    "ano %i: sem_conta, com o motivo, e NENHUM número",
    (ano) => {
      const m = medir(50_000, { ano });
      expect(m).toEqual({ estado: "sem_conta", motivo: "ano_nao_conferido" });
      expect(Object.keys(m).sort()).toEqual(["estado", "motivo"]);
    },
  );

  it("ano não conferido vence até a abertura inválida: nunca mostra número velho", () => {
    expect(medir(50_000, { ano: 2027, abertaEm: "lixo" })).toEqual({
      estado: "sem_conta",
      motivo: "ano_nao_conferido",
    });
  });
});

describe("medirLimiteDoMei: o efeito de passar do limite, em texto simples (L3)", () => {
  it("dentro do limite: diz que nada muda", () => {
    expect(comConta(medir(10_000)).efeito).toMatch(/dentro do limite/i);
  });

  it("excesso de até 20%: desenquadra só no 1º de janeiro seguinte, paga junto com o DAS de janeiro", () => {
    const efeito = comConta(medir(90_000)).efeito;
    expect(efeito).toMatch(/até 20%/);
    expect(efeito).toMatch(/1º de janeiro do ano seguinte/);
    expect(efeito).toMatch(/DAS de janeiro/);
    expect(efeito).toMatch(/último dia útil do mês seguinte/);
    expect(efeito).not.toMatch(/retroativ/i);
  });

  it("excesso de mais de 20%: retroativo a 1º de janeiro do ano do excesso, Simples normal", () => {
    const efeito = comConta(medir(120_000)).efeito;
    expect(efeito).toMatch(/mais de 20%/);
    expect(efeito).toMatch(/retroativ/i);
    expect(efeito).toMatch(/1º de janeiro do ano do excesso/);
    expect(efeito).toMatch(/Simples/);
    expect(efeito).toMatch(/último dia útil do mês seguinte/);
  });

  it("no ano de abertura: até 20% é no ano seguinte; mais de 20% volta ao início da atividade", () => {
    const a = { abertaEm: "2026-03-10" }; // teto 67.500
    const ate20 = comConta(medir(70_000, a)).efeito;
    expect(ate20).toMatch(/1º de janeiro do ano seguinte/);
    expect(ate20).not.toMatch(/retroativ/i);
    const acima20 = comConta(medir(90_000, a)).efeito;
    expect(acima20).toMatch(/retroativ/i);
    expect(acima20).toMatch(/início da atividade/);
    expect(acima20).not.toMatch(/1º de janeiro do ano do excesso/);
  });

  it("cada faixa tem um texto diferente e nenhum é vazio", () => {
    const textos = [10_000, 90_000, 120_000].map(
      (r) => comConta(medir(r)).efeito,
    );
    expect(new Set(textos).size).toBe(3);
    for (const t of textos) expect(t.trim().length).toBeGreaterThan(20);
  });
});

// A receita do medidor vem do `fin_dre`, que só enxerga as vendas feitas pelo app. Ela
// só é o "total do ano" se o app já vendia desde o começo do período medido: o 1º de
// janeiro, ou, no ano em que a empresa abre, o mês da abertura. Senão é um número
// PARCIAL, e a tela não pode concluir enquadramento em cima dele.
describe("coberturaDaReceitaDoAno: o número do app é o do ano inteiro?", () => {
  const cobertura = (
    vendeNoAppDesde: string | null,
    abertaEm: string | null = null,
    ano = 2026,
  ): CoberturaDaReceita =>
    coberturaDaReceitaDoAno({ ano, cadastro: { vendeNoAppDesde, abertaEm } });

  it("sem a data de início das vendas pelo app: parcial, e diz por quê", () => {
    expect(cobertura(null)).toEqual({
      tipo: "parcial",
      motivo: "sem_data_de_inicio",
    });
  });

  it("vendia pelo app desde antes do ano: completa", () => {
    expect(cobertura("2025-06-01")).toEqual({ tipo: "completa" });
    expect(cobertura("2020-01-01")).toEqual({ tipo: "completa" });
  });

  it("a borda: desde janeiro do ano é completa; desde fevereiro já é parcial", () => {
    expect(cobertura("2026-01-01")).toEqual({ tipo: "completa" });
    expect(cobertura("2026-02-01")).toEqual({
      tipo: "parcial",
      motivo: "comecou_depois_do_inicio",
      desde: "2026-02-01",
    });
    expect(cobertura("2026-12-01")).toEqual({
      tipo: "parcial",
      motivo: "comecou_depois_do_inicio",
      desde: "2026-12-01",
    });
  });

  it("vale o ano medido, não o de hoje nem o de outro ano", () => {
    // Vendendo desde jan/2026: em 2027 já vendia antes (completa); em 2025 ainda não
    // vendia em janeiro (parcial).
    expect(cobertura("2026-01-01", null, 2027)).toEqual({ tipo: "completa" });
    expect(cobertura("2026-01-01", null, 2025)).toEqual({
      tipo: "parcial",
      motivo: "comecou_depois_do_inicio",
      desde: "2026-01-01",
    });
  });

  it("ano de abertura: vale o mês da abertura, não 1º de janeiro", () => {
    // Empresa aberta em 15/10/2026: não existiam vendas antes de outubro.
    expect(cobertura("2026-10-01", "2026-10-15")).toEqual({ tipo: "completa" });
    expect(cobertura("2026-10-01", "2026-10-01")).toEqual({ tipo: "completa" });
    expect(cobertura("2026-11-01", "2026-10-15")).toEqual({
      tipo: "parcial",
      motivo: "comecou_depois_do_inicio",
      desde: "2026-11-01",
    });
  });

  it("abertura em ano anterior não adianta o início: continua valendo 1º de janeiro", () => {
    expect(cobertura("2026-03-01", "2025-03-10")).toEqual({
      tipo: "parcial",
      motivo: "comecou_depois_do_inicio",
      desde: "2026-03-01",
    });
    expect(cobertura("2026-01-01", "2025-03-10")).toEqual({ tipo: "completa" });
  });

  it("começou a vender pelo app antes do mês da abertura (dado estranho): não vira parcial", () => {
    expect(cobertura("2026-05-01", "2026-10-15")).toEqual({ tipo: "completa" });
  });

  it("o motivo 'começou depois' carrega a data de início, para a tela dizer o mês", () => {
    const c = cobertura("2026-03-01");
    expect(
      c.tipo === "parcial" && c.motivo === "comecou_depois_do_inicio",
    ).toBe(true);
    expect("desde" in c ? c.desde : null).toBe("2026-03-01");
  });

  it("data de início que não é uma data de verdade: parcial, nunca completa por engano", () => {
    expect(cobertura("lixo")).toEqual({
      tipo: "parcial",
      motivo: "sem_data_de_inicio",
    });
  });
});

// Gestão Fiscal, caça por mutação: as bordas da estimativa do DAS do Simples (Anexo I,
// só comércio) que os testes de `fiscal-estimativa-simples.test.ts` deixavam passar.
//
// O que cada teste protege (em português simples):
//   - um mês da série que NÃO é número (texto, vazio, infinito) é mês não medido, e a
//     estimativa pede os meses que faltam em vez de contar "10000" escrito como texto;
//   - a janela da RBT12 é exata nas duas pontas: o mês da própria apuração e o 13º mês
//     para trás NUNCA entram, mesmo com um valor enorme escondido ali;
//   - a virada do ano (janeiro e dezembro) e o limite entre "empresa nova" (média) e
//     "empresa com 12 meses" (regra geral);
//   - os limites de R$ 3,6 mi (sublimite) e R$ 4,8 mi (teto), no centavo;
//   - o arredondamento para a dezena: o empate sobe, um centavo abaixo do empate cai.
//
// COMO OS VALORES FORAM CALCULADOS (à mão, com a fórmula da lei, sem usar o código):
//   alíquota efetiva = (RBT12 x alíquota - parcela a deduzir) / RBT12;  DAS = efetiva x mês.
//   Anexo I 2026: até 180 mil 4% (PD 0) | até 360 mil 7,3% (PD 5.940) | até 720 mil 9,5%
//   (PD 13.860) | até 1,8 mi 10,7% (PD 22.500) | até 3,6 mi 14,3% (PD 87.300).
//
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import {
  type EntradaDaEstimativa,
  type EstimativaDoSimples,
  estimarDasDoSimples,
} from "@/lib/fiscal/estimativa-simples";

/** Série mensal `yyyy-mm` -> reais, do mês `de` ao mês `ate` (inclusive), todos com o mesmo valor. */
function serie(de: string, ate: string, valor: number): Record<string, number> {
  const out: Record<string, number> = {};
  let [a, m] = de.split("-").map(Number);
  const [aFim, mFim] = ate.split("-").map(Number);
  while (a < aFim || (a === aFim && m <= mFim)) {
    out[`${a}-${String(m).padStart(2, "0")}`] = valor;
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }
  return out;
}

/** A mesma série, sem o mês `chave` (mês ausente = não medido). */
function semOMes(
  meses: Record<string, number>,
  chave: string,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(meses).filter(([mes]) => mes !== chave),
  );
}

type CadastroDaConta = Pick<
  CadastroFiscal,
  "regime" | "atividade" | "abertaEm" | "vendeNoAppDesde"
>;

const ANTIGA: CadastroDaConta = {
  regime: "simples",
  atividade: "comercio",
  abertaEm: "2020-01-15",
  vendeNoAppDesde: "2025-01-01",
};

function estimar(trocas: Partial<EntradaDaEstimativa>): EstimativaDoSimples {
  return estimarDasDoSimples({
    cadastro: ANTIGA,
    competencia: "2026-06",
    receitaDoMes: 10_000,
    receitasMensais: serie("2025-06", "2026-05", 10_000),
    ...trocas,
  });
}

const comEstimativa = (valor: number): EstimativaDoSimples => ({
  estado: "com_estimativa",
  valor,
});

const faltam = (quantos: number): EstimativaDoSimples => ({
  estado: "sem_estimativa",
  motivo: "faltam_meses",
  faltam: quantos,
});

const semEstimativa = (motivo: string): unknown => ({
  estado: "sem_estimativa",
  motivo,
});

describe("estimarDasDoSimples: mês da série que não é número é mês NÃO medido", () => {
  const estranhos: readonly [string, unknown][] = [
    ["texto com número", "10000"],
    ["texto vazio", ""],
    ["nulo", null],
    ["indefinido", undefined],
    ["infinito", Number.POSITIVE_INFINITY],
    ["infinito negativo", Number.NEGATIVE_INFINITY],
    ["não é número (NaN)", Number.NaN],
    ["lista", [10_000]],
  ];

  for (const [nome, valor] of estranhos) {
    it(`${nome} em um mês: falta 1 mês, não há estimativa`, () => {
      const meses = serie("2025-06", "2026-05", 10_000);
      meses["2025-12"] = valor as number;
      expect(estimar({ receitasMensais: meses })).toEqual(faltam(1));
    });
  }

  it("o mesmo texto em dois meses: faltam 2", () => {
    const meses = serie("2025-06", "2026-05", 10_000);
    meses["2025-12"] = "10000" as unknown as number;
    meses["2026-02"] = "10000" as unknown as number;
    expect(estimar({ receitasMensais: meses })).toEqual(faltam(2));
  });

  it("a série inteira ausente: faltam os 12", () => {
    expect(estimar({ receitasMensais: {} })).toEqual(faltam(12));
  });
});

describe("estimarDasDoSimples: a janela da RBT12 e a virada do ano", () => {
  it("janeiro de 2026: a janela é janeiro a dezembro de 2025 (R$ 120.000, 4%), DAS de R$ 400", () => {
    expect(
      estimar({
        competencia: "2026-01",
        receitasMensais: serie("2025-01", "2025-12", 10_000),
      }),
    ).toEqual(comEstimativa(400));
  });

  it("janeiro de 2026 sem o mês de janeiro de 2025 na série: falta 1", () => {
    const meses = semOMes(serie("2025-01", "2025-12", 10_000), "2025-01");
    expect(estimar({ competencia: "2026-01", receitasMensais: meses })).toEqual(
      faltam(1),
    );
  });

  it("janeiro de 2026 com o app vendendo só desde fevereiro de 2025: janeiro de 2025 não foi medido, e a estimativa sai da média dos 11 meses medidos", () => {
    expect(
      estimar({
        competencia: "2026-01",
        cadastro: { ...ANTIGA, vendeNoAppDesde: "2025-02-01" },
        // A leitura devolve zero para o que veio antes do app, e zero não prova nada:
        // o janeiro de 2025 (R$ 999.999 aqui) fica de fora da média.
        receitasMensais: {
          ...serie("2025-02", "2025-12", 10_000),
          "2025-01": 999_999,
        },
      }),
    ).toEqual({ estado: "com_estimativa", valor: 400, mesesNaMedia: 11 });
  });

  it("dezembro de 2026: o próprio mês e o 13º mês para trás NUNCA entram na RBT12", () => {
    const meses = serie("2025-12", "2026-11", 10_000);
    meses["2025-11"] = 99_999_999; // 13 meses antes: fora da janela
    meses["2026-12"] = 99_999_999; // o próprio mês da apuração: fora da janela
    // RBT12 = 12 x 10.000 = 120.000 (faixa 1, 4%); mês de 10.000 -> DAS de 400.
    expect(estimar({ competencia: "2026-12", receitasMensais: meses })).toEqual(
      comEstimativa(400),
    );
  });

  it("dezembro de 2026 sem dezembro de 2025 na série: falta 1 (a ponta antiga da janela conta)", () => {
    const meses = semOMes(serie("2025-12", "2026-11", 10_000), "2025-12");
    expect(estimar({ competencia: "2026-12", receitasMensais: meses })).toEqual(
      faltam(1),
    );
  });

  it("dezembro de 2026 sem novembro de 2026 na série: falta 1 (a ponta nova da janela conta)", () => {
    const meses = semOMes(serie("2025-12", "2026-11", 10_000), "2026-11");
    expect(estimar({ competencia: "2026-12", receitasMensais: meses })).toEqual(
      faltam(1),
    );
  });
});

describe("estimarDasDoSimples: empresa com menos de 12 meses (média dos meses anteriores)", () => {
  it("abriu em dezembro de 2025 e estima janeiro de 2026 (2º mês): RBT12 = R$ 30.000 x 12 = R$ 360.000 (faixa 2, 5,65%), DAS 565 sobe para 570", () => {
    expect(
      estimar({
        cadastro: {
          ...ANTIGA,
          abertaEm: "2025-12-10",
          vendeNoAppDesde: "2025-12-01",
        },
        competencia: "2026-01",
        receitaDoMes: 10_000,
        receitasMensais: { "2025-12": 30_000 },
      }),
    ).toEqual(comEstimativa(570));
  });

  it("abriu em janeiro de 2026 e estima dezembro (12º mês): média de 11 meses x 12 = R$ 240.000 (faixa 2, 4,825%), DAS 965 sobe para 970", () => {
    expect(
      estimar({
        cadastro: {
          ...ANTIGA,
          abertaEm: "2026-01-05",
          vendeNoAppDesde: "2026-01-01",
        },
        competencia: "2026-12",
        receitaDoMes: 20_000,
        receitasMensais: serie("2026-01", "2026-11", 20_000),
      }),
    ).toEqual(comEstimativa(970));
  });

  it("abriu em 31/12/2025 e estima dezembro de 2026 (13º mês): vale a regra geral dos 12 meses (R$ 120.000, 4%), DAS de 400", () => {
    expect(
      estimar({
        cadastro: {
          ...ANTIGA,
          abertaEm: "2025-12-31",
          vendeNoAppDesde: "2025-12-01",
        },
        competencia: "2026-12",
        receitasMensais: serie("2025-12", "2026-11", 10_000),
      }),
    ).toEqual(comEstimativa(400));
  });

  it("no 13º mês sem os 12 meses medidos: vendendo no app só desde janeiro, estima pela média dos 11 meses medidos", () => {
    expect(
      estimar({
        cadastro: {
          ...ANTIGA,
          abertaEm: "2025-12-31",
          vendeNoAppDesde: "2026-01-01",
        },
        competencia: "2026-12",
        receitasMensais: serie("2025-12", "2026-11", 10_000),
      }),
    ).toEqual({ estado: "com_estimativa", valor: 400, mesesNaMedia: 11 });
  });

  it("abriu em 31/12/2026 e estima dezembro (1º mês): RBT12 = R$ 5.000 x 12 = R$ 60.000 (4%), DAS de 200", () => {
    expect(
      estimar({
        cadastro: {
          ...ANTIGA,
          abertaEm: "2026-12-31",
          vendeNoAppDesde: "2026-12-01",
        },
        competencia: "2026-12",
        receitaDoMes: 5_000,
        receitasMensais: {},
      }),
    ).toEqual(comEstimativa(200));
  });

  it("estimar novembro de uma empresa que só abre em 1º de dezembro não existe", () => {
    expect(
      estimar({
        cadastro: {
          ...ANTIGA,
          abertaEm: "2026-12-01",
          vendeNoAppDesde: "2026-12-01",
        },
        competencia: "2026-11",
        receitasMensais: {},
      }),
    ).toEqual(semEstimativa("competencia_antes_da_abertura"));
  });

  it("3º mês com os dois meses anteriores zerados: RBT12 zero conta como R$ 1,00 (4%), DAS de 200", () => {
    expect(
      estimar({
        cadastro: {
          ...ANTIGA,
          abertaEm: "2026-03-01",
          vendeNoAppDesde: "2026-03-01",
        },
        competencia: "2026-05",
        receitaDoMes: 5_000,
        receitasMensais: { "2026-03": 0, "2026-04": 0 },
      }),
    ).toEqual(comEstimativa(200));
  });
});

describe("estimarDasDoSimples: limites de R$ 3,6 mi e R$ 4,8 mi, no centavo", () => {
  it("RBT12 de exatamente R$ 3.600.000 ainda estima: faixa 5, 11,875% efetivos, DAS 35.625 sobe para 35.630", () => {
    // (3.600.000 x 14,3% - 87.300) / 3.600.000 = 427.500 / 3.600.000 = 11,875%
    expect(
      estimar({
        receitaDoMes: 300_000,
        receitasMensais: serie("2025-06", "2026-05", 300_000),
      }),
    ).toEqual(comEstimativa(35_630));
  });

  it("um centavo acima de R$ 3,6 mi já é acima do sublimite: sem estimativa", () => {
    const meses = serie("2025-06", "2026-05", 300_000);
    meses["2026-05"] = 300_000.01;
    expect(estimar({ receitaDoMes: 300_000, receitasMensais: meses })).toEqual(
      semEstimativa("acima_do_sublimite"),
    );
  });

  it("RBT12 de exatamente R$ 4,8 mi é acima do sublimite (não do teto); um centavo a mais é acima do teto", () => {
    const noTeto = serie("2025-06", "2026-05", 400_000);
    expect(estimar({ receitaDoMes: 400_000, receitasMensais: noTeto })).toEqual(
      semEstimativa("acima_do_sublimite"),
    );
    noTeto["2026-05"] = 400_000.01;
    expect(estimar({ receitaDoMes: 400_000, receitasMensais: noTeto })).toEqual(
      semEstimativa("acima_do_teto"),
    );
  });

  it("empresa nova que passa do sublimite na média: 1º mês de R$ 400.000 x 12 = R$ 4,8 mi é acima do sublimite", () => {
    expect(
      estimar({
        cadastro: {
          ...ANTIGA,
          abertaEm: "2026-06-01",
          vendeNoAppDesde: "2026-06-01",
        },
        competencia: "2026-06",
        receitaDoMes: 400_000,
        receitasMensais: {},
      }),
    ).toEqual(semEstimativa("acima_do_sublimite"));
  });
});

describe("estimarDasDoSimples: arredondamento para a dezena (metade para cima) e mês sem receita", () => {
  // RBT12 = 12 x 10.000 = R$ 120.000: faixa 1, 4% efetivos. DAS = 4% do mês.
  it.each([
    [10_124.99, 400], // 404,9996 -> cai para 400
    [10_125, 410], // 405,00 exatos: o empate sobe
    [10_125.01, 410], // 405,0004
    [10_374.99, 410], // 414,9996 -> 410
    [10_375, 420], // 415,00 exatos: o empate sobe
  ])("receita do mês de R$ %f gera DAS de R$ %i", (receitaDoMes, esperado) => {
    expect(estimar({ receitaDoMes })).toEqual(comEstimativa(esperado));
  });

  it("faixa 4 (R$ 1,2 mi): 8,825% efetivos x R$ 100.000 = 8.825, empate, sobe para 8.830", () => {
    // (1.200.000 x 10,7% - 22.500) / 1.200.000 = 105.900 / 1.200.000 = 8,825%
    expect(
      estimar({
        receitaDoMes: 100_000,
        receitasMensais: serie("2025-06", "2026-05", 100_000),
      }),
    ).toEqual(comEstimativa(8_830));
  });

  it("mês com devolução maior que a venda (negativo) tem DAS zero, nunca negativo", () => {
    expect(estimar({ receitaDoMes: -500 })).toEqual(comEstimativa(0));
  });

  it("mês sem nenhuma venda tem DAS zero", () => {
    expect(estimar({ receitaDoMes: 0 })).toEqual(comEstimativa(0));
  });

  it("série toda zerada (RBT12 zero conta R$ 1,00) e mês de R$ 5.000: 4%, DAS de 200", () => {
    expect(
      estimar({
        receitaDoMes: 5_000,
        receitasMensais: serie("2025-06", "2026-05", 0),
      }),
    ).toEqual(comEstimativa(200));
  });

  it("receita do mês que não é número: sem estimativa", () => {
    expect(estimar({ receitaDoMes: Number.NaN })).toEqual(
      semEstimativa("receita_invalida"),
    );
    expect(estimar({ receitaDoMes: Number.POSITIVE_INFINITY })).toEqual(
      semEstimativa("receita_invalida"),
    );
  });
});

describe("estimarDasDoSimples: o ano e a competência", () => {
  it.each([["2025-12"], ["2027-01"], ["2030-06"]])(
    "competência %s é de ano não conferido: sem estimativa, mesmo com a série completa",
    (competencia) => {
      expect(
        estimar({
          competencia,
          receitasMensais: serie("2024-01", "2030-12", 10_000),
        }),
      ).toEqual(semEstimativa("ano_nao_conferido"));
    },
  );

  it.each([
    ["2026-13"],
    ["2026-00"],
    ["2026-1"],
    ["202606"],
    ["2026-06-01"],
    [""],
  ])("competência torta %j é inválida", (competencia) => {
    expect(estimar({ competencia })).toEqual(
      semEstimativa("competencia_invalida"),
    );
  });

  it("data de abertura que não existe (30 de fevereiro): sem estimativa", () => {
    expect(
      estimar({ cadastro: { ...ANTIGA, abertaEm: "2026-02-30" } }),
    ).toEqual(semEstimativa("abertura_invalida"));
  });

  it("início das vendas no app que não existe, ou ausente: sem estimativa", () => {
    expect(
      estimar({ cadastro: { ...ANTIGA, vendeNoAppDesde: "2025-02-30" } }),
    ).toEqual(semEstimativa("sem_mes_de_inicio_das_vendas"));
    expect(estimar({ cadastro: { ...ANTIGA, vendeNoAppDesde: null } })).toEqual(
      semEstimativa("sem_mes_de_inicio_das_vendas"),
    );
  });

  it("competência anterior ao início das vendas no app: sem estimativa", () => {
    expect(
      estimar({
        competencia: "2026-06",
        cadastro: { ...ANTIGA, vendeNoAppDesde: "2026-07-01" },
      }),
    ).toEqual(semEstimativa("mes_antes_das_vendas_no_app"));
  });

  it("competência no mesmo mês em que o app começou a vender é aceita (a regra é 'antes de')", () => {
    expect(
      estimar({
        cadastro: {
          ...ANTIGA,
          abertaEm: "2026-06-01",
          vendeNoAppDesde: "2026-06-01",
        },
        competencia: "2026-06",
        receitaDoMes: 5_000,
        receitasMensais: {},
      }),
    ).toEqual(comEstimativa(200));
  });
});

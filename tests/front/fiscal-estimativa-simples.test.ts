// Gestão Fiscal, tarefa 8: a estimativa do DAS do Simples, SÓ para comércio (Anexo I).
//
// Função pura. Os números vêm de docs/fiscal/2026-11-24-parametros-conferidos.md:
//   L6  Anexo I de 2026 (6 faixas);          L7  alíquota efetiva = (RBT12 x Aliq - PD) / RBT12,
//   DAS do mês = alíquota efetiva x receita do mês, RBT12 zero conta como R$ 1,00;
//   L8  empresa com menos de 12 meses: 1º mês = receita do mês x 12; do 2º ao 12º =
//       média dos meses anteriores x 12; a partir do 13º, a regra geral;
//   L10 teto do Simples R$ 4,8 mi e sublimite de R$ 3,6 mi (acima do sublimite o ICMS
//       sai do DAS e a conta do Anexo I deixa de valer).
//
// A regra que manda: NUNCA estimar com série incompleta. O app só mede os meses em
// que a loja vendeu por ele; mês ausente da série (ou anterior ao "vende no app desde")
// é mês NÃO medido, e zero medido é outra coisa.
//
// ARMADILHA DE FRONTEIRA: as faixas do Anexo I são contínuas (a alíquota efetiva dá o
// mesmo número nos dois lados da fronteira), então o VALOR em reais quase não muda ao
// trocar de faixa por um centavo. Por isso a escolha de faixa é testada direto na
// função `aliquotaEfetivaDoAnexoI`, e os valores em reais são testados no MEIO das faixas.
//
// Fixtures inventadas; o repositório é público.
import { describe, expect, it } from "vitest";

import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import {
  type EntradaDaEstimativa,
  type EstimativaDoSimples,
  aliquotaEfetivaDoAnexoI,
  estimarDasDoSimples,
} from "@/lib/fiscal/estimativa-simples";
import { parametrosDoAno } from "@/lib/fiscal/parametros-da-lei";

const params = parametrosDoAno(2026);
if (!params.conferido) throw new Error("2026 devia estar conferido");
const SIMPLES = params.simples;

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

type CadastroDaConta = Pick<
  CadastroFiscal,
  "regime" | "atividade" | "abertaEm" | "vendeNoAppDesde"
>;

// Uma empresa antiga, no Simples, só comércio, que vende pelo app desde 2025-01.
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
    receitasMensais: serie("2025-01", "2026-05", 10_000),
    ...trocas,
  });
}

function valorDe(e: EstimativaDoSimples): number {
  if (e.estado !== "com_estimativa") {
    throw new Error(`esperava estimativa, veio sem_estimativa (${e.motivo})`);
  }
  return e.valor;
}

describe("aliquotaEfetivaDoAnexoI: a faixa e a alíquota efetiva em cada borda (L6, L7)", () => {
  // Valores à mão, independentes do código: (RBT12 x Aliq - PD) / RBT12 na fronteira de cada faixa.
  it.each([
    [180_000, 1, 4],
    [360_000, 2, 5.65], // 20.340 / 360.000
    [720_000, 3, 7.575], // 54.540 / 720.000
    [1_800_000, 4, 9.45], // 170.100 / 1.800.000
    [3_600_000, 5, 11.875], // 427.500 / 3.600.000
    [4_800_000, 6, 11.125], // 534.000 / 4.800.000
  ])(
    "RBT12 de R$ %i (a fronteira, inclusive) fica na faixa %i, com %f%% efetivos",
    (rbt12, faixa, efetiva) => {
      const r = aliquotaEfetivaDoAnexoI(rbt12, SIMPLES);
      expect(r?.faixa).toBe(faixa);
      expect(r?.aliquotaEfetivaPercentual).toBeCloseTo(efetiva, 9);
    },
  );

  it.each([
    [180_000.01, 2],
    [360_000.01, 3],
    [720_000.01, 4],
    [1_800_000.01, 5],
    [3_600_000.01, 6],
  ])(
    "um centavo acima da fronteira (R$ %f) já é a faixa %i",
    (rbt12, faixa) => {
      expect(aliquotaEfetivaDoAnexoI(rbt12, SIMPLES)?.faixa).toBe(faixa);
    },
  );

  it.each([
    [179_999.99, 1],
    [359_999.99, 2],
    [719_999.99, 3],
    [1_799_999.99, 4],
    [3_599_999.99, 5],
    [4_799_999.99, 6],
  ])(
    "um centavo abaixo da fronteira (R$ %f) ainda é a faixa %i",
    (rbt12, faixa) => {
      expect(aliquotaEfetivaDoAnexoI(rbt12, SIMPLES)?.faixa).toBe(faixa);
    },
  );

  it("acima do teto do Simples não há faixa", () => {
    expect(aliquotaEfetivaDoAnexoI(4_800_000, SIMPLES)).not.toBeNull();
    expect(aliquotaEfetivaDoAnexoI(4_800_000.01, SIMPLES)).toBeNull();
  });

  it("RBT12 zero conta como R$ 1,00: faixa 1, 4% (nada de divisão por zero)", () => {
    const r = aliquotaEfetivaDoAnexoI(0, SIMPLES);
    expect(r?.faixa).toBe(1);
    expect(r?.aliquotaEfetivaPercentual).toBeCloseTo(4, 9);
  });

  it("a alíquota efetiva no meio de uma faixa bate com a fórmula (R$ 300.000, faixa 2)", () => {
    // (300.000 x 7,3% - 5.940) / 300.000 = 15.960 / 300.000 = 5,32%
    expect(aliquotaEfetivaDoAnexoI(300_000, SIMPLES)).toEqual({
      faixa: 2,
      aliquotaEfetivaPercentual: expect.closeTo(5.32, 9),
    });
  });
});

describe("estimarDasDoSimples: regra geral (12 meses medidos)", () => {
  it("faixa 1: RBT12 de R$ 120.000 (4%) sobre R$ 10.000 do mês = R$ 400", () => {
    expect(estimar({})).toEqual({ estado: "com_estimativa", valor: 400 });
  });

  it("faixa 2 no meio: RBT12 de R$ 300.000 (5,32%) sobre R$ 25.000 = R$ 1.330", () => {
    const e = estimar({
      receitaDoMes: 25_000,
      receitasMensais: serie("2025-01", "2026-05", 25_000),
    });
    expect(valorDe(e)).toBe(1_330);
  });

  it("faixa 3 no meio: RBT12 de R$ 540.000 (6,9333%) sobre R$ 45.000 = R$ 3.120", () => {
    const e = estimar({
      receitaDoMes: 45_000,
      receitasMensais: serie("2025-01", "2026-05", 45_000),
    });
    expect(valorDe(e)).toBe(3_120);
  });

  it("faixa 4 no meio: RBT12 de R$ 1,2 mi (8,825%) sobre R$ 100.000 = R$ 8.825, arredonda para R$ 8.830", () => {
    const e = estimar({
      receitaDoMes: 100_000,
      receitasMensais: serie("2025-01", "2026-05", 100_000),
    });
    expect(valorDe(e)).toBe(8_830);
  });

  it("faixa 5 no meio: RBT12 de R$ 2,4 mi (10,6625%) sobre R$ 200.000 = R$ 21.325, arredonda para R$ 21.330", () => {
    const e = estimar({
      receitaDoMes: 200_000,
      receitasMensais: serie("2025-01", "2026-05", 200_000),
    });
    expect(valorDe(e)).toBe(21_330);
  });

  it("só soma os 12 meses ANTERIORES ao mês: o mês da apuração e meses mais velhos ficam de fora", () => {
    // Janela de 2026-06: 2025-06 a 2026-05. Um mês enorme em 2025-05 (velho demais) e
    // outro em 2026-06 (o próprio mês, que não entra na RBT12) não podem mexer na conta.
    const e = estimar({
      receitasMensais: {
        ...serie("2025-01", "2026-05", 10_000),
        "2025-05": 5_000_000,
        "2026-06": 5_000_000,
      },
    });
    expect(valorDe(e)).toBe(400);
  });

  it("mês com devolução maior que a venda (negativo) conta zero na RBT12, não diminui", () => {
    // 11 meses de R$ 30.000 e um de -R$ 60.000: com zero a RBT12 é 330.000 (5,5% -> R$ 550);
    // sem o limite no zero seria 270.000 (5,1% -> R$ 510).
    const e = estimar({
      receitasMensais: {
        ...serie("2025-01", "2026-05", 30_000),
        "2025-12": -60_000,
      },
    });
    expect(valorDe(e)).toBe(550);
  });

  it("RBT12 zero (12 meses medidos sem venda) usa R$ 1,00: 4% sobre R$ 1.000 = R$ 40", () => {
    const e = estimar({
      receitaDoMes: 1_000,
      receitasMensais: serie("2025-01", "2026-05", 0),
    });
    expect(valorDe(e)).toBe(40);
  });

  it("receita do mês zero ou negativa: estimativa de R$ 0, nunca negativa", () => {
    expect(valorDe(estimar({ receitaDoMes: 0 }))).toBe(0);
    expect(valorDe(estimar({ receitaDoMes: -3_000 }))).toBe(0);
  });

  it("não mexe nos dados que recebeu", () => {
    const congelada = Object.freeze(serie("2025-01", "2026-05", 10_000));
    expect(valorDe(estimar({ receitasMensais: congelada }))).toBe(400);
    expect(Object.keys(congelada)).toHaveLength(17);
  });
});

describe("estimarDasDoSimples: arredonda para a dezena, metade para cima, sem centavos", () => {
  // Faixa 1 (4%): o DAS é 4% da receita do mês. 10.125 x 4% = 405,00 exatos.
  it.each([
    [10_124.99, 400], // 404,9996
    [10_125, 410], // 405,00: a metade sobe
    [10_125.01, 410], // 405,0004
    [10_000, 400], // 400,00
    [10_274.99, 410], // 410,9996
    [10_375, 420], // 415,00
    [124.99, 0], // 4,9996
    [125, 10], // 5,00
  ])(
    "receita de R$ %f dá DAS de %f arredondado: R$ %i",
    (receita, esperado) => {
      expect(valorDe(estimar({ receitaDoMes: receita }))).toBe(esperado);
    },
  );

  it("todo valor é múltiplo de 10, inteiro e sem centavos", () => {
    for (const receita of [1, 333.33, 1_234.56, 9_999.99, 87_654.32]) {
      const v = valorDe(estimar({ receitaDoMes: receita }));
      expect(Number.isInteger(v)).toBe(true);
      expect(v % 10).toBe(0);
    }
  });

  it("a conta é exata mesmo com valor grande (nada de erro de ponto flutuante na metade)", () => {
    // RBT12 de R$ 3,6 mi (12 x 300.000), receita do mês R$ 300.000: 11,875% = R$ 35.625,00.
    const e = estimar({
      receitaDoMes: 300_000,
      receitasMensais: serie("2025-01", "2026-05", 300_000),
    });
    expect(valorDe(e)).toBe(35_630);
  });
});

describe("estimarDasDoSimples: acima do sublimite e do teto não há estimativa (L10)", () => {
  const com = (mensal: number, centavoExtra = 0) => {
    const s = serie("2025-01", "2026-05", mensal);
    s["2025-07"] = mensal + centavoExtra;
    return estimar({ receitasMensais: s, receitaDoMes: mensal });
  };

  it("RBT12 exatamente no sublimite (R$ 3,6 mi) ainda estima", () => {
    expect(com(300_000).estado).toBe("com_estimativa");
  });

  it("um centavo acima do sublimite: sem estimativa, o ICMS sai do DAS", () => {
    expect(com(300_000, 0.01)).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_sublimite",
    });
  });

  it("acima do teto do Simples (R$ 4,8 mi): sem estimativa, motivo próprio", () => {
    expect(com(400_000, 0.01)).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_teto",
    });
    // E exatamente R$ 4,8 mi ainda é "acima do sublimite", não "acima do teto".
    expect(com(400_000)).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_sublimite",
    });
  });
});

describe("estimarDasDoSimples: nunca estima com série incompleta (a regra de ouro)", () => {
  it("doze meses medidos exatos estimam; onze não: faltam_meses com o número que falta", () => {
    expect(estimar({}).estado).toBe("com_estimativa");
    const onze = serie("2025-07", "2026-05", 10_000); // 11 meses: 2025-07 a 2026-05
    expect(estimar({ receitasMensais: onze })).toEqual({
      estado: "sem_estimativa",
      motivo: "faltam_meses",
      faltam: 1,
    });
  });

  it("empresa antiga que só vende no app há 8 meses: estima pela média dos 8 meses (decisão do sócio, 25/11/2026)", () => {
    // Janela de 2026-06: 2025-06 a 2026-05. O app mede de 2025-10 em diante (8 meses de
    // R$ 30.000): média 30.000 x 12 = 360.000 (faixa 2, 5,65%); mês de R$ 10.000 = 565 -> 570.
    const e = estimar({
      cadastro: { ...ANTIGA, vendeNoAppDesde: "2025-10-01" },
      receitasMensais: serie("2025-10", "2026-05", 30_000),
    });
    expect(e).toEqual({
      estado: "com_estimativa",
      valor: 570,
      mesesNaMedia: 8,
    });
  });

  it("zeros que a leitura devolveu para meses ANTES do app não contam como medidos", () => {
    // O hook leu 12+ meses e o banco devolveu 0 para tudo antes de 2025-10: isso não é
    // "vendeu zero", é "o app não media". Se os 4 zeros contassem, a soma (8 x 30.000 =
    // 240.000 em 12 meses) daria faixa 2 com RBT12 de 240.000 e DAS de 480 (4,825%); a
    // média dos 8 meses medidos dá RBT12 de 360.000 e DAS de 570.
    const e = estimar({
      cadastro: { ...ANTIGA, vendeNoAppDesde: "2025-10-01" },
      receitasMensais: {
        ...serie("2025-01", "2025-09", 0),
        ...serie("2025-10", "2026-05", 30_000),
      },
    });
    expect(e).toEqual({
      estado: "com_estimativa",
      valor: 570,
      mesesNaMedia: 8,
    });
  });

  it("buraco no meio da série (mês ausente depois do início) também falta", () => {
    const s = Object.fromEntries(
      Object.entries(serie("2025-01", "2026-05", 10_000)).filter(
        ([mes]) => mes !== "2025-11",
      ),
    );
    expect(estimar({ receitasMensais: s })).toEqual({
      estado: "sem_estimativa",
      motivo: "faltam_meses",
      faltam: 1,
    });
  });

  it("valor que não é número (NaN) na série vale como mês não medido", () => {
    const s = serie("2025-01", "2026-05", 10_000);
    s["2026-02"] = Number.NaN;
    expect(estimar({ receitasMensais: s })).toEqual({
      estado: "sem_estimativa",
      motivo: "faltam_meses",
      faltam: 1,
    });
  });

  it("série vazia: faltam os 12 meses", () => {
    expect(estimar({ receitasMensais: {} })).toEqual({
      estado: "sem_estimativa",
      motivo: "faltam_meses",
      faltam: 12,
    });
  });

  it("sem data de início das vendas no cadastro não dá para saber o que é medido: sem estimativa", () => {
    // Mesmo com 12 meses na série: a série não prova que os zeros são vendas zero.
    const e = estimar({ cadastro: { ...ANTIGA, vendeNoAppDesde: null } });
    expect(e).toEqual({
      estado: "sem_estimativa",
      motivo: "sem_mes_de_inicio_das_vendas",
    });
  });

  it("mês da apuração anterior ao início das vendas no app: sem estimativa", () => {
    const e = estimar({
      cadastro: { ...ANTIGA, vendeNoAppDesde: "2026-07-01" },
    });
    expect(e).toEqual({
      estado: "sem_estimativa",
      motivo: "mes_antes_das_vendas_no_app",
    });
  });

  it("empresa sem data de abertura e série incompleta: faltam meses (não presume empresa nova)", () => {
    const e = estimar({
      cadastro: { ...ANTIGA, abertaEm: null },
      receitasMensais: serie("2025-12", "2026-05", 10_000),
    });
    expect(e).toEqual({
      estado: "sem_estimativa",
      motivo: "faltam_meses",
      faltam: 6,
    });
  });
});

describe("estimarDasDoSimples: empresa com menos de 12 meses de atividade (L8, 2026)", () => {
  const NOVA: CadastroDaConta = {
    regime: "simples",
    atividade: "comercio",
    abertaEm: "2026-03-10",
    vendeNoAppDesde: "2026-03-01",
  };

  it("1º mês de atividade: RBT12 = receita do mês x 12 (R$ 20.000 x 12 = R$ 240.000, 4,825%)", () => {
    const e = estimar({
      cadastro: NOVA,
      competencia: "2026-03",
      receitaDoMes: 20_000,
      receitasMensais: {},
    });
    // 4,825% de 20.000 = 965,00 -> 970
    expect(valorDe(e)).toBe(970);
  });

  it("2º mês: média dos meses anteriores x 12, e não a receita do próprio mês", () => {
    // Março 50.000; abril 10.000. RBT12 = 50.000 x 12 = 600.000 (faixa 3, 7,19%) -> 719 -> 720.
    // Se usasse o mês de abril x 12 (120.000, 4%) daria 400.
    const e = estimar({
      cadastro: NOVA,
      competencia: "2026-04",
      receitaDoMes: 10_000,
      receitasMensais: { "2026-03": 50_000 },
    });
    expect(valorDe(e)).toBe(720);
  });

  it("3º mês: média aritmética de março e abril x 12; R$ 360.000 exatos ainda é faixa 2 (5,65%)", () => {
    // (20.000 + 40.000) / 2 x 12 = 360.000. 5,65% de 30.000 = 1.695,00 -> 1.700.
    const e = estimar({
      cadastro: NOVA,
      competencia: "2026-05",
      receitaDoMes: 30_000,
      receitasMensais: { "2026-03": 20_000, "2026-04": 40_000 },
    });
    expect(valorDe(e)).toBe(1_700);
  });

  it("12º mês: média dos 11 meses anteriores x 12", () => {
    // Aberta em 2025-07: 2026-06 é o 12º mês. Onze meses (2025-07 a 2026-05) de 10.000
    // -> média 10.000 x 12 = 120.000 -> 4% -> 400.
    const e = estimar({
      cadastro: {
        ...NOVA,
        abertaEm: "2025-07-15",
        vendeNoAppDesde: "2025-07-01",
      },
      competencia: "2026-06",
      receitaDoMes: 10_000,
      receitasMensais: serie("2025-07", "2026-05", 10_000),
    });
    expect(valorDe(e)).toBe(400);
  });

  it("13º mês em diante: volta a regra geral dos 12 meses anteriores", () => {
    // Aberta em 2025-07: 2026-08 é o 14º mês. A janela é 2025-08 a 2026-07; o mês de
    // abertura (2025-07, R$ 1 mi) já saiu dela.
    const e = estimar({
      cadastro: {
        ...NOVA,
        abertaEm: "2025-07-15",
        vendeNoAppDesde: "2025-07-01",
      },
      competencia: "2026-08",
      receitaDoMes: 10_000,
      receitasMensais: {
        ...serie("2025-07", "2026-07", 10_000),
        "2025-07": 1_000_000,
      },
    });
    expect(valorDe(e)).toBe(400);
  });

  it("mês de abertura contado inteiro: aberta no dia 31 de março, março é o 1º mês", () => {
    const e = estimar({
      cadastro: { ...NOVA, abertaEm: "2026-03-31" },
      competencia: "2026-03",
      receitaDoMes: 20_000,
      receitasMensais: {},
    });
    expect(valorDe(e)).toBe(970);
  });

  it("mês anterior ao app, depois da abertura: o zero que a leitura devolveu NÃO entra; estima pelo 1 mês medido (decisão do sócio, 25/11/2026)", () => {
    // Empresa aberta em março, mas o app só mede de abril. Para a apuração de maio, março é
    // mês de antes do app (o zero que a leitura devolveu é ignorado, não é "vendeu zero") e o
    // app mediu 1 mês (abril, R$ 40.000): 40.000 x 12 = 480.000 (faixa 3: 9,5%, deduzir
    // 13.860), efetiva 31.740 / 480.000 = 6,6125%. Mês de 30.000: 1.983,75 -> 1.980.
    // Se o zero de março contasse, a média cairia para 20.000 e a DAS seria outra.
    const e = estimar({
      cadastro: { ...NOVA, vendeNoAppDesde: "2026-04-01" },
      competencia: "2026-05",
      receitaDoMes: 30_000,
      receitasMensais: { "2026-03": 0, "2026-04": 40_000 },
    });
    expect(e).toEqual({
      estado: "com_estimativa",
      valor: 1_980,
      mesesNaMedia: 1,
    });
  });

  it("mês que o app DEVIA ter medido (do início das vendas em diante) e não trouxe: faltam meses (nunca média com buraco)", () => {
    // O app mede desde março; para maio faltam março (ausente) e abril está lá.
    const e = estimar({
      cadastro: NOVA,
      competencia: "2026-05",
      receitaDoMes: 30_000,
      receitasMensais: { "2026-04": 40_000 },
    });
    expect(e).toEqual({
      estado: "sem_estimativa",
      motivo: "faltam_meses",
      faltam: 1,
    });
  });

  it("falta um mês no meio da vida da empresa nova: faltam meses", () => {
    const e = estimar({
      cadastro: NOVA,
      competencia: "2026-06",
      receitaDoMes: 30_000,
      receitasMensais: { "2026-03": 20_000, "2026-05": 40_000 }, // sem abril
    });
    expect(e).toEqual({
      estado: "sem_estimativa",
      motivo: "faltam_meses",
      faltam: 1,
    });
  });

  it("apuração anterior ao mês de abertura não existe: sem estimativa", () => {
    const e = estimar({
      cadastro: NOVA,
      competencia: "2026-02",
      receitaDoMes: 10_000,
      receitasMensais: {},
    });
    expect(e).toEqual({
      estado: "sem_estimativa",
      motivo: "competencia_antes_da_abertura",
    });
  });

  it("anualizar o 1º mês também respeita o sublimite e o teto", () => {
    const base = {
      cadastro: NOVA,
      competencia: "2026-03",
      receitasMensais: {},
    };
    // 300.000 x 12 = 3,6 mi: ainda estima. 300.000,01 x 12 passa do sublimite.
    expect(estimar({ ...base, receitaDoMes: 300_000 }).estado).toBe(
      "com_estimativa",
    );
    expect(estimar({ ...base, receitaDoMes: 300_000.01 })).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_sublimite",
    });
    expect(estimar({ ...base, receitaDoMes: 500_000 })).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_teto",
    });
  });

  it("data de abertura que não é data de calendário: sem estimativa", () => {
    const e = estimar({ cadastro: { ...ANTIGA, abertaEm: "2026-02-30" } });
    expect(e).toEqual({
      estado: "sem_estimativa",
      motivo: "abertura_invalida",
    });
  });
});

describe("estimarDasDoSimples: só Simples + comércio tem conta", () => {
  it.each([
    ["simples", "com_servico", "simples_com_servico"],
    ["presumido", "comercio", "presumido"],
    ["presumido", "com_servico", "presumido"],
    ["real", "comercio", "real"],
    ["nao_sei", "comercio", "nao_sei"],
    ["mei", "comercio", "mei"],
    ["mei", "com_servico", "mei"],
  ] as const)(
    "%s + %s: sem estimativa, motivo %s",
    (regime, atividade, motivo) => {
      expect(estimar({ cadastro: { ...ANTIGA, regime, atividade } })).toEqual({
        estado: "sem_estimativa",
        motivo,
      });
    },
  );
});

describe("estimarDasDoSimples: competência e receita ruins, ano não conferido", () => {
  it.each([
    "",
    "2026",
    "2026-13",
    "2026-00",
    "2026-6",
    "26-06",
    "2026-06-01",
    "junho",
  ])("competência %j não é yyyy-mm: sem estimativa", (competencia) => {
    expect(estimar({ competencia })).toEqual({
      estado: "sem_estimativa",
      motivo: "competencia_invalida",
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "receita do mês %f não vira número: sem estimativa",
    (receita) => {
      expect(estimar({ receitaDoMes: receita })).toEqual({
        estado: "sem_estimativa",
        motivo: "receita_invalida",
      });
    },
  );

  it.each(["2025-12", "2027-01", "2027-06", "2028-03"])(
    "competência %s (ano não conferido): sem estimativa, nenhum número",
    (competencia) => {
      const e = estimar({
        competencia,
        receitasMensais: serie("2024-01", "2028-02", 10_000),
      });
      expect(e).toEqual({
        estado: "sem_estimativa",
        motivo: "ano_nao_conferido",
      });
    },
  );

  it("a competência de 2026 usa 2026 mesmo com meses de 2025 na janela", () => {
    expect(
      valorDe(
        estimar({
          competencia: "2026-01",
          receitasMensais: serie("2025-01", "2025-12", 10_000),
        }),
      ),
    ).toBe(400);
  });
});

// O texto do próprio módulo, lido pelo Vite (`?raw`), sem API de Node.
const FONTE_DO_MODULO = import.meta.glob<string>(
  "/src/lib/fiscal/estimativa-simples.ts",
  { query: "?raw", import: "default", eager: true },
);

describe("a estimativa nunca é gravada", () => {
  it("o módulo não importa nada que grave lançamento nem fale com o banco", () => {
    const [fonte] = Object.values(FONTE_DO_MODULO);
    // Sanidade: achou mesmo o arquivo (senão o teste passaria "vazio").
    expect(fonte).toContain("estimarDasDoSimples");
    expect(fonte).not.toMatch(
      /salvarLancamento|baixarLancamento|fin_lancamento_salvar|supabase/i,
    );
  });
});

// Estimativa do DAS do Simples (só comércio) para quem tem MENOS de 12 meses de vendas no
// app. Decisão do sócio de 25/11/2026 (item 2): a estimativa aparece a partir do SEGUNDO mês
// de vendas, isto é, com 1 mês medido ANTES da competência, com a faixa deduzida pela MÉDIA
// dos meses medidos x 12 (a conta que a Receita manda fazer para empresa nova); com 12 meses
// medidos volta ao cálculo cheio. Com 0 meses medidos (a competência é o próprio mês em que o
// app começou a vender) continua sem estimativa.
//
// RISCO: dinheiro na tela. Todo valor esperado foi calculado à mão (comentário em cada
// caso), com o Anexo I de 2026: faixa 1 até R$ 180 mil (4%), faixa 2 até R$ 360 mil
// (7,3%, deduzir R$ 5.940), faixa 3 até R$ 720 mil (9,5%, R$ 13.860), faixa 4 até
// R$ 1,8 mi (10,7%, R$ 22.500), faixa 5 até R$ 3,6 mi (14,3%, R$ 87.300).
//
// "N meses" = quantos dos meses ANTERIORES à competência o app mediu (do mês em que
// começou a vender até o mês anterior), e é o N que entra na média. Meses que a série traz
// para antes do app (zeros, ou qualquer número) NUNCA entram. Mês medido com zero entra.
// Mês que o app devia ter medido e a série não trouxe (ou veio torto) continua sendo
// "faltam meses": série furada nunca estima.
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

type CadastroDaConta = Pick<
  CadastroFiscal,
  "regime" | "atividade" | "abertaEm" | "vendeNoAppDesde"
>;

// Empresa antiga (aberta em 2020): a regra que vale é a dos 12 meses anteriores.
const antigaDesde = (vendeNoAppDesde: string): CadastroDaConta => ({
  regime: "simples",
  atividade: "comercio",
  abertaEm: "2020-01-15",
  vendeNoAppDesde,
});

function estimar(
  vendeNoAppDesde: string,
  trocas: Partial<EntradaDaEstimativa>,
): EstimativaDoSimples {
  return estimarDasDoSimples({
    cadastro: antigaDesde(vendeNoAppDesde),
    competencia: "2026-06",
    receitaDoMes: 10_000,
    receitasMensais: {},
    ...trocas,
  });
}

const faltam = (quantos: number): EstimativaDoSimples => ({
  estado: "sem_estimativa",
  motivo: "faltam_meses",
  faltam: quantos,
});

const comBase = (valor: number, meses: number): EstimativaDoSimples => ({
  estado: "com_estimativa",
  valor,
  mesesNaMedia: meses,
});

describe("poucos meses de vendas no app: onde a estimativa começa", () => {
  it("0 meses (o app começou a medir NO mês da competência): sem estimativa, falta 1", () => {
    expect(estimar("2026-06-01", { receitasMensais: {} })).toEqual(faltam(1));
  });

  it("0 meses, mesmo com zeros que a leitura devolveu para antes do app: falta 1", () => {
    expect(
      estimar("2026-06-01", {
        receitasMensais: serie("2025-06", "2026-05", 0),
      }),
    ).toEqual(faltam(1));
  });

  it("0 meses, mesmo com valores ALTOS que a leitura devolveu para antes do app: nada disso entra, falta 1", () => {
    expect(
      estimar("2026-06-01", {
        receitasMensais: serie("2025-06", "2026-05", 999_999),
      }),
    ).toEqual(faltam(1));
  });

  it("competência ANTES do início das vendas no app: continua sem comparação com mês anterior ao app", () => {
    expect(
      estimar("2026-07-01", {
        competencia: "2026-06",
        receitasMensais: serie("2025-06", "2026-05", 10_000),
      }),
    ).toEqual({
      estado: "sem_estimativa",
      motivo: "mes_antes_das_vendas_no_app",
    });
  });

  it("1 mês medido: estima, e diz que a base é 1 mês (R$ 10.000 x 12 = R$ 120.000, 4%, DAS de R$ 400)", () => {
    // O app começou em maio; competência junho: 1 mês medido (maio). Média 10.000 x 12 =
    // 120.000 (faixa 1). 4% de 10.000 = 400.
    expect(
      estimar("2026-05-01", { receitasMensais: { "2026-05": 10_000 } }),
    ).toEqual(comBase(400, 1));
  });

  it("1 mês medido de R$ 40.000: RBT12 R$ 480.000 (faixa 3, 6,6125%), DAS do mês de R$ 10.000 = 661,25 -> 660", () => {
    // Efetiva = (480.000 x 0,095 - 13.860) / 480.000 = 31.740 / 480.000 = 6,6125%.
    expect(
      estimar("2026-05-01", { receitasMensais: { "2026-05": 40_000 } }),
    ).toEqual(comBase(660, 1));
  });

  it("1 mês medido: o mês de antes do app, mesmo com valor enorme, NÃO entra", () => {
    expect(
      estimar("2026-05-01", {
        receitasMensais: { "2026-04": 999_999, "2026-05": 10_000 },
      }),
    ).toEqual(comBase(400, 1));
  });

  it("1 mês medido, a competência é o 2º mês de vendas e o mês atual na série nunca é comparado", () => {
    // A série traz até o próprio mês da competência (junho) com valor enorme: fora da janela.
    expect(
      estimar("2026-05-01", {
        receitasMensais: { "2026-05": 10_000, "2026-06": 99_999_999 },
      }),
    ).toEqual(comBase(400, 1));
  });

  it("1 mês medido com número torto (NaN): é buraco, faltam meses; nunca estima por cima", () => {
    expect(
      estimar("2026-05-01", { receitasMensais: { "2026-05": Number.NaN } }),
    ).toEqual(faltam(1));
  });

  it("1 mês medido que a série não trouxe: buraco, faltam meses (não é 'vendeu zero')", () => {
    expect(estimar("2026-05-01", { receitasMensais: {} })).toEqual(faltam(1));
  });

  it("1 mês medido com devolução maior que a venda (negativo) vale zero: RBT12 zero conta como R$ 1,00 (4%), DAS de R$ 400", () => {
    expect(
      estimar("2026-05-01", { receitasMensais: { "2026-05": -5_000 } }),
    ).toEqual(comBase(400, 1));
  });

  it("1 mês medido de R$ 15.000 (R$ 180.000 por ano, fronteira inclusiva da faixa 1): 4%, DAS de R$ 15.000 = R$ 600", () => {
    expect(
      estimar("2026-05-01", {
        receitaDoMes: 15_000,
        receitasMensais: { "2026-05": 15_000 },
      }),
    ).toEqual(comBase(600, 1));
  });

  it("1 mês medido de R$ 300.000 (RBT12 R$ 3,6 mi): ainda abaixo do sublimite; R$ 300.000,01 já passa dele", () => {
    // Faixa 5: efetiva 11,875%; mês de 300.000 = 35.625 -> 35.630.
    expect(
      estimar("2026-05-01", {
        receitaDoMes: 300_000,
        receitasMensais: { "2026-05": 300_000 },
      }),
    ).toEqual(comBase(35_630, 1));
    expect(
      estimar("2026-05-01", { receitasMensais: { "2026-05": 300_000.01 } }),
    ).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_sublimite",
      projecao: true,
    });
  });

  it("1 mês medido de R$ 400.000,01 (RBT12 passa do teto de R$ 4,8 mi): sem estimativa", () => {
    expect(
      estimar("2026-05-01", { receitasMensais: { "2026-05": 400_000.01 } }),
    ).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_teto",
      projecao: true,
    });
  });

  it("2 meses: estima, e diz que a base são 2 meses (R$ 10.000 x 12 = R$ 120.000, 4%, DAS de R$ 400)", () => {
    // Média (10.000 + 10.000) / 2 = 10.000; x 12 = 120.000 (faixa 1). 4% de 10.000 = 400.
    expect(
      estimar("2026-04-01", {
        receitasMensais: serie("2026-04", "2026-05", 10_000),
      }),
    ).toEqual(comBase(400, 2));
  });

  it("2 meses com médias diferentes: usa a MÉDIA, não o último mês (R$ 50.000 e R$ 70.000, RBT12 R$ 720.000, 7,575%)", () => {
    // Média 60.000 x 12 = 720.000 (fronteira inclusiva da faixa 3: 9,5%, deduzir 13.860).
    // Efetiva = (720.000 x 0,095 - 13.860) / 720.000 = 54.540 / 720.000 = 7,575%.
    // Mês de R$ 60.000: 4.545,00 -> dezena, metade para cima: 4.550.
    expect(
      estimar("2026-04-01", {
        receitaDoMes: 60_000,
        receitasMensais: { "2026-04": 50_000, "2026-05": 70_000 },
      }),
    ).toEqual(comBase(4_550, 2));
  });

  it("2 meses, mês ausente da série (não zero): faltam meses, nunca estima com buraco", () => {
    expect(
      estimar("2026-04-01", { receitasMensais: { "2026-05": 10_000 } }),
    ).toEqual(faltam(1));
  });

  it("mês medido com número torto (NaN) conta como mês que falta", () => {
    expect(
      estimar("2026-04-01", {
        receitasMensais: { "2026-04": Number.NaN, "2026-05": 10_000 },
      }),
    ).toEqual(faltam(1));
  });
});

describe("poucos meses de vendas no app: a faixa de fronteira (R$ 180 mil por ano = R$ 15 mil por mês)", () => {
  it("média de R$ 15.000 (10.000 e 20.000): RBT12 R$ 180.000 exatos é faixa 1; DAS de R$ 15.000 = R$ 600", () => {
    // 4% de 15.000 = 600.
    expect(
      estimar("2026-04-01", {
        receitaDoMes: 15_000,
        receitasMensais: { "2026-04": 10_000, "2026-05": 20_000 },
      }),
    ).toEqual(comBase(600, 2));
  });

  it("um centavo acima da fronteira (média R$ 15.000,01): faixa 2, e a DAS continua R$ 600 (a tabela é contínua na fronteira)", () => {
    // Soma 30.000,02; x 12 / 2 = 180.000,12. Efetiva = (180.000,12 x 0,073 - 5.940) / 180.000,12
    // = 7.200,00876 / 180.000,12 = 0,04000002...; x 15.000 = 600,0003 -> 600.
    expect(
      estimar("2026-04-01", {
        receitaDoMes: 15_000,
        receitasMensais: { "2026-04": 15_000, "2026-05": 15_000.02 },
      }),
    ).toEqual(comBase(600, 2));
  });

  it("média de R$ 30.000 (R$ 360.000 por ano): faixa 2, 5,65%, igual a ter 12 meses de R$ 30.000", () => {
    // Efetiva = (360.000 x 0,073 - 5.940) / 360.000 = 20.340 / 360.000 = 5,65%.
    // 5,65% de 30.000 = 1.695 -> dezena, metade para cima: 1.700.
    const parcial = estimar("2026-04-01", {
      receitaDoMes: 30_000,
      receitasMensais: serie("2026-04", "2026-05", 30_000),
    });
    const cheia = estimar("2025-06-01", {
      receitaDoMes: 30_000,
      receitasMensais: serie("2025-06", "2026-05", 30_000),
    });
    expect(parcial).toEqual(comBase(1_700, 2));
    expect(cheia).toEqual({ estado: "com_estimativa", valor: 1_700 });
  });
});

describe("poucos meses de vendas no app: de 11 meses para 12", () => {
  it("11 meses: estima pela média; o mês de 12 meses atrás, anterior ao app, NÃO entra mesmo com valor enorme", () => {
    // O app mede de 2025-07 (11 meses: 2025-07 a 2026-05, todos R$ 10.000). A série traz
    // 2025-06 com R$ 999.999 (a leitura de antes do app não é venda medida) e isso é ignorado.
    // Média 10.000 x 12 = 120.000 -> 4% de 10.000 = 400.
    expect(
      estimar("2025-07-01", {
        receitasMensais: {
          ...serie("2025-07", "2026-05", 10_000),
          "2025-06": 999_999,
        },
      }),
    ).toEqual(comBase(400, 11));
  });

  it("12 meses: volta ao cálculo cheio, com a RBT12 real, e sem o rótulo de 'poucos meses'", () => {
    // O app mede de 2025-06: os 12 meses da janela. 2025-06 vendeu R$ 1.000.000 e os outros
    // 11 meses R$ 10.000: RBT12 = 1.110.000 (faixa 4: 10,7%, deduzir 22.500).
    // Efetiva = (1.110.000 x 0,107 - 22.500) / 1.110.000 = 96.270 / 1.110.000 = 8,67297...%.
    // Mês de 10.000: 867,297 -> dezena: 870.
    expect(
      estimar("2025-06-01", {
        receitasMensais: {
          ...serie("2025-06", "2026-05", 10_000),
          "2025-06": 1_000_000,
        },
      }),
    ).toEqual({ estado: "com_estimativa", valor: 870 });
  });

  it("e com 11 meses, o mesmo R$ 1.000.000 de 2025-06 (antes do app) não puxa a faixa para cima", () => {
    // Mesma série do teste acima, mas o app só começou em 2025-07: o milhão é ignorado.
    expect(
      estimar("2025-07-01", {
        receitasMensais: {
          ...serie("2025-07", "2026-05", 10_000),
          "2025-06": 1_000_000,
        },
      }),
    ).toEqual(comBase(400, 11));
  });

  it("app medindo há MAIS de 12 meses: cálculo cheio, sem rótulo", () => {
    expect(
      estimar("2024-01-01", {
        receitasMensais: serie("2024-01", "2026-05", 10_000),
      }),
    ).toEqual({ estado: "com_estimativa", valor: 400 });
  });
});

describe("poucos meses de vendas no app: mês zerado, virada de ano e tetos", () => {
  it("mês zerado no meio CONTA como mês medido e puxa a média para baixo (4 meses: 20.000, 0, 0, 40.000)", () => {
    // Soma 60.000 / 4 = 15.000; x 12 = 180.000 (faixa 1, 4%) -> mês de 10.000 = 400.
    // Se os zeros fossem jogados fora, seriam 2 meses (média 30.000, RBT12 360.000, 5,65%)
    // e a DAS seria 570: o teste prova que não são.
    expect(
      estimar("2026-02-01", {
        receitasMensais: {
          "2026-02": 20_000,
          "2026-03": 0,
          "2026-04": 0,
          "2026-05": 40_000,
        },
      }),
    ).toEqual(comBase(400, 4));
  });

  it("todos os meses medidos zerados e o mês vendeu: RBT12 zero conta como R$ 1,00 (4%), DAS de R$ 400", () => {
    expect(
      estimar("2026-04-01", {
        receitasMensais: { "2026-04": 0, "2026-05": 0 },
      }),
    ).toEqual(comBase(400, 2));
  });

  it("virada de ano: competência 2026-01 com o app desde 2025-11 (2 meses: novembro e dezembro)", () => {
    // Janela de 2026-01 = 2025-01 a 2025-12; o app mede 2025-11 e 2025-12 (R$ 10.000 cada).
    expect(
      estimar("2025-11-01", {
        competencia: "2026-01",
        receitasMensais: {
          ...serie("2025-01", "2025-10", 0),
          "2025-11": 10_000,
          "2025-12": 10_000,
        },
      }),
    ).toEqual(comBase(400, 2));
  });

  it("2 meses com média de R$ 400.000: RBT12 R$ 4,8 mi passa do sublimite (R$ 3,6 mi): sem estimativa", () => {
    expect(
      estimar("2026-04-01", {
        receitasMensais: serie("2026-04", "2026-05", 400_000),
      }),
    ).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_sublimite",
      projecao: true,
    });
  });

  it("2 meses com média de R$ 400.000,01: RBT12 passa do teto de R$ 4,8 mi: sem estimativa", () => {
    // 400.000,00 + 400.000,02 = 800.000,02; x 12 / 2 = 4.800.000,12.
    expect(
      estimar("2026-04-01", {
        receitasMensais: { "2026-04": 400_000, "2026-05": 400_000.02 },
      }),
    ).toEqual({
      estado: "sem_estimativa",
      motivo: "acima_do_teto",
      projecao: true,
    });
  });

  it("2 meses com média de R$ 300.000 (RBT12 R$ 3,6 mi, ainda abaixo do sublimite): faixa 5, 11,875%", () => {
    // Efetiva = (3.600.000 x 0,143 - 87.300) / 3.600.000 = 427.500 / 3.600.000 = 11,875%.
    // Mês de 300.000: 35.625 -> dezena, metade para cima: 35.630.
    expect(
      estimar("2026-04-01", {
        receitaDoMes: 300_000,
        receitasMensais: serie("2026-04", "2026-05", 300_000),
      }),
    ).toEqual(comBase(35_630, 2));
  });

  it("receita de um mês com devolução maior que a venda (negativa) vale zero na média", () => {
    // Abril -5.000 vale 0; maio 30.000: soma 30.000 / 2 = 15.000; x 12 = 180.000 -> 4%.
    expect(
      estimar("2026-04-01", {
        receitasMensais: { "2026-04": -5_000, "2026-05": 30_000 },
      }),
    ).toEqual(comBase(400, 2));
  });
});

describe("poucos meses de vendas no app: empresa com menos de 12 meses de ATIVIDADE", () => {
  // Aberta em janeiro, mas o app só começou a vender em abril: antes disso a empresa vendia
  // por fora (o app não vê). A regra da Receita pede os meses anteriores da empresa; o app
  // só tem os que mediu.
  const ABERTA_EM_JANEIRO = (vendeNoAppDesde: string): CadastroDaConta => ({
    regime: "simples",
    atividade: "comercio",
    abertaEm: "2026-01-05",
    vendeNoAppDesde,
  });

  it("6º mês de atividade, app medindo abril e maio (2 meses): estima pela média desses 2 meses", () => {
    // Média (10.000 + 30.000) / 2 = 20.000; x 12 = 240.000 (faixa 2: 7,3%, deduzir 5.940).
    // Efetiva = (240.000 x 0,073 - 5.940) / 240.000 = 11.580 / 240.000 = 4,825%.
    // Mês de 20.000: 965,00 -> dezena: 970.
    expect(
      estimarDasDoSimples({
        cadastro: ABERTA_EM_JANEIRO("2026-04-01"),
        competencia: "2026-06",
        receitaDoMes: 20_000,
        receitasMensais: { "2026-04": 10_000, "2026-05": 30_000 },
      }),
    ).toEqual(comBase(970, 2));
  });

  it("6º mês de atividade, app medindo só maio (1 mês): estima pela média desse 1 mês, com o rótulo de 1 mês", () => {
    // Janeiro a abril são meses de antes do app (não entram). Maio 30.000 x 12 = 360.000
    // (fronteira inclusiva da faixa 2: 7,3%, deduzir 5.940): efetiva 20.340 / 360.000 = 5,65%.
    // Mês de 20.000: 1.130,00 -> 1.130.
    expect(
      estimarDasDoSimples({
        cadastro: ABERTA_EM_JANEIRO("2026-05-01"),
        competencia: "2026-06",
        receitaDoMes: 20_000,
        receitasMensais: { "2026-05": 30_000 },
      }),
    ).toEqual(comBase(1_130, 1));
  });

  it("6º mês de atividade, app começando NO mês da competência (0 meses medidos): falta 1", () => {
    expect(
      estimarDasDoSimples({
        cadastro: ABERTA_EM_JANEIRO("2026-06-01"),
        competencia: "2026-06",
        receitaDoMes: 20_000,
        receitasMensais: {},
      }),
    ).toEqual(faltam(1));
  });

  it("app medindo desde a abertura: cálculo completo da empresa nova, SEM rótulo de poucos meses", () => {
    // 4º mês (abril): média de janeiro a março (3 meses de R$ 10.000) x 12 = 120.000 -> 4% de 10.000.
    expect(
      estimarDasDoSimples({
        cadastro: ABERTA_EM_JANEIRO("2026-01-01"),
        competencia: "2026-04",
        receitaDoMes: 10_000,
        receitasMensais: serie("2026-01", "2026-03", 10_000),
      }),
    ).toEqual({ estado: "com_estimativa", valor: 400 });
  });

  it("1º mês de atividade continua anualizando o próprio mês, sem rótulo (regra da Receita)", () => {
    // R$ 20.000 x 12 = 240.000: 4,825% de 20.000 = 965 -> 970.
    expect(
      estimarDasDoSimples({
        cadastro: ABERTA_EM_JANEIRO("2026-01-01"),
        competencia: "2026-01",
        receitaDoMes: 20_000,
        receitasMensais: {},
      }),
    ).toEqual({ estado: "com_estimativa", valor: 970 });
  });
});

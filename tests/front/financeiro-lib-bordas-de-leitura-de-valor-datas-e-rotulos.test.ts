// Bordas do dinheiro digitado, do período e dos rótulos de data do Financeiro.
//
// A caça por mutação em `src/lib/financeiro.ts` achou linhas que nenhum teste
// vigiava: trocar a regra e a suíte seguia verde. Este arquivo as fixa, com
// valores fictícios:
//  - "R$ 12 34" (espaço fora do milhar) não vira R$ 1.234,00 por engano;
//  - "1 234,567" (3 casas) e "1 234," não viram dinheiro;
//  - "- 10" (sinal, espaço, número) é −10; número gigante não vira `Infinity`;
//  - um período de UM dia vale, e 400 dias é o limite exato do banco;
//  - mês curto do gráfico sai "set/26" (sem ponto e com ano de 2 dígitos);
//  - data sem hora no detalhe NÃO atrasa um dia por causa do fuso;
//  - período sem datas diz "Escolha as datas" em qualquer atalho;
//  - data que não existe no calendário vira "—" em vez de lixo.
import { describe, expect, it } from "vitest";

import {
  formatarData,
  formatarDataCurta,
  formatarDataHora,
  formatarDiaPorExtenso,
  intervaloDoPeriodo,
  mesesDoIntervalo,
  parseValorBR,
  rotuloDoPeriodo,
  validarIntervalo,
} from "@/lib/financeiro";
import type { DataIso } from "@/types/financeiro";

describe("parseValorBR: espaço e sinal", () => {
  it("espaço só vale entre grupos completos de milhar", () => {
    expect(parseValorBR("1 234,56")).toBe(1234.56);
    expect(parseValorBR("12 345")).toBe(12345);
    // grupo incompleto ou grande demais: não é dinheiro, é digitação errada
    expect(parseValorBR("12 34")).toBeNull();
    expect(parseValorBR("1 2345")).toBeNull();
    expect(parseValorBR("R$ 12 34")).toBeNull();
  });

  it("com espaço, a parte decimal tem de ter 1 ou 2 casas (nunca 3, nunca vazia)", () => {
    expect(parseValorBR("1 234,5")).toBe(1234.5);
    expect(parseValorBR("1 234,567")).toBeNull();
    expect(parseValorBR("1 234,")).toBeNull();
  });

  it("sinal, espaço e número: '- 10' é −10", () => {
    expect(parseValorBR("- 10")).toBe(-10);
    expect(parseValorBR("−  R$ 10,50")).toBe(-10.5);
  });

  it("número grande demais para existir não vira Infinity", () => {
    expect(parseValorBR("9".repeat(400))).toBeNull();
    expect(parseValorBR(`${"9".repeat(400)},50`)).toBeNull();
  });

  // Finito em reais mas Infinity em centavos (×100 estoura): sem a conferência
  // depois da conversão, a taxa de entrega local era gravada como R$ 0.
  it("número finito que estoura ao virar centavos também não vira Infinity", () => {
    expect(parseValorBR(`1${"0".repeat(307)}`)).toBeNull();
    expect(parseValorBR(`1${"0".repeat(308)}`)).toBeNull();
    expect(parseValorBR(1e307)).toBeNull();
  });
});

describe("período de datas: bordas", () => {
  it("um dia só (início = fim) é um período válido", () => {
    expect(validarIntervalo("2026-09-26", "2026-09-26")).toBeNull();
    expect(
      intervaloDoPeriodo(
        {
          preset: "personalizado",
          personalizado: { inicio: "2026-09-26", fim: "2026-09-26" },
        },
        "2026-09-30",
      ),
    ).toEqual({ inicio: "2026-09-26", fim: "2026-09-26" });
  });

  it("fim um dia antes do início continua recusado", () => {
    expect(validarIntervalo("2026-09-26", "2026-09-25")).toBe(
      "A data de fim vem antes da data de início.",
    );
  });

  it("400 dias de diferença passam; 401 não (o mesmo limite do banco)", () => {
    // 2026-01-01 + 400 dias = 2027-02-05
    expect(validarIntervalo("2026-01-01", "2027-02-05")).toBeNull();
    expect(validarIntervalo("2026-01-01", "2027-02-06")).toBe(
      "O período pode ter no máximo 400 dias. Escolha datas mais próximas.",
    );
  });
});

describe("mesesDoIntervalo: rótulo e trava", () => {
  it("rótulo do mês: três letras minúsculas, sem ponto, barra e ano de 2 dígitos", () => {
    expect(
      mesesDoIntervalo({ inicio: "2026-01-01", fim: "2026-12-31" }).map(
        (mes) => mes.rotulo,
      ),
    ).toEqual([
      "jan/26",
      "fev/26",
      "mar/26",
      "abr/26",
      "mai/26",
      "jun/26",
      "jul/26",
      "ago/26",
      "set/26",
      "out/26",
      "nov/26",
      "dez/26",
    ]);
  });

  it("no máximo 120 meses, mesmo que o intervalo peça mais (trava contra laço sem fim)", () => {
    const meses = mesesDoIntervalo({ inicio: "2000-01-01", fim: "2020-12-31" });
    expect(meses).toHaveLength(120);
    expect(meses.at(-1)).toMatchObject({
      inicio: "2009-12-01",
      fim: "2009-12-31",
    });
  });
});

describe("rótulos de data", () => {
  it("data sem hora no detalhe mostra o dia certo, sem atrasar um dia pelo fuso", () => {
    expect(formatarDataHora("2026-09-26")).toBe("26/09/2026");
  });

  it("instante com hora usa o relógio de São Paulo", () => {
    expect(formatarDataHora("2026-09-26T12:12:00Z")).toBe("26/09, 09:12");
  });

  it("período sem datas fala 'Escolha as datas' em qualquer atalho", () => {
    expect(rotuloDoPeriodo({ preset: "personalizado" }, null)).toBe(
      "Escolha as datas",
    );
    expect(rotuloDoPeriodo({ preset: "7d" }, null)).toBe("Escolha as datas");
    expect(rotuloDoPeriodo({ preset: "mes_atual" }, null)).toBe(
      "Escolha as datas",
    );
  });

  it("data que não existe no calendário não vira lixo na tela", () => {
    const fantasma = "2026-02-31" as DataIso;
    expect(formatarData(fantasma)).toBe("—");
    expect(formatarData("abc" as DataIso)).toBe("—");
    expect(formatarData(null)).toBe("—");
    // as outras duas devolvem o texto como veio, sem inventar dia nem mês
    expect(formatarDataCurta(fantasma)).toBe("2026-02-31");
    expect(formatarDiaPorExtenso(fantasma)).toBe("2026-02-31");
  });
});

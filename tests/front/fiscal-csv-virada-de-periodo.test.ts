// Gestão Fiscal, caça por mutação: as FRONTEIRAS do período no CSV do contador, em
// especial a virada de ano e os meses de 28, 29 e 30 dias.
//
// O que cada teste protege (em português simples):
//   - o mês de 30 dias (abril) e o de 28 (fevereiro de 2027) terminam no dia certo: a venda
//     do último dia entra, a do dia seguinte não;
//   - o ano vai de 1º de janeiro a 31 de dezembro, sem escorregar para o ano vizinho;
//   - a guia pertence ao mês da COMPETÊNCIA: a de dezembro de 2026, que vence em
//     20/01/2027, está no arquivo de 2026 (e não no de 2027), inclusive o "Pago";
//   - o nome do arquivo usa o calendário de São Paulo na virada do ano.
//
// Todas as datas esperadas foram escritas à mão.
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import {
  type EntradaDoCsvDoContador,
  type LancamentoDoCsv,
  montarCsvDoContador,
  periodoDaReferencia,
} from "@/lib/fiscal/csv-do-contador";

type LinhaMinima = EntradaDoCsvDoContador["extrato"][number];

const CRLF = "\r\n";

const venda = (data: string, valor = 100): LinhaMinima => ({
  origem: "venda_balcao",
  tipo: "entrada",
  status: "realizado",
  valor,
  data,
  descricao: "Venda",
});

const guia = (trocas: Partial<LancamentoDoCsv> = {}): LancamentoDoCsv => ({
  valor: 50,
  status: "previsto",
  data_competencia: "2026-12-01",
  data_vencimento: "2027-01-20",
  data_realizacao: null,
  ...trocas,
});

const AGORA = new Date("2027-02-01T12:00:00Z");

function corpoDe(trocas: Partial<EntradaDoCsvDoContador>): string[] {
  const csv = montarCsvDoContador({
    modo: "mensal",
    referencia: "2026-10",
    extrato: [],
    guias: [],
    agora: AGORA,
    ...trocas,
  });
  if (!csv) throw new Error("o CSV saiu vazio, e o teste esperava dados");
  return csv.texto.slice(1).split(CRLF).slice(1);
}

describe("periodoDaReferencia: primeiro e último dia", () => {
  it.each([
    ["2026-01", "2026-01-01", "2026-01-31"],
    ["2026-02", "2026-02-01", "2026-02-28"],
    ["2028-02", "2028-02-01", "2028-02-29"],
    ["2026-04", "2026-04-01", "2026-04-30"],
    ["2026-06", "2026-06-01", "2026-06-30"],
    ["2026-09", "2026-09-01", "2026-09-30"],
    ["2026-11", "2026-11-01", "2026-11-30"],
    ["2026-12", "2026-12-01", "2026-12-31"],
    ["2100-02", "2100-02-01", "2100-02-28"], // século não bissexto
  ])("mensal %s vai de %s a %s", (referencia, inicio, fim) => {
    expect(periodoDaReferencia("mensal", referencia)).toEqual({ inicio, fim });
  });

  it("anual 2026 vai de 1º de janeiro a 31 de dezembro", () => {
    expect(periodoDaReferencia("anual", "2026")).toEqual({
      inicio: "2026-01-01",
      fim: "2026-12-31",
    });
  });

  it.each([
    ["mensal", "2026-13"],
    ["mensal", "2026-00"],
    ["mensal", "2026-1"],
    ["mensal", "2026"],
    ["mensal", ""],
    ["anual", "2026-10"],
    ["anual", "26"],
    ["anual", ""],
  ] as const)(
    "%s com referência torta %j é erro de quem chamou",
    (modo, ref) => {
      expect(() => periodoDaReferencia(modo, ref)).toThrow();
    },
  );
});

describe("CSV do contador: o último dia de cada tipo de mês", () => {
  it("abril (30 dias): 30/04 entra; 01/05 e 31/03 ficam fora", () => {
    const corpo = corpoDe({
      referencia: "2026-04",
      extrato: [
        venda("2026-03-31", 1),
        venda("2026-04-01", 2),
        venda("2026-04-30", 3),
        venda("2026-05-01", 4),
      ],
    });
    expect(corpo).toEqual([
      "Receita do dia;01/04/2026;;;2,00;",
      "Receita do dia;30/04/2026;;;3,00;",
    ]);
  });

  it("fevereiro de 2027 (28 dias): 28/02 entra; 01/03 fica fora", () => {
    const corpo = corpoDe({
      referencia: "2027-02",
      extrato: [venda("2027-02-28", 5), venda("2027-03-01", 6)],
    });
    expect(corpo).toEqual(["Receita do dia;28/02/2027;;;5,00;"]);
  });

  it("dezembro: 01/12 e 31/12 entram; 30/11 e 01/01 do ano seguinte ficam fora", () => {
    const corpo = corpoDe({
      referencia: "2026-12",
      extrato: [
        venda("2026-11-30", 1),
        venda("2026-12-01", 2),
        venda("2026-12-31", 3),
        venda("2027-01-01", 4),
      ],
    });
    expect(corpo).toEqual([
      "Receita do dia;01/12/2026;;;2,00;",
      "Receita do dia;31/12/2026;;;3,00;",
    ]);
  });

  it("guia com competência em abril aparece no arquivo de abril (mês de 30 dias)", () => {
    const corpo = corpoDe({
      referencia: "2026-04",
      guias: [
        guia({ data_competencia: "2026-04-01", data_vencimento: "2026-05-20" }),
      ],
    });
    expect(corpo).toEqual(["Guia;;04/2026;20/05/2026;50,00;"]);
  });

  it("guia com competência em fevereiro aparece no arquivo de fevereiro de 2027", () => {
    const corpo = corpoDe({
      referencia: "2027-02",
      guias: [
        guia({ data_competencia: "2027-02-01", data_vencimento: "2027-03-22" }),
      ],
    });
    expect(corpo).toEqual(["Guia;;02/2027;22/03/2027;50,00;"]);
  });
});

describe("CSV do contador: o ano inteiro e a virada", () => {
  it("anual 2026: 01/01 e 31/12 entram; 31/12/2025 e 01/01/2027 ficam fora", () => {
    const corpo = corpoDe({
      modo: "anual",
      referencia: "2026",
      extrato: [
        venda("2025-12-31", 1),
        venda("2026-01-01", 2),
        venda("2026-12-31", 3),
        venda("2027-01-01", 4),
      ],
    });
    expect(corpo).toEqual([
      "Receita do dia;01/01/2026;;;2,00;",
      "Receita do dia;31/12/2026;;;3,00;",
    ]);
  });

  it("a guia de dezembro/2026, que vence em 20/01/2027, está no arquivo de 2026 e não no de 2027", () => {
    const guias = [
      guia({
        status: "realizado",
        data_competencia: "2026-12-01",
        data_vencimento: "2027-01-20",
        data_realizacao: "2027-01-19",
      }),
    ];
    expect(corpoDe({ modo: "anual", referencia: "2026", guias })).toEqual([
      "Guia;;12/2026;20/01/2027;50,00;",
      "Pago;19/01/2027;12/2026;20/01/2027;50,00;",
    ]);
    // 2027 não tem nada: nem venda, nem guia de competência 2027.
    expect(
      montarCsvDoContador({
        modo: "anual",
        referencia: "2027",
        extrato: [],
        guias,
        agora: AGORA,
      }),
    ).toBeNull();
  });

  it("a guia de dezembro/2025 não entra no arquivo de 2026", () => {
    expect(
      montarCsvDoContador({
        modo: "anual",
        referencia: "2026",
        extrato: [],
        guias: [
          guia({
            data_competencia: "2025-12-01",
            data_vencimento: "2026-01-20",
          }),
        ],
        agora: AGORA,
      }),
    ).toBeNull();
  });

  it("mensal de janeiro/2027 não pega a guia de dezembro/2026 só porque ela vence em janeiro", () => {
    expect(
      montarCsvDoContador({
        modo: "mensal",
        referencia: "2027-01",
        extrato: [],
        guias: [guia()],
        agora: AGORA,
      }),
    ).toBeNull();
  });
});

describe("CSV do contador: o nome do arquivo na virada do ano (calendário de São Paulo)", () => {
  it("01/01/2027 02:30 em UTC ainda é 31/12/2026 23:30 em São Paulo", () => {
    const csv = montarCsvDoContador({
      modo: "anual",
      referencia: "2026",
      extrato: [venda("2026-06-10")],
      guias: [],
      agora: new Date("2027-01-01T02:30:00Z"),
    });
    expect(csv?.nomeDoArquivo).toBe("impostos-anual-2026-2026-12-31-23-30.csv");
  });

  it("01/01/2027 03:00 em UTC já é 00:00 de 01/01/2027 em São Paulo", () => {
    const csv = montarCsvDoContador({
      modo: "mensal",
      referencia: "2026-12",
      extrato: [venda("2026-12-10")],
      guias: [],
      agora: new Date("2027-01-01T03:00:00Z"),
    });
    expect(csv?.nomeDoArquivo).toBe(
      "impostos-mensal-2026-12-2027-01-01-00-00.csv",
    );
  });
});

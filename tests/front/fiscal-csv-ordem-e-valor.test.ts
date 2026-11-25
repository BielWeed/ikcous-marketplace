// Gestão Fiscal, caça por mutação: a ORDEM das linhas e o formato do VALOR no CSV do
// contador. É o que o contador abre na planilha, então linha fora de ordem ou "-0,00"
// são defeitos que ele vê.
//
// O que cada teste protege (em português simples):
//   - duas devoluções do mesmo dia saem na ordem em que vieram (a ordenação não embaralha
//     empate);
//   - guias da mesma competência saem por vencimento, e a sem vencimento fica por último;
//   - os "Pago" saem pela data em que a guia foi paga, não pela competência;
//   - guia com valor que não é número é ignorada (nunca "NaN" no arquivo);
//   - valor zero sai "0,00" (nunca "-0,00"), centavo com zero à esquerda sai "0,05" e
//     crédito (valor negativo) sai "-5,50" sem apóstrofo.
//
// Todos os valores e linhas esperadas foram escritos à mão.
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import {
  type EntradaDoCsvDoContador,
  type LancamentoDoCsv,
  montarCsvDoContador,
} from "@/lib/fiscal/csv-do-contador";

type LinhaMinima = EntradaDoCsvDoContador["extrato"][number];

const CRLF = "\r\n";

const estorno = (trocas: Partial<LinhaMinima> = {}): LinhaMinima => ({
  origem: "estorno",
  tipo: "saida",
  status: "realizado",
  valor: 30,
  data: "2026-10-06",
  descricao: "Estorno A",
  ...trocas,
});

const guia = (trocas: Partial<LancamentoDoCsv> = {}): LancamentoDoCsv => ({
  valor: 75.5,
  status: "previsto",
  data_competencia: "2026-10-01",
  data_vencimento: "2026-11-20",
  data_realizacao: null,
  ...trocas,
});

const entrada = (
  trocas: Partial<EntradaDoCsvDoContador> = {},
): EntradaDoCsvDoContador => ({
  modo: "mensal",
  referencia: "2026-10",
  extrato: [],
  guias: [],
  agora: new Date("2026-11-24T20:49:00Z"),
  ...trocas,
});

/** As linhas do arquivo sem o cabeçalho. Falha se o período saiu vazio. */
function corpoDe(e: EntradaDoCsvDoContador): string[] {
  const csv = montarCsvDoContador(e);
  if (!csv) throw new Error("o CSV saiu vazio, e o teste esperava dados");
  return csv.texto.slice(1).split(CRLF).slice(1);
}

describe("CSV do contador: ordem das devoluções", () => {
  it("duas devoluções do mesmo dia saem na ordem em que vieram", () => {
    const corpo = corpoDe(
      entrada({
        extrato: [
          estorno({ descricao: "primeira", valor: 10 }),
          estorno({ descricao: "segunda", valor: 20 }),
          estorno({ descricao: "terceira", valor: 30 }),
        ],
      }),
    );
    expect(corpo).toEqual([
      "Devolução ou estorno;06/10/2026;;;10,00;primeira",
      "Devolução ou estorno;06/10/2026;;;20,00;segunda",
      "Devolução ou estorno;06/10/2026;;;30,00;terceira",
    ]);
  });

  it("devoluções de dias diferentes saem do mais antigo ao mais novo, qualquer que seja a ordem de entrada", () => {
    const corpo = corpoDe(
      entrada({
        extrato: [
          estorno({ descricao: "dia 20", data: "2026-10-20" }),
          estorno({ descricao: "dia 02", data: "2026-10-02" }),
          estorno({ descricao: "dia 11", data: "2026-10-11" }),
        ],
      }),
    );
    expect(corpo.map((l) => l.split(";")[1])).toEqual([
      "02/10/2026",
      "11/10/2026",
      "20/10/2026",
    ]);
  });
});

describe("CSV do contador: ordem das guias e dos pagos", () => {
  it("na mesma competência, a guia que vence antes vem primeiro, mesmo chegando por último", () => {
    const corpo = corpoDe(
      entrada({
        guias: [
          guia({ valor: 3, data_vencimento: "2026-11-25" }),
          guia({ valor: 2, data_vencimento: "2026-11-20" }),
        ],
      }),
    );
    expect(corpo).toEqual([
      "Guia;;10/2026;20/11/2026;2,00;",
      "Guia;;10/2026;25/11/2026;3,00;",
    ]);
  });

  it("na mesma competência, a guia SEM vencimento fica por último", () => {
    const corpo = corpoDe(
      entrada({
        guias: [
          guia({ valor: 1, data_vencimento: null }),
          guia({ valor: 3, data_vencimento: "2026-11-25" }),
          guia({ valor: 2, data_vencimento: "2026-11-20" }),
        ],
      }),
    );
    expect(corpo).toEqual([
      "Guia;;10/2026;20/11/2026;2,00;",
      "Guia;;10/2026;25/11/2026;3,00;",
      "Guia;;10/2026;;1,00;",
    ]);
  });

  it("a competência manda mais que o vencimento: setembro vem antes de outubro", () => {
    const corpo = corpoDe(
      entrada({
        modo: "anual",
        referencia: "2026",
        guias: [
          guia({
            valor: 2,
            data_competencia: "2026-10-01",
            data_vencimento: "2026-11-05",
          }),
          guia({
            valor: 1,
            data_competencia: "2026-09-01",
            data_vencimento: "2026-10-30",
          }),
        ],
      }),
    );
    expect(corpo).toEqual([
      "Guia;;09/2026;30/10/2026;1,00;",
      "Guia;;10/2026;05/11/2026;2,00;",
    ]);
  });

  it("os Pago saem pela data do pagamento, e não pela ordem das guias", () => {
    const corpo = corpoDe(
      entrada({
        modo: "anual",
        referencia: "2026",
        guias: [
          guia({
            valor: 1,
            status: "realizado",
            data_competencia: "2026-09-01",
            data_vencimento: "2026-10-20",
            data_realizacao: "2026-11-30",
          }),
          guia({
            valor: 2,
            status: "realizado",
            data_competencia: "2026-10-01",
            data_vencimento: "2026-11-20",
            data_realizacao: "2026-11-02",
          }),
        ],
      }),
    );
    expect(corpo).toEqual([
      "Guia;;09/2026;20/10/2026;1,00;",
      "Guia;;10/2026;20/11/2026;2,00;",
      "Pago;02/11/2026;10/2026;20/11/2026;2,00;",
      "Pago;30/11/2026;09/2026;20/10/2026;1,00;",
    ]);
  });
});

describe("CSV do contador: valor que não é número, zero e centavos", () => {
  it("guia com valor NaN ou infinito é ignorada, e as outras seguem", () => {
    const csv = montarCsvDoContador(
      entrada({
        guias: [
          guia({ valor: Number.NaN }),
          guia({ valor: Number.POSITIVE_INFINITY }),
          guia({ valor: 10 }),
        ],
      }),
    );
    expect(csv?.texto).not.toMatch(/NaN|Infinity/);
    expect(
      corpoDe(entrada({ guias: [guia({ valor: Number.NaN }), guia()] })),
    ).toEqual(["Guia;;10/2026;20/11/2026;75,50;"]);
  });

  it("só havia guia com valor que não é número: não há o que mandar (null)", () => {
    expect(
      montarCsvDoContador(entrada({ guias: [guia({ valor: Number.NaN })] })),
    ).toBeNull();
  });

  it("valor zero sai 0,00, nunca -0,00", () => {
    const corpo = corpoDe(entrada({ guias: [guia({ valor: 0 })] }));
    expect(corpo).toEqual(["Guia;;10/2026;20/11/2026;0,00;"]);
  });

  it("menos de meio centavo arredonda para 0,00 e centavo solto leva zero à esquerda", () => {
    const corpo = corpoDe(
      entrada({
        guias: [
          guia({ valor: 0.004, data_vencimento: "2026-11-01" }),
          guia({ valor: 0.05, data_vencimento: "2026-11-02" }),
          guia({ valor: 100.07, data_vencimento: "2026-11-03" }),
        ],
      }),
    );
    expect(corpo).toEqual([
      "Guia;;10/2026;01/11/2026;0,00;",
      "Guia;;10/2026;02/11/2026;0,05;",
      "Guia;;10/2026;03/11/2026;100,07;",
    ]);
  });

  it("valor grande não ganha separador de milhar", () => {
    const corpo = corpoDe(entrada({ guias: [guia({ valor: 1234567.89 })] }));
    expect(corpo).toEqual(["Guia;;10/2026;20/11/2026;1234567,89;"]);
  });

  it("crédito (valor negativo) sai como número, com o sinal e sem apóstrofo", () => {
    const corpo = corpoDe(entrada({ guias: [guia({ valor: -5.5 })] }));
    expect(corpo).toEqual(["Guia;;10/2026;20/11/2026;-5,50;"]);
  });
});

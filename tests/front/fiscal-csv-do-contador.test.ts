import { montarCaderno } from "@/lib/fiscal/caderno";
// Gestão Fiscal, tarefa 14: o arquivo CSV para o contador.
//
// Função pura: recebe as linhas do extrato do Financeiro e as guias que a lojista
// lançou, e devolve o texto do CSV (ou `null` quando o período não tem nada).
//
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import {
  type EntradaDoCsvDoContador,
  type LancamentoDoCsv,
  montarCsvDoContador,
} from "@/lib/fiscal/csv-do-contador";
import { describe, expect, it } from "vitest";

type LinhaMinima = EntradaDoCsvDoContador["extrato"][number];

const CRLF = "\r\n";
const CABECALHO = "Tipo;Data;Competência;Vencimento;Valor (R$);Descrição";

const venda = (trocas: Partial<LinhaMinima> = {}): LinhaMinima => ({
  origem: "venda_online",
  tipo: "entrada",
  status: "realizado",
  valor: 100,
  data: "2026-10-05",
  descricao: "Venda online",
  ...trocas,
});

const estorno = (trocas: Partial<LinhaMinima> = {}): LinhaMinima => ({
  origem: "estorno",
  tipo: "saida",
  status: "realizado",
  valor: 30,
  data: "2026-10-06",
  descricao: "Estorno do pedido #ABC123",
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

/** O texto do CSV sem o BOM, em linhas. Falha se o período saiu vazio. */
function linhasDe(e: EntradaDoCsvDoContador): string[] {
  const csv = montarCsvDoContador(e);
  if (!csv) throw new Error("o CSV saiu vazio, e o teste esperava dados");
  expect(csv.texto.startsWith("\uFEFF")).toBe(true);
  return csv.texto.slice(1).split(CRLF);
}

describe("CSV do contador: forma do arquivo", () => {
  it("começa com BOM, usa CRLF e tem as colunas FIXAS nesta ordem", () => {
    const linhas = linhasDe(entrada({ extrato: [venda()] }));
    expect(linhas[0]).toBe(CABECALHO);
  });

  it("valor em reais com 2 casas e vírgula decimal, sem separador de milhar", () => {
    const linhas = linhasDe(
      entrada({
        extrato: [
          venda({ valor: 1234.5 }),
          venda({ valor: 10, data: "2026-10-07" }),
        ],
      }),
    );
    expect(linhas.slice(1)).toEqual([
      "Receita do dia;05/10/2026;;;1234,50;",
      "Receita do dia;07/10/2026;;;10,00;",
    ]);
  });

  it("as seções saem na ordem receita, devoluções, guias e pagos", () => {
    const linhas = linhasDe(
      entrada({
        extrato: [estorno(), venda()],
        guias: [guia({ status: "realizado", data_realizacao: "2026-11-18" })],
      }),
    );
    expect(linhas.slice(1).map((l) => l.split(";")[0])).toEqual([
      "Receita do dia",
      "Devolução ou estorno",
      "Guia",
      "Pago",
    ]);
  });
});

describe("CSV do contador: receita por dia", () => {
  it("soma as vendas realizadas do mesmo dia, de qualquer canal", () => {
    const linhas = linhasDe(
      entrada({
        extrato: [
          venda({ valor: 100 }),
          venda({ origem: "venda_balcao", valor: 50.25 }),
          venda({ origem: "venda_entrega", valor: 20 }),
        ],
      }),
    );
    expect(linhas.slice(1)).toEqual(["Receita do dia;05/10/2026;;;170,25;"]);
  });

  it("soma em centavos: 0,10 + 0,20 dá exatamente 0,30", () => {
    const linhas = linhasDe(
      entrada({ extrato: [venda({ valor: 0.1 }), venda({ valor: 0.2 })] }),
    );
    expect(linhas[1]).toBe("Receita do dia;05/10/2026;;;0,30;");
  });

  it("valor que o ponto flutuante erra (1,15 x 100 = 114,99999...) sai certo", () => {
    const linhas = linhasDe(
      entrada({
        extrato: [
          venda({ valor: 1.15 }),
          venda({ valor: 0.07, data: "2026-10-06" }),
          venda({ valor: 8.2, data: "2026-10-06" }),
        ],
        guias: [guia({ valor: 4.35 })],
      }),
    );
    expect(linhas.slice(1)).toEqual([
      "Receita do dia;05/10/2026;;;1,15;",
      "Receita do dia;06/10/2026;;;8,27;",
      "Guia;;10/2026;20/11/2026;4,35;",
    ]);
  });

  it("só conta venda REALIZADA: previsto, cancelado, saída e lançamento manual ficam fora", () => {
    const linhas = linhasDe(
      entrada({
        extrato: [
          venda({ valor: 100 }),
          venda({ status: "previsto", valor: 1000 }),
          venda({ status: "cancelado", valor: 2000 }),
          venda({ tipo: "saida", valor: 3000 }),
          venda({ origem: "manual", valor: 4000 }),
          venda({ origem: "suprimento", valor: 5000 }),
        ],
      }),
    );
    expect(linhas.slice(1)).toEqual(["Receita do dia;05/10/2026;;;100,00;"]);
  });

  it("dias em ordem do mais antigo ao mais novo", () => {
    const linhas = linhasDe(
      entrada({
        extrato: [
          venda({ data: "2026-10-20" }),
          venda({ data: "2026-10-02" }),
          venda({ data: "2026-10-11" }),
        ],
      }),
    );
    expect(linhas.slice(1).map((l) => l.split(";")[1])).toEqual([
      "02/10/2026",
      "11/10/2026",
      "20/10/2026",
    ]);
  });
});

describe("CSV do contador: devoluções e estornos", () => {
  it("lista cada estorno, estorno externo e devolução realizados, com a descrição", () => {
    const linhas = linhasDe(
      entrada({
        extrato: [
          estorno({ valor: 30 }),
          estorno({
            origem: "estorno_externo",
            valor: 10.5,
            data: "2026-10-08",
            descricao: "Estorno fora do app",
          }),
          estorno({
            origem: "devolucao",
            valor: 22,
            data: "2026-10-09",
            descricao: "Devolução do pedido",
          }),
        ],
      }),
    );
    expect(linhas.slice(1)).toEqual([
      "Devolução ou estorno;06/10/2026;;;30,00;Estorno do pedido #ABC123",
      "Devolução ou estorno;08/10/2026;;;10,50;Estorno fora do app",
      "Devolução ou estorno;09/10/2026;;;22,00;Devolução do pedido",
    ]);
  });

  it("estorno previsto ou cancelado, e saída de outra origem, não entram", () => {
    const linhas = linhasDe(
      entrada({
        extrato: [
          venda(),
          estorno({ status: "previsto" }),
          estorno({ status: "cancelado" }),
          estorno({ origem: "manual" }),
          estorno({ origem: "sangria" }),
        ],
      }),
    );
    expect(linhas.slice(1)).toEqual(["Receita do dia;05/10/2026;;;100,00;"]);
  });
});

describe("CSV do contador: guias e pagos", () => {
  it("guia a pagar vira só uma linha de Guia, com competência (mês/ano) e vencimento", () => {
    const linhas = linhasDe(entrada({ guias: [guia()] }));
    expect(linhas.slice(1)).toEqual(["Guia;;10/2026;20/11/2026;75,50;"]);
  });

  it("guia paga vira Guia e também Pago, com a data do pagamento", () => {
    const linhas = linhasDe(
      entrada({
        guias: [guia({ status: "realizado", data_realizacao: "2026-11-18" })],
      }),
    );
    expect(linhas.slice(1)).toEqual([
      "Guia;;10/2026;20/11/2026;75,50;",
      "Pago;18/11/2026;10/2026;20/11/2026;75,50;",
    ]);
  });

  it("guia sem vencimento deixa a célula vazia; paga sem data de pagamento também", () => {
    const linhas = linhasDe(
      entrada({
        guias: [
          guia({
            status: "realizado",
            data_vencimento: null,
            data_realizacao: null,
          }),
        ],
      }),
    );
    expect(linhas.slice(1)).toEqual([
      "Guia;;10/2026;;75,50;",
      "Pago;;10/2026;;75,50;",
    ]);
  });

  it("guia cancelada, de status desconhecido, de data malformada ou de outra competência fica fora", () => {
    const linhas = linhasDe(
      entrada({
        guias: [
          guia({ valor: 1 }),
          guia({ valor: 2, status: "cancelado" }),
          guia({ valor: 3, status: "outro" }),
          guia({ valor: 4, data_competencia: "2026-13-45" }),
          guia({ valor: 5, data_competencia: "2026-09-01" }),
        ],
      }),
    );
    expect(linhas.slice(1)).toEqual(["Guia;;10/2026;20/11/2026;1,00;"]);
  });

  it("guias em ordem de competência e vencimento; pagos pela data do pagamento", () => {
    const linhas = linhasDe(
      entrada({
        modo: "anual",
        referencia: "2026",
        guias: [
          guia({
            data_competencia: "2026-03-01",
            data_vencimento: "2026-04-20",
            status: "realizado",
            data_realizacao: "2026-04-25",
          }),
          guia({
            data_competencia: "2026-01-01",
            data_vencimento: "2026-02-20",
            status: "realizado",
            data_realizacao: "2026-05-02",
          }),
        ],
      }),
    );
    expect(linhas.slice(1)).toEqual([
      "Guia;;01/2026;20/02/2026;75,50;",
      "Guia;;03/2026;20/04/2026;75,50;",
      "Pago;25/04/2026;03/2026;20/04/2026;75,50;",
      "Pago;02/05/2026;01/2026;20/02/2026;75,50;",
    ]);
  });

  it("a soma das guias do arquivo bate com a do caderno na tela (mesma regra)", () => {
    const lancamentos: LancamentoDoCsv[] = [
      guia({ valor: 10.1 }),
      guia({ valor: 20.2, status: "realizado", data_realizacao: "2026-11-02" }),
      guia({ valor: 99, status: "cancelado" }),
      guia({ valor: 7, data_competencia: "2026-09-01" }),
    ];
    const caderno = montarCaderno(
      lancamentos,
      { inicio: "2026-10-01", fim: "2026-10-31" },
      "2026-11-24",
    );
    const linhas = linhasDe(entrada({ guias: lancamentos }));
    const somaDoArquivo = linhas
      .slice(1)
      .filter((l) => l.startsWith("Guia;"))
      .reduce(
        (soma, l) =>
          soma + Math.round(Number(l.split(";")[4].replace(",", ".")) * 100),
        0,
      );
    expect(somaDoArquivo / 100).toBe(caderno[0].guia);
  });
});

describe("CSV do contador: mensal e anual", () => {
  const extrato = [
    venda({ data: "2026-01-15", valor: 1 }),
    venda({ data: "2026-10-01", valor: 2 }),
    venda({ data: "2026-10-31", valor: 3 }),
    venda({ data: "2026-11-01", valor: 4 }),
    venda({ data: "2027-01-01", valor: 5 }),
    estorno({ data: "2026-09-30", valor: 6 }),
    estorno({ data: "2026-10-15", valor: 7 }),
  ];

  it("mensal pega do dia 1 ao último dia do mês, e nada fora", () => {
    const linhas = linhasDe(entrada({ extrato }));
    expect(linhas.slice(1)).toEqual([
      "Receita do dia;01/10/2026;;;2,00;",
      "Receita do dia;31/10/2026;;;3,00;",
      "Devolução ou estorno;15/10/2026;;;7,00;Estorno do pedido #ABC123",
    ]);
  });

  it("mensal de fevereiro de ano bissexto termina no dia 29", () => {
    const linhas = linhasDe(
      entrada({
        referencia: "2028-02",
        extrato: [
          venda({ data: "2028-02-29", valor: 1 }),
          venda({ data: "2028-03-01", valor: 2 }),
        ],
      }),
    );
    expect(linhas.slice(1)).toEqual(["Receita do dia;29/02/2028;;;1,00;"]);
  });

  it("anual pega de 1º de janeiro a 31 de dezembro", () => {
    const linhas = linhasDe(
      entrada({ modo: "anual", referencia: "2026", extrato }),
    );
    expect(
      linhas.slice(1).map((l) => l.split(";").slice(0, 2).join(";")),
    ).toEqual([
      "Receita do dia;15/01/2026",
      "Receita do dia;01/10/2026",
      "Receita do dia;31/10/2026",
      "Receita do dia;01/11/2026",
      "Devolução ou estorno;30/09/2026",
      "Devolução ou estorno;15/10/2026",
    ]);
  });

  it("referência que não combina com o modo é erro de quem chamou, não CSV errado", () => {
    expect(() =>
      montarCsvDoContador(entrada({ modo: "mensal", referencia: "2026" })),
    ).toThrow();
    expect(() =>
      montarCsvDoContador(entrada({ modo: "anual", referencia: "2026-10" })),
    ).toThrow();
    expect(() =>
      montarCsvDoContador(entrada({ referencia: "2026-13" })),
    ).toThrow();
  });
});

describe("CSV do contador: texto que a lojista ou o cliente digitou", () => {
  // [o que foi digitado, como a célula sai no arquivo]
  const descricoes: readonly [string, string][] = [
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ["+55 11 90000-0000", "'+55 11 90000-0000"],
    ["-2+3", "'-2+3"],
    ["@SOMA(A1)", "'@SOMA(A1)"],
  ];

  for (const [digitado, esperado] of descricoes) {
    it(`descrição ${digitado} vira texto (apóstrofo na frente)`, () => {
      const linhas = linhasDe(
        entrada({ extrato: [estorno({ descricao: digitado })] }),
      );
      expect(linhas[1]).toBe(
        `Devolução ou estorno;06/10/2026;;;30,00;${esperado}`,
      );
    });
  }

  it("descrição com ponto e vírgula vai entre aspas e não vira coluna nova", () => {
    const linhas = linhasDe(
      entrada({ extrato: [estorno({ descricao: "troca; cliente pediu" })] }),
    );
    expect(linhas[1]).toBe(
      'Devolução ou estorno;06/10/2026;;;30,00;"troca; cliente pediu"',
    );
  });
});

describe("CSV do contador: período sem dado", () => {
  it("sem nenhuma linha devolve null, nunca um CSV só com cabeçalho", () => {
    expect(montarCsvDoContador(entrada())).toBeNull();
  });

  it("só dado fora do período, ou que não conta, também devolve null", () => {
    expect(
      montarCsvDoContador(
        entrada({
          extrato: [
            venda({ data: "2026-09-30" }),
            venda({ status: "previsto" }),
            estorno({ status: "cancelado" }),
            venda({ origem: "manual" }),
          ],
          guias: [
            guia({ status: "cancelado" }),
            guia({ data_competencia: "2026-09-01" }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("valor que não é número é ignorado em vez de virar NaN no arquivo", () => {
    expect(
      montarCsvDoContador(
        entrada({
          extrato: [
            venda({ valor: Number.NaN }),
            estorno({ valor: Number.POSITIVE_INFINITY }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("uma guia sozinha já basta para ter arquivo (a loja pode não ter vendido)", () => {
    expect(montarCsvDoContador(entrada({ guias: [guia()] }))).not.toBeNull();
  });
});

describe("CSV do contador: nome do arquivo", () => {
  it("mensal leva o mês e o carimbo LOCAL (São Paulo), não o UTC", () => {
    const csv = montarCsvDoContador(
      entrada({
        extrato: [venda()],
        agora: new Date("2026-11-25T01:30:00Z"),
      }),
    );
    // 01:30 UTC de 25/11 ainda é 22:30 de 24/11 em São Paulo.
    expect(csv?.nomeDoArquivo).toBe(
      "impostos-mensal-2026-10-2026-11-24-22-30.csv",
    );
  });

  it("anual leva só o ano", () => {
    const csv = montarCsvDoContador(
      entrada({
        modo: "anual",
        referencia: "2026",
        extrato: [venda()],
        agora: new Date("2026-11-24T20:49:00Z"),
      }),
    );
    expect(csv?.nomeDoArquivo).toBe("impostos-anual-2026-2026-11-24-17-49.csv");
  });
});

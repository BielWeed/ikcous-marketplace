// Gestão Fiscal, caça por mutação: o pré-preenchimento da guia do mês na virada do ano e
// nos fins de semana.
//
// ISTO É DINHEIRO: o que sai de `guiaDoMes` vira o formulário "Novo lançamento". A regra
// que manda é "o valor de uma guia nunca é o valor calculado pelo app": só o MEI com ano
// conferido recebe o valor fixo do DAS-MEI; todo o resto sai com o campo VAZIO.
//
// O que cada teste protege (em português simples):
//   - guia de dezembro/2026 vence em janeiro de 2027 (o ano do vencimento é outro, o da
//     competência continua 2026) e o valor do MEI vem do ano das VENDAS;
//   - se quem chamou passar o ano do vencimento no lugar do ano das vendas, o valor
//     fica vazio (a lojista digita), nunca o valor de outro ano;
//   - o vencimento que cai no sábado ou no domingo vai para a segunda-feira;
//   - Simples, Presumido, Real, "não sei" e loja sem cadastro NUNCA recebem valor;
//   - competência torta não abre formulário (null).
//
// DIAS DA SEMANA (calculados à mão a partir de que 1º/01/2026 é uma quinta-feira):
//   20/12/2026 = domingo | 20/06/2026 = sábado | 20/02/2027 = sábado | 20/01/2027 = quarta.
//
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import { guiaDoMes } from "@/lib/fiscal/guia-do-mes";

const ID_DA_CATEGORIA_DE_IMPOSTOS = "f2000000-0000-4000-8000-000000000011";

const MEI_COMERCIO = { regime: "mei", atividade: "comercio" } as const;
const MEI_COM_SERVICO = { regime: "mei", atividade: "com_servico" } as const;

describe("guiaDoMes: dezembro vence em janeiro do ano seguinte", () => {
  it("MEI comércio, competência 2026-12, ano 2026: vence 20/01/2027 (quarta) e leva o DAS-MEI de 2026", () => {
    expect(guiaDoMes(MEI_COMERCIO, "2026-12", 2026)).toEqual({
      tipo: "saida",
      situacao: "previsto",
      categoriaId: ID_DA_CATEGORIA_DE_IMPOSTOS,
      dataCompetencia: "2026-12-01",
      dataVencimento: "2027-01-20",
      descricao: "DAS 12/2026",
      valor: "82.05",
    });
  });

  it("MEI com serviço, competência 2026-12, ano 2026: valor de comércio e serviço", () => {
    expect(guiaDoMes(MEI_COM_SERVICO, "2026-12", 2026)?.valor).toBe("87.05");
  });

  it("MEI com o ano do VENCIMENTO (2027) no lugar do ano das vendas: valor vazio, o resto igual", () => {
    expect(guiaDoMes(MEI_COMERCIO, "2026-12", 2027)).toEqual({
      tipo: "saida",
      situacao: "previsto",
      categoriaId: ID_DA_CATEGORIA_DE_IMPOSTOS,
      dataCompetencia: "2026-12-01",
      dataVencimento: "2027-01-20",
      descricao: "DAS 12/2026",
      valor: "",
    });
  });

  it("MEI em janeiro de 2027: o ano de 2027 não está conferido, valor vazio", () => {
    expect(guiaDoMes(MEI_COMERCIO, "2027-01", 2027)?.valor).toBe("");
  });

  it("MEI em dezembro de 2025: o ano de 2025 não está conferido, valor vazio (nunca o de 2026 emprestado)", () => {
    const guia = guiaDoMes(MEI_COMERCIO, "2025-12", 2025);
    expect(guia?.valor).toBe("");
    expect(guia?.dataVencimento).toBe("2026-01-20");
  });
});

describe("guiaDoMes: vencimento em fim de semana vai para a segunda-feira", () => {
  it.each([
    ["2026-11", "2026-12-21"], // 20/12/2026 é domingo
    ["2026-05", "2026-06-22"], // 20/06/2026 é sábado
    ["2027-01", "2027-02-22"], // 20/02/2027 é sábado
    ["2026-10", "2026-11-20"], // 20/11/2026 é sexta: fica
    ["2026-12", "2027-01-20"], // 20/01/2027 é quarta: fica
  ])("competência %s vence em %s", (competencia, vencimento) => {
    const ano = Number(competencia.slice(0, 4));
    expect(guiaDoMes(MEI_COMERCIO, competencia, ano)?.dataVencimento).toBe(
      vencimento,
    );
  });

  it("o mês e o ano da descrição e da competência seguem a competência, não o vencimento", () => {
    const guia = guiaDoMes(MEI_COMERCIO, "2026-11", 2026);
    expect(guia?.descricao).toBe("DAS 11/2026");
    expect(guia?.dataCompetencia).toBe("2026-11-01");
    expect(guia?.dataVencimento).toBe("2026-12-21");
  });
});

describe("guiaDoMes: só o MEI com ano conferido recebe valor", () => {
  const SEM_VALOR = [
    ["Simples só comércio", { regime: "simples", atividade: "comercio" }],
    ["Simples com serviço", { regime: "simples", atividade: "com_servico" }],
    ["Lucro presumido", { regime: "presumido", atividade: "comercio" }],
    ["Lucro real", { regime: "real", atividade: "com_servico" }],
    ["não sei o regime", { regime: "nao_sei", atividade: "comercio" }],
  ] as const;

  for (const [nome, cadastro] of SEM_VALOR) {
    it(`${nome}: o campo do valor sai vazio, em qualquer mês do ano conferido`, () => {
      for (const competencia of ["2026-01", "2026-06", "2026-12"]) {
        expect(guiaDoMes(cadastro, competencia, 2026)?.valor).toBe("");
      }
    });
  }

  it("loja sem cadastro (null): formulário com data e descrição, mas valor vazio", () => {
    expect(guiaDoMes(null, "2026-12", 2026)).toEqual({
      tipo: "saida",
      situacao: "previsto",
      categoriaId: ID_DA_CATEGORIA_DE_IMPOSTOS,
      dataCompetencia: "2026-12-01",
      dataVencimento: "2027-01-20",
      descricao: "DAS 12/2026",
      valor: "",
    });
  });
});

describe("guiaDoMes: competência torta não abre formulário", () => {
  it.each([
    ["2026-13"],
    ["2026-00"],
    ["2026-1"],
    ["202612"],
    ["2026-12-01"],
    ["26-12"],
    [""],
    [" 2026-12"],
  ])("%j devolve null", (competencia) => {
    expect(guiaDoMes(MEI_COMERCIO, competencia, 2026)).toBeNull();
    expect(guiaDoMes(null, competencia, 2026)).toBeNull();
  });
});

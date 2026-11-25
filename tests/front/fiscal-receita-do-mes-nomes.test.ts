// Gestão Fiscal, caça por mutação: o imposto do mês quando o NOME da categoria vem com
// espaço sobrando, e a receita/devolução em mês zerado.
//
// O que cada teste protege (em português simples):
//   - o nome da categoria de impostos chega da DRE com espaços antes ou depois (a lojista
//     digitou assim, ou o banco guardou assim): o imposto do mês é somado do mesmo jeito,
//     e não vira "R$ 0" nem "não sei";
//   - mês sem venda mas com estorno: a devolução aparece (a linha derivada é a primeira);
//   - devolução e imposto são somados em centavos, e crédito (negativo) abate.
//
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import { receitaDoMes } from "@/lib/fiscal/receita-do-mes";
import type { DreFinanceira, LinhaDaDre } from "@/types/financeiro";

const NOME = "Impostos sobre vendas (DAS/Simples)";
const IMPOSTOS = { nome: NOME, grupoDre: "deducao" } as const;

function dre(trocas: Partial<DreFinanceira> = {}): DreFinanceira {
  return {
    receitaBruta: 0,
    receitaOnline: 0,
    receitaBalcao: 0,
    deducoes: 0,
    receitaLiquida: 0,
    cmv: 0,
    cmvEstimado: false,
    lucroBruto: 0,
    custosVariaveis: 0,
    margemContribuicao: 0,
    despesasFixas: 0,
    resultadoOperacional: 0,
    resultadoFinanceiro: 0,
    lucroLiquido: 0,
    linhas: [],
    ...trocas,
  };
}

const linha = (
  grupo: LinhaDaDre["grupo"],
  categoria: string,
  valor: number,
): LinhaDaDre => ({ grupo, categoria, valor });

describe("receitaDoMes: nome da categoria de impostos com espaço sobrando", () => {
  it("a linha da DRE com espaços em volta do nome ainda é a categoria de impostos", () => {
    const r = receitaDoMes(
      dre({
        receitaBalcao: 1000,
        linhas: [
          linha("receita", "Vendas na loja física", 1000),
          linha("deducao", `  ${NOME}  `, 150),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.imposto).toBe(150);
  });

  it("o nome da categoria com espaços em volta também casa com a linha limpa da DRE", () => {
    const r = receitaDoMes(
      dre({
        receitaBalcao: 1000,
        linhas: [linha("deducao", NOME, 150)],
      }),
      { nome: `\t${NOME} `, grupoDre: "deducao" },
    );
    expect(r.imposto).toBe(150);
  });

  it("duas linhas, uma limpa e uma com espaços, somam as duas (em centavos)", () => {
    const r = receitaDoMes(
      dre({
        linhas: [
          linha("deducao", NOME, 0.1),
          linha("deducao", ` ${NOME}`, 0.2),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.imposto).toBe(0.3);
  });

  it("crédito (linha negativa) abate o imposto do mês", () => {
    const r = receitaDoMes(
      dre({
        linhas: [linha("deducao", NOME, 100), linha("deducao", NOME, -20)],
      }),
      IMPOSTOS,
    );
    expect(r.imposto).toBe(80);
  });

  it("nome parecido, mas diferente (outra categoria), não entra", () => {
    const r = receitaDoMes(
      dre({
        linhas: [
          linha("deducao", `${NOME} (antigo)`, 999),
          linha("deducao", NOME, 100),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.imposto).toBe(100);
  });

  it("sem linha da categoria no mês, o imposto é R$ 0 (a categoria existe e está na DRE), não null", () => {
    const r = receitaDoMes(
      dre({ receitaBalcao: 500, linhas: [linha("receita", "Vendas", 500)] }),
      IMPOSTOS,
    );
    expect(r.imposto).toBe(0);
  });
});

describe("receitaDoMes: mês sem venda", () => {
  it("só estorno no mês: a devolução é a primeira linha e a receita é zero", () => {
    const r = receitaDoMes(
      dre({
        linhas: [linha("deducao", "Estornos e devoluções", 120.5)],
      }),
      IMPOSTOS,
    );
    expect(r).toEqual({ receita: 0, devolucoes: 120.5, imposto: 0 });
  });

  it("estorno e imposto no mesmo mês, sem venda: cada um no seu número", () => {
    const r = receitaDoMes(
      dre({
        linhas: [
          linha("deducao", "Estornos e devoluções", 40),
          linha("deducao", NOME, 25),
        ],
      }),
      IMPOSTOS,
    );
    expect(r).toEqual({ receita: 0, devolucoes: 40, imposto: 25 });
  });

  it("receita de R$ 0,10 + R$ 0,20 e devolução de R$ 0,07 saem exatas, em centavos", () => {
    const r = receitaDoMes(
      dre({
        receitaOnline: 0.1,
        receitaBalcao: 0.2,
        linhas: [
          linha("receita", "Vendas pelo app", 0.1),
          linha("receita", "Vendas na loja física", 0.2),
          linha("deducao", "Estornos e devoluções", 0.07),
        ],
      }),
      IMPOSTOS,
    );
    expect(r).toEqual({ receita: 0.3, devolucoes: 0.07, imposto: 0 });
  });
});

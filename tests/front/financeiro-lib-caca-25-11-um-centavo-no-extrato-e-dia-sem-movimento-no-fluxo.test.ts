// Caça por mutação em `src/lib/financeiro.ts` (25/11/2026), números que a
// lojista lê como dinheiro. Defeitos de uma linha que nenhum teste derrubava:
//   1. o extrato por dia separa entrada de saída pelo CENTAVO: uma entrada de
//      R$ 0,01 é entrada (o defeito jogava o 1 centavo para o lado das saídas);
//   2. o fluxo de caixa devolve ZERO nos dias sem nenhum movimento (o defeito
//      devolvia 1 real de entrada e de saída num dia vazio);
//   3. "Venceu há 2 dias" é escrito como tal (o defeito pulava o dia -2);
//   4. na lista de contas a pagar, quem não tem data vai para o fim mesmo
//      quando é o primeiro da lista;
//   5. só o "Lucro líquido" fecha a cascata da DRE (`final`), e as linhas de
//      subtotal e de grupo são as certas;
//   6. a diferença de R$ 0,01 no fechamento do caixa já é sobra (ou quebra).
// Só valores e nomes inventados.
import {
  agruparExtratoPorDia,
  cascataDaDre,
  diferencaDoFechamento,
  ordenarPorVencimento,
  serieDoFluxoDeCaixa,
  textoDoVencimento,
} from "@/lib/financeiro";
import type { DreFinanceira, LinhaDoExtrato } from "@/types/financeiro";
import { describe, expect, it } from "vitest";

function linha(
  parcial: Partial<LinhaDoExtrato> & Pick<LinhaDoExtrato, "id">,
): LinhaDoExtrato {
  return {
    origem: "manual",
    tipo: "entrada",
    status: "realizado",
    valor: 0,
    data: "2026-09-10",
    contaId: "conta-a",
    contaNome: "Conta A",
    contaDestinoId: null,
    contaDestinoNome: null,
    categoriaId: null,
    categoriaNome: null,
    descricao: "lançamento de prova",
    formaPagamento: null,
    pedidoId: null,
    vencimento: null,
    editavel: false,
    ...parcial,
  };
}

describe("extrato por dia — o centavo vai para o lado certo", () => {
  it("uma entrada de R$ 0,01: entradas 0,01, saídas 0, resultado 0,01", () => {
    const [dia] = agruparExtratoPorDia([
      linha({ id: "um-centavo", tipo: "entrada", valor: 0.01 }),
    ]);
    expect(dia.entradas).toBe(0.01);
    expect(dia.saidas).toBe(0);
    expect(dia.resultado).toBe(0.01);
  });

  it("uma saída de R$ 0,01: saídas 0,01, entradas 0, resultado -0,01", () => {
    const [dia] = agruparExtratoPorDia([
      linha({ id: "um-centavo-saiu", tipo: "saida", valor: 0.01 }),
    ]);
    expect(dia.entradas).toBe(0);
    expect(dia.saidas).toBe(0.01);
    expect(dia.resultado).toBe(-0.01);
  });

  it("R$ 0,01 de entrada junto com R$ 0,02 de saída no mesmo dia: resultado -0,01", () => {
    const [dia] = agruparExtratoPorDia([
      linha({ id: "a", tipo: "entrada", valor: 0.01 }),
      linha({ id: "b", tipo: "saida", valor: 0.02 }),
    ]);
    expect(dia.entradas).toBe(0.01);
    expect(dia.saidas).toBe(0.02);
    expect(dia.resultado).toBe(-0.01);
  });
});

describe("fluxo de caixa — dia sem nenhum movimento vale zero", () => {
  it("só o dia 2 tem movimento: os dias 1 e 3 saem com entradas, saídas e resultado em zero", () => {
    const pontos = serieDoFluxoDeCaixa(
      [{ dia: "2026-11-02", entradas: 100, saidas: 40 }],
      { inicio: "2026-11-01", fim: "2026-11-03" },
      500,
    );
    expect(pontos.map((p) => p.dia)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(pontos[0]).toMatchObject({ entradas: 0, saidas: 0, resultado: 0 });
    expect(pontos[1]).toMatchObject({
      entradas: 100,
      saidas: 40,
      resultado: 60,
    });
    expect(pontos[2]).toMatchObject({ entradas: 0, saidas: 0, resultado: 0 });
  });

  it("o saldo de cada dia é reconstruído de trás para frente a partir do saldo de hoje", () => {
    const pontos = serieDoFluxoDeCaixa(
      [{ dia: "2026-11-02", entradas: 100, saidas: 40 }],
      { inicio: "2026-11-01", fim: "2026-11-03" },
      500,
    );
    // Hoje (dia 3) fecha em 500; o dia 3 não mexeu; o dia 2 somou 60.
    expect(pontos.map((p) => p.saldo)).toEqual([440, 500, 500]);
  });
});

describe("contas a pagar — o texto do vencimento", () => {
  it("2 dias atrás: 'Venceu há 2 dias'; 1 dia: 'Venceu ontem'; 3 dias: 'Venceu há 3 dias'", () => {
    const hoje = "2026-11-25";
    expect(textoDoVencimento("2026-11-23", hoje)).toBe("Venceu há 2 dias");
    expect(textoDoVencimento("2026-11-24", hoje)).toBe("Venceu ontem");
    expect(textoDoVencimento("2026-11-22", hoje)).toBe("Venceu há 3 dias");
  });
});

describe("contas a pagar — a ordem da lista", () => {
  const conta = (id: string, vencimento: string | null) => ({ id, vencimento });

  it("sem data vai para o fim mesmo sendo o primeiro da lista", () => {
    const ordenada = ordenarPorVencimento([
      conta("sem-data", null),
      conta("tarde", "2026-12-10"),
      conta("cedo", "2026-11-01"),
    ]);
    expect(ordenada.map((c) => c.id)).toEqual(["cedo", "tarde", "sem-data"]);
  });

  it("duas sem data no começo: as duas vão para o fim, na ordem em que vieram", () => {
    const ordenada = ordenarPorVencimento([
      conta("sem-1", null),
      conta("sem-2", null),
      conta("com-data", "2026-11-01"),
    ]);
    expect(ordenada.map((c) => c.id)).toEqual(["com-data", "sem-1", "sem-2"]);
  });

  it("mesma data: mantém a ordem em que vieram", () => {
    const ordenada = ordenarPorVencimento([
      conta("a", "2026-11-10"),
      conta("b", "2026-11-10"),
      conta("c", "2026-11-10"),
      conta("antes", "2026-11-01"),
    ]);
    expect(ordenada.map((c) => c.id)).toEqual(["antes", "a", "b", "c"]);
  });
});

describe("DRE — a cascata marca só o lucro líquido como final", () => {
  const dre: DreFinanceira = {
    receitaBruta: 1000,
    receitaOnline: 600,
    receitaBalcao: 400,
    deducoes: 50,
    receitaLiquida: 950,
    cmv: 300,
    cmvEstimado: false,
    lucroBruto: 650,
    custosVariaveis: 100,
    margemContribuicao: 550,
    despesasFixas: 200,
    resultadoOperacional: 350,
    resultadoFinanceiro: -20,
    lucroLiquido: 330,
    linhas: [],
  };

  it("11 linhas, na ordem da tela, e só a última é `final`", () => {
    const cascata = cascataDaDre(dre);
    expect(cascata.map((l) => l.chave)).toEqual([
      "receita_bruta",
      "deducoes",
      "receita_liquida",
      "cmv",
      "lucro_bruto",
      "custos_variaveis",
      "margem_contribuicao",
      "despesas_fixas",
      "resultado_operacional",
      "resultado_financeiro",
      "lucro_liquido",
    ]);
    expect(cascata.filter((l) => l.final).map((l) => l.chave)).toEqual([
      "lucro_liquido",
    ]);
  });

  it("os subtotais são os cinco '(=)', e cada linha de custo abre o seu grupo", () => {
    const cascata = cascataDaDre(dre);
    expect(cascata.filter((l) => l.subtotal).map((l) => l.chave)).toEqual([
      "receita_liquida",
      "lucro_bruto",
      "margem_contribuicao",
      "resultado_operacional",
      "lucro_liquido",
    ]);
    expect(Object.fromEntries(cascata.map((l) => [l.chave, l.grupo]))).toEqual({
      receita_bruta: "receita",
      deducoes: "deducao",
      receita_liquida: null,
      cmv: null,
      lucro_bruto: null,
      custos_variaveis: "custo_variavel",
      margem_contribuicao: null,
      despesas_fixas: "despesa_fixa",
      resultado_operacional: null,
      resultado_financeiro: "financeiro",
      lucro_liquido: null,
    });
  });

  it("custos aparecem negativos e o resto com o valor da DRE", () => {
    const valores = Object.fromEntries(
      cascataDaDre(dre).map((l) => [l.chave, l.valor]),
    );
    expect(valores).toMatchObject({
      receita_bruta: 1000,
      deducoes: -50,
      cmv: -300,
      custos_variaveis: -100,
      despesas_fixas: -200,
      resultado_financeiro: -20,
      lucro_liquido: 330,
    });
  });
});

describe("fechamento do caixa — a diferença de R$ 0,01 já conta", () => {
  it("R$ 0,01 a mais na gaveta é sobra", () => {
    expect(diferencaDoFechamento(100, 100.01)).toEqual({
      diferenca: 0.01,
      situacao: "sobra",
    });
  });

  it("R$ 0,01 a menos na gaveta é quebra", () => {
    expect(diferencaDoFechamento(100, 99.99)).toEqual({
      diferenca: -0.01,
      situacao: "quebra",
    });
  });

  it("valor igual bate, mesmo com centavos de ponto flutuante (0,1 + 0,2 contra 0,3)", () => {
    expect(diferencaDoFechamento(0.1 + 0.2, 0.3)).toEqual({
      diferenca: 0,
      situacao: "bateu",
    });
  });
});

// @vitest-environment jsdom
// "Loja que ainda não vendeu" (`lojaSemVendasAinda`, lista "Para fazer" do
// Início). O teste de tela cobre os casos em que o mês anterior vale 0; o
// servidor, porém, manda `receitaMesAnterior: null` quando não sabe o valor, e
// esse "não sei" NÃO pode virar "a loja já vendeu": uma loja nova ficaria sem a
// orientação de primeira venda por causa de um campo ausente. Aqui ficam o
// null, o centavo de fronteira e o que é "desconhecido" no painel.
import { lojaSemVendasAinda } from "@/components/admin/inicio/ParaFazer";
import type { PainelInicio } from "@/types/painel";
import { describe, expect, it } from "vitest";

function painel(parcial: Record<string, unknown> = {}): PainelInicio {
  return {
    hoje: {
      receita: 0,
      online: 0,
      presencial: 0,
      pedidos: 0,
      receitaSemanaPassada: 0,
    },
    mes: {
      receita: 0,
      receitaMesAnterior: 0,
      pedidos: 0,
      ticketMedio: 0,
      lucroEstimado: 0,
    },
    saldoTotal: 0,
    aReceber7d: 0,
    aPagar7d: 0,
    contasVencidas: 0,
    pendencias: {
      pedidosParaPreparar: 0,
      devolucoesAbertas: 0,
      caixaAberto: false,
      estoqueBaixo: 0,
    },
    serie14d: [
      { dia: "2026-11-23", receita: 0 },
      { dia: "2026-11-24", receita: 0 },
    ],
    ...parcial,
  } as unknown as PainelInicio;
}

const comMes = (mes: Record<string, unknown>) =>
  painel({
    mes: {
      receita: 0,
      receitaMesAnterior: 0,
      pedidos: 0,
      ticketMedio: 0,
      lucroEstimado: 0,
      ...mes,
    },
  });

describe("lojaSemVendasAinda — mês anterior desconhecido", () => {
  it("mês anterior null (o servidor não soube dizer) NÃO conta como venda", () => {
    expect(lojaSemVendasAinda(comMes({ receitaMesAnterior: null }))).toBe(true);
  });

  it("mês anterior ausente (servidor antigo) também não conta como venda", () => {
    expect(lojaSemVendasAinda(comMes({ receitaMesAnterior: undefined }))).toBe(
      true,
    );
  });

  it("mês anterior com 1 centavo de receita já é loja que vendeu; zero não", () => {
    expect(lojaSemVendasAinda(comMes({ receitaMesAnterior: 0.01 }))).toBe(
      false,
    );
    expect(lojaSemVendasAinda(comMes({ receitaMesAnterior: 0 }))).toBe(true);
  });
});

describe("lojaSemVendasAinda — a série dos 14 dias", () => {
  it("série ausente não impede 'sem vendas'", () => {
    expect(lojaSemVendasAinda(painel({ serie14d: undefined }))).toBe(true);
  });

  it("qualquer ponto com receita, em qualquer posição, já é loja que vendeu", () => {
    const zero = (dia: string) => ({ dia, receita: 0 });
    for (const serie14d of [
      [{ dia: "2026-11-10", receita: 0.01 }, zero("2026-11-11")],
      [zero("2026-11-10"), { dia: "2026-11-11", receita: 5 }],
    ]) {
      expect(lojaSemVendasAinda(painel({ serie14d }))).toBe(false);
    }
  });

  it("série só de zeros (vários dias) continua 'sem vendas'", () => {
    expect(lojaSemVendasAinda(painel())).toBe(true);
  });
});

describe("lojaSemVendasAinda — o que é desconhecido nunca é zero", () => {
  it("sem painel, sem bloco do mês ou sem bloco de hoje: não é 'loja sem vendas'", () => {
    expect(lojaSemVendasAinda(null)).toBe(false);
    expect(lojaSemVendasAinda(painel({ mes: undefined }))).toBe(false);
    expect(lojaSemVendasAinda(painel({ hoje: undefined }))).toBe(false);
  });

  it("um pedido hoje, ou no mês, basta para a loja ter vendido", () => {
    expect(lojaSemVendasAinda(comMes({ pedidos: 1 }))).toBe(false);
    expect(
      lojaSemVendasAinda(
        painel({
          hoje: {
            receita: 0,
            online: 0,
            presencial: 0,
            pedidos: 1,
            receitaSemanaPassada: 0,
          },
        }),
      ),
    ).toBe(false);
  });
});

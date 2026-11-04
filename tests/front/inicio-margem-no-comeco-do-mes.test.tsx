// @vitest-environment jsdom
//
// "Margem estimada" do Início no começo do mês: o lucro estimado já desconta as
// despesas do mês INTEIRO (aluguel e salário previstos), mas a receita só conta
// até hoje. No dia 2, R$ 200 de vendas contra R$ -2.800 de lucro dava
// "Margem estimada -1.400%" — o lojista lia prejuízo onde só era começo de mês.
// Prova, montando o cartão do mês com o relógio fixado em cada dia:
//   - começo do mês com lucro negativo: "em formação", sem percentual;
//   - o lucro estimado continua aparecendo como número separado;
//   - mês normal (lucro positivo em qualquer dia, ou segunda metade do mês):
//     a margem aparece como sempre.
import { NumerosDoMes } from "@/components/admin/inicio/NumerosDoMes";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function painelDoMes(receita: number, lucroEstimado: number): PainelInicio {
  return {
    hoje: {
      receita: 0,
      online: 0,
      presencial: 0,
      pedidos: 0,
      receitaSemanaPassada: 0,
    },
    mes: {
      receita,
      receitaMesAnterior: 16643,
      pedidos: 3,
      ticketMedio: 66.67,
      lucroEstimado,
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
    serie14d: [],
  };
}

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  // Só o relógio: os temporizadores do hook do dia seguem reais.
  vi.useFakeTimers({ toFake: ["Date"] });
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  vi.useRealTimers();
});

const texto = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\u00a0/g, " ");

function montarNoDia(diaIso: string, painel: PainelInicio) {
  vi.setSystemTime(new Date(`${diaIso}T15:00:00Z`));
  act(() => raiz.render(<NumerosDoMes painel={painel} carregando={false} />));
}

describe("Início: margem estimada no começo do mês", () => {
  it("dia 2, receita baixa e despesas previstas altas: 'em formação', sem percentual absurdo", () => {
    montarNoDia("2026-11-02", painelDoMes(200, -2800));
    const corpo = texto(tela);
    expect(corpo).toContain("Margem estimada em formação");
    expect(corpo).not.toContain("-1.400");
    expect(corpo).not.toMatch(/Margem estimada\s*[-−]?\d/);
  });

  it("o lucro estimado do mês inteiro continua aparecendo como número separado", () => {
    montarNoDia("2026-11-02", painelDoMes(200, -2800));
    expect(texto(tela)).toContain("Lucro estimado");
    expect(texto(tela)).toMatch(/-R\$\s?2\.800,00|R\$\s?-2\.800,00/);
  });

  it("dia 15 ainda é começo: lucro negativo segue 'em formação'", () => {
    montarNoDia("2026-11-15", painelDoMes(1000, -500));
    expect(texto(tela)).toContain("Margem estimada em formação");
  });

  it("segunda metade do mês (dia 16): a margem negativa aparece, com o número real", () => {
    montarNoDia("2026-11-16", painelDoMes(1000, -500));
    expect(texto(tela)).toContain("Margem estimada -50%");
    expect(texto(tela)).not.toContain("em formação");
  });

  it("lucro positivo no começo do mês não é 'em formação': mostra a margem", () => {
    montarNoDia("2026-11-02", painelDoMes(18640, 4210));
    expect(texto(tela)).toContain("Margem estimada 23%");
    expect(texto(tela)).not.toContain("em formação");
  });

  it("mês normal (dia 20, lucro positivo): continua 'Margem estimada 23%'", () => {
    montarNoDia("2026-11-20", painelDoMes(18640, 4210));
    expect(texto(tela)).toContain("Margem estimada 23%");
  });

  it("sem receita no mês: sem margem e sem 'em formação' (como antes)", () => {
    montarNoDia("2026-11-02", painelDoMes(0, -2800));
    expect(texto(tela)).not.toContain("Margem estimada");
  });
});

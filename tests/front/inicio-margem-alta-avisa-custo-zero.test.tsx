// @vitest-environment jsdom
//
// "Margem estimada 100%" no Início com produto vendido sem custo cadastrado:
// o lucro conta R$ 0 de custo e a margem sai cheia. O Financeiro avisa ("custo
// estimado" + "Cadastrar custo dos produtos"), mas o Início não recebe esse
// sinal do `painel_inicio`. Saída: com a margem estimada em 95% ou mais, a
// frase "Sem custo cadastrado, usa R$ 0 de custo" aparece junto da margem,
// FORA do "Como é calculado o lucro" (que fica fechado).
import { NumerosDoMes } from "@/components/admin/inicio/NumerosDoMes";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVISO = "Sem custo cadastrado, usa R$ 0 de custo";

function painelDoMes(
  receita: number,
  lucroEstimado: number,
  receitaLiquida?: number,
): PainelInicio {
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
      receitaMesAnterior: 0,
      pedidos: 2,
      ticketMedio: receita / 2,
      lucroEstimado,
      receitaLiquida,
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
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

function montar(painel: PainelInicio) {
  act(() => raiz.render(<NumerosDoMes painel={painel} carregando={false} />));
}

/** O "Como é calculado o lucro" continua fechado: o aviso não pode depender dele. */
function explicacaoFechada() {
  const botao = Array.from(tela.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Como é calculado"),
  );
  return botao?.getAttribute("aria-expanded") === "false";
}

describe("Início: margem estimada alta avisa que custo ausente vale R$ 0", () => {
  it("margem 100% (vendeu produto sem custo): o aviso aparece junto da margem", () => {
    montar(painelDoMes(500, 500));
    expect(explicacaoFechada()).toBe(true);
    const lucro = tela.querySelector(".inicio-mes-lucro");
    expect(texto(lucro)).toContain("Margem estimada 100%");
    expect(texto(lucro)).toContain(AVISO);
  });

  it("margem pela receita líquida do Financeiro em 95%: o aviso aparece", () => {
    montar(painelDoMes(1200, 950, 1000));
    expect(explicacaoFechada()).toBe(true);
    expect(texto(tela)).toContain("Margem estimada 95%");
    expect(texto(tela)).toContain(AVISO);
  });

  it("94,6% aparece como 95% na tela: o aviso segue o número que a lojista lê", () => {
    montar(painelDoMes(1000, 946));
    expect(texto(tela)).toContain("Margem estimada 95%");
    expect(texto(tela)).toContain(AVISO);
  });

  it("controle: margem normal (23%) não mostra o aviso", () => {
    montar(painelDoMes(18640, 4210));
    expect(texto(tela)).toContain("Margem estimada 23%");
    expect(texto(tela)).not.toContain(AVISO);
  });

  it("controle: margem logo abaixo do limite (94%) não mostra o aviso", () => {
    montar(painelDoMes(1000, 940));
    expect(texto(tela)).toContain("Margem estimada 94%");
    expect(texto(tela)).not.toContain(AVISO);
  });

  it("controle: sem margem (sem receita) não mostra o aviso", () => {
    montar(painelDoMes(0, 0));
    expect(texto(tela)).not.toContain("Margem estimada");
    expect(texto(tela)).not.toContain(AVISO);
  });
});

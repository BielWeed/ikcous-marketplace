// @vitest-environment jsdom
//
// "Dinheiro nas contas" do Início: a linha "A pagar" avisa quantas contas já
// venceram. Valores escritos à mão. O que se trava aqui:
//   - 1 conta vencida fala no singular ("1 vencida"), nunca "1 vencidas";
//   - 2 ou mais falam no plural;
//   - zero e "não sei" (null) NÃO inventam o aviso: "0 vencidas" ou
//     "— vencidas" na linha seria alarme sem conta nenhuma atrasada.
import { DinheiroNasContas } from "@/components/admin/inicio/DinheiroNasContas";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function painelCom(contasVencidas: number | null): PainelInicio {
  return {
    hoje: {
      receita: 100,
      online: 60,
      presencial: 40,
      pedidos: 2,
      receitaSemanaPassada: 50,
    },
    mes: {
      receita: 1000,
      receitaMesAnterior: 900,
      pedidos: 10,
      ticketMedio: 100,
      lucroEstimado: 300,
    },
    saldoTotal: 500,
    aReceber7d: 200,
    aPagar7d: 150,
    contasVencidas,
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
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});

afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
});

function rotuloDaLinhaAPagar(contasVencidas: number | null): string {
  act(() => {
    raiz.render(
      <DinheiroNasContas
        painel={painelCom(contasVencidas)}
        carregando={false}
        onNavigate={vi.fn()}
      />,
    );
  });
  const linha = Array.from(tela.querySelectorAll("button")).find((botao) =>
    (botao.getAttribute("aria-label") ?? "").startsWith("A pagar"),
  );
  expect(linha).toBeTruthy();
  // A moeda usa espaço sem quebra (NBSP): normaliza para comparar com texto simples.
  return (linha?.getAttribute("aria-label") ?? "").replace(/\s/g, " ");
}

describe("Dinheiro nas contas: o aviso de contas vencidas em A pagar", () => {
  it("1 conta vencida: singular, e o texto visível acompanha", () => {
    const rotulo = rotuloDaLinhaAPagar(1);
    expect(rotulo).toMatch(/, 1 vencida\. Abrir Financeiro$/);
    expect(rotulo).not.toContain("1 vencidas");
    const linhas = Array.from(tela.querySelectorAll("span")).map(
      (s) => s.textContent,
    );
    expect(linhas).toContain("1 vencida");
    expect(linhas).not.toContain("1 vencidas");
  });

  it("2 contas vencidas: plural", () => {
    const rotulo = rotuloDaLinhaAPagar(2);
    expect(rotulo).toMatch(/, 2 vencidas\. Abrir Financeiro$/);
  });

  it("zero conta vencida: a linha não traz o aviso", () => {
    const rotulo = rotuloDaLinhaAPagar(0);
    expect(rotulo).toBe(
      "A pagar — R$ 150,00. Vencidas + próximos 7 dias. Abrir Financeiro",
    );
    const textos = Array.from(tela.querySelectorAll("span")).map(
      (s) => s.textContent,
    );
    expect(textos.some((t) => /vencidas?$/.test(t ?? "") && t !== "")).toBe(
      false,
    );
  });

  it("contagem desconhecida (null): também não inventa o aviso", () => {
    const rotulo = rotuloDaLinhaAPagar(null);
    expect(rotulo).toBe(
      "A pagar — R$ 150,00. Vencidas + próximos 7 dias. Abrir Financeiro",
    );
  });
});

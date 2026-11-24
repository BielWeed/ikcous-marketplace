// @vitest-environment jsdom
//
// "Para fazer" do Início — quatro ramos que nenhum teste segurava (achados por
// mutação em 24/11/2026):
//  - `lojaSemVendasAinda` só vale quando NADA vendeu: mês, hoje, mês anterior
//    e os 14 dias da série (zeros na série continuam "sem vendas");
//  - dinheiro a devolver sem VALOR conhecido não mostra a linha, mesmo com a
//    contagem de pedidos preenchida (nunca "R$ — de 3 pedidos cancelados");
//  - contagem DESCONHECIDA (banco sem o campo) aparece como "—", não some da
//    lista: sumir leria como "não há pendência".
import {
  ParaFazer,
  lojaSemVendasAinda,
} from "@/components/admin/inicio/ParaFazer";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SEM_VENDA_NENHUMA: PainelInicio = {
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
  serie14d: [{ dia: "2026-11-24", receita: 0 }],
};

const com = (parte: Partial<PainelInicio>): PainelInicio => ({
  ...SEM_VENDA_NENHUMA,
  ...parte,
});

describe("lojaSemVendasAinda", () => {
  it("nada vendeu em lugar nenhum (série só de zeros inclusive): loja sem vendas", () => {
    expect(lojaSemVendasAinda(SEM_VENDA_NENHUMA)).toBe(true);
    expect(lojaSemVendasAinda(com({ serie14d: [] }))).toBe(true);
  });

  it("painel que ainda não chegou não é 'loja sem vendas'", () => {
    expect(lojaSemVendasAinda(null)).toBe(false);
  });

  it("receita no mês anterior já é loja que vendeu", () => {
    expect(
      lojaSemVendasAinda(
        com({ mes: { ...SEM_VENDA_NENHUMA.mes, receitaMesAnterior: 50 } }),
      ),
    ).toBe(false);
  });

  it("venda em algum dos 14 dias já é loja que vendeu (no dia 1 a série cobre o mês passado)", () => {
    expect(
      lojaSemVendasAinda(
        com({
          serie14d: [
            { dia: "2026-10-30", receita: 80 },
            { dia: "2026-11-01", receita: 0 },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("pedido hoje ou pedido no mês já é loja que vendeu", () => {
    expect(
      lojaSemVendasAinda(
        com({ hoje: { ...SEM_VENDA_NENHUMA.hoje, pedidos: 1 } }),
      ),
    ).toBe(false);
    expect(
      lojaSemVendasAinda(
        com({ mes: { ...SEM_VENDA_NENHUMA.mes, pedidos: 2 } }),
      ),
    ).toBe(false);
  });
});

describe("ParaFazer: valor e contagem desconhecidos", () => {
  let raiz: Root;
  let tela: HTMLDivElement;

  beforeEach(() => {
    tela = document.createElement("div");
    document.body.appendChild(tela);
    raiz = createRoot(tela);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    tela.remove();
  });

  const montar = (painel: PainelInicio) =>
    act(() =>
      raiz.render(
        <ParaFazer painel={painel} carregando={false} onNavigate={vi.fn()} />,
      ),
    );
  const linhas = () =>
    Array.from(tela.querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label") ?? "",
    );

  it("dinheiro a devolver sem valor conhecido não mostra a linha, mesmo com 3 pedidos na contagem", () => {
    montar(com({ dinheiroADevolver: { valor: null, pedidos: 3 } }));
    expect(linhas().some((l) => l.startsWith("Dinheiro a devolver"))).toBe(
      false,
    );
  });

  it("dinheiro a devolver com valor e pedidos conhecidos mostra a linha com os dois", () => {
    montar(com({ dinheiroADevolver: { valor: 120, pedidos: 3 } }));
    const linha = linhas().find((l) => l.startsWith("Dinheiro a devolver"));
    expect(linha).toContain("3 pedidos cancelados");
    expect(linha).toMatch(/R\$\s?120,00/);
  });

  it("contagens desconhecidas (null) continuam na lista como '—'", () => {
    montar(
      com({
        contasVencidas: null,
        pendencias: {
          pedidosParaPreparar: null,
          devolucoesAbertas: null,
          caixaAberto: false,
          estoqueBaixo: null,
        },
      }),
    );
    const todas = linhas().join("\n");
    expect(todas).toContain("— pedidos para preparar");
    expect(todas).toContain("— contas vencidas");
    expect(todas).toContain("— devoluções abertas");
    expect(todas).toContain("— produtos com estoque baixo");
  });

  it("contagem zero CONHECIDA some da lista (só pendência aparece)", () => {
    montar(SEM_VENDA_NENHUMA);
    const todas = linhas().join("\n");
    expect(todas).not.toContain("pedidos para preparar");
    expect(todas).not.toContain("contas vencidas");
    expect(todas).toContain("Caixa fechado");
  });
});

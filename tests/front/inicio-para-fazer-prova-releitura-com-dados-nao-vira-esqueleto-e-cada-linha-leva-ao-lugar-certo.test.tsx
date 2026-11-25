// @vitest-environment jsdom
//
// "Para fazer" do Início, duas provas que os vizinhos não faziam:
//
//  1. Releitura com números já na tela NÃO volta ao esqueleto ("Aguardando os
//     dados"). O esqueleto é só da primeira leitura (`carregando` E sem
//     painel): trocar a condição por `carregando` apagava a lista inteira a
//     cada releitura de fundo e a lojista via a tela piscar vazia.
//  2. Cada linha leva ao lugar certo: contas vencidas abre a aba "previstos" do
//     Financeiro, o caixa abre a aba "caixa", devoluções abertas pede o filtro
//     "abertas" e vai para Devoluções, e o dinheiro a devolver abre a lista de
//     cancelados SEM navegar (quando a tela entrega o atalho) ou vai a Pedidos
//     (quando não entrega).
import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
import {
  consumirFiltroDeDevolucoes,
  espiarFiltroDeDevolucoes,
} from "@/lib/aviso-leva-a-devolucoes-solicitadas";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAINEL: PainelInicio = {
  hoje: {
    receita: 1482,
    online: 1102,
    presencial: 380,
    pedidos: 9,
    receitaSemanaPassada: 1256,
  },
  mes: {
    receita: 18640,
    receitaMesAnterior: 16643,
    pedidos: 112,
    ticketMedio: 166.43,
    lucroEstimado: 4210,
  },
  saldoTotal: 6820,
  aReceber7d: 2340,
  aPagar7d: 1180,
  contasVencidas: 0,
  pendencias: {
    pedidosParaPreparar: 0,
    devolucoesAbertas: 0,
    caixaAberto: false,
    estoqueBaixo: 0,
  },
  serie14d: [],
};

const SEM_NADA = {
  ...PAINEL,
  pendencias: { ...PAINEL.pendencias },
} satisfies PainelInicio;

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
  consumirFiltroDeDevolucoes();
});

const texto = () =>
  (tela.textContent ?? "").split(String.fromCharCode(160)).join(" ");
const linha = (comeco: string) =>
  Array.from(tela.querySelectorAll("button")).find((b) =>
    (b.getAttribute("aria-label") ?? "").startsWith(comeco),
  ) as HTMLButtonElement | undefined;
const secao = () => tela.querySelector("section") as HTMLElement;

describe("Para fazer: esqueleto só na primeira leitura", () => {
  it("lendo pela primeira vez (sem painel): mostra o esqueleto, ocupado, sem linhas", () => {
    act(() =>
      raiz.render(
        <ParaFazer painel={null} carregando={true} onNavigate={vi.fn()} />,
      ),
    );
    expect(texto()).toContain("Aguardando os dados. Zero só após confirmar.");
    expect(secao().getAttribute("aria-busy")).toBe("true");
    expect(tela.querySelectorAll("button")).toHaveLength(0);
  });

  it("releitura com os números já na tela: a lista continua, sem esqueleto e sem 'ocupado'", () => {
    act(() =>
      raiz.render(
        <ParaFazer
          painel={{ ...SEM_NADA, contasVencidas: 2 }}
          carregando={true}
          onNavigate={vi.fn()}
        />,
      ),
    );
    expect(texto()).not.toContain("Aguardando os dados");
    expect(secao().getAttribute("aria-busy")).toBe("false");
    expect(linha("Contas vencidas")).toBeDefined();
  });

  it("sem painel e sem leitura em andamento: não finge que está carregando", () => {
    act(() =>
      raiz.render(
        <ParaFazer painel={null} carregando={false} onNavigate={vi.fn()} />,
      ),
    );
    expect(texto()).not.toContain("Aguardando os dados");
    expect(secao().getAttribute("aria-busy")).toBe("false");
    expect(texto()).toContain("Caixa —");
  });
});

describe("Para fazer: cada linha leva ao lugar certo", () => {
  it("contas vencidas: Financeiro, aba 'previstos'", () => {
    const ir = vi.fn();
    act(() =>
      raiz.render(
        <ParaFazer
          painel={{ ...SEM_NADA, contasVencidas: 3 }}
          carregando={false}
          onNavigate={ir}
        />,
      ),
    );
    expect(texto()).toContain("3 contas vencidas");
    act(() => linha("Contas vencidas")?.click());
    expect(ir).toHaveBeenCalledExactlyOnceWith("admin-financeiro", "previstos");
  });

  it("uma conta vencida está no singular", () => {
    act(() =>
      raiz.render(
        <ParaFazer
          painel={{ ...SEM_NADA, contasVencidas: 1 }}
          carregando={false}
          onNavigate={vi.fn()}
        />,
      ),
    );
    expect(texto()).toContain("1 conta vencida");
    expect(texto()).not.toContain("1 contas vencidas");
    expect(texto()).toContain("1 pendência");
  });

  it("caixa aberto e fechado: texto, destino 'caixa' e só o aberto conta como pendência", () => {
    const ir = vi.fn();
    act(() =>
      raiz.render(
        <ParaFazer
          painel={{
            ...SEM_NADA,
            pendencias: { ...SEM_NADA.pendencias, caixaAberto: true },
          }}
          carregando={false}
          onNavigate={ir}
        />,
      ),
    );
    expect(texto()).toContain("Caixa aberto");
    expect(texto()).toContain("1 pendência");
    act(() => linha("Caixa")?.click());
    expect(ir).toHaveBeenCalledExactlyOnceWith("admin-financeiro", "caixa");

    act(() =>
      raiz.render(
        <ParaFazer painel={SEM_NADA} carregando={false} onNavigate={ir} />,
      ),
    );
    expect(texto()).toContain("Caixa fechado");
    expect(texto()).not.toMatch(/\d+ pendência/);
  });

  it("devoluções abertas: pede o filtro 'abertas' e vai para Devoluções (sem aba)", () => {
    const ir = vi.fn();
    act(() =>
      raiz.render(
        <ParaFazer
          painel={{
            ...SEM_NADA,
            pendencias: { ...SEM_NADA.pendencias, devolucoesAbertas: 2 },
          }}
          carregando={false}
          onNavigate={ir}
        />,
      ),
    );
    expect(espiarFiltroDeDevolucoes()).toBeNull();
    act(() => linha("Devoluções abertas")?.click());

    expect(ir).toHaveBeenCalledExactlyOnceWith("admin-devolucoes");
    expect(espiarFiltroDeDevolucoes()).toBe("abertas");
  });

  it("dinheiro a devolver com o atalho da tela: abre os cancelados e NÃO navega", () => {
    const ir = vi.fn();
    const abrirCancelados = vi.fn();
    act(() =>
      raiz.render(
        <ParaFazer
          painel={{
            ...SEM_NADA,
            dinheiroADevolver: { valor: 120.5, pedidos: 2 },
          }}
          carregando={false}
          onNavigate={ir}
          aoAbrirCancelados={abrirCancelados}
        />,
      ),
    );
    act(() => linha("Dinheiro a devolver")?.click());

    expect(abrirCancelados).toHaveBeenCalledTimes(1);
    expect(ir).not.toHaveBeenCalled();
  });

  it("dinheiro a devolver sem o atalho: vai para Pedidos; e 1 pedido está no singular", () => {
    const ir = vi.fn();
    act(() =>
      raiz.render(
        <ParaFazer
          painel={{
            ...SEM_NADA,
            dinheiroADevolver: { valor: 80, pedidos: 1 },
          }}
          carregando={false}
          onNavigate={ir}
        />,
      ),
    );
    expect(texto()).toContain("de 1 pedido cancelado");
    act(() => linha("Dinheiro a devolver")?.click());

    expect(ir).toHaveBeenCalledExactlyOnceWith("admin-orders");
  });
});

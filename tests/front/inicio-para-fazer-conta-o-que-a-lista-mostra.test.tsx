// @vitest-environment jsdom
//
// "Para fazer" do Início: o número do cabeçalho e o "Tudo em dia" têm de
// concordar com as linhas que a lista de fato mostra. O Início passa
// `preparoEmDestaque` (o cartão "Preparar pedidos" já está logo acima) e a
// lista esconde a linha "preparar"; contar essa linha escondida dizia "1
// pendência" sobre uma lista sem nenhuma pendência de verdade.
import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
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

const comPreparar = (n: number, resto: Partial<PainelInicio> = {}) =>
  ({
    ...PAINEL,
    ...resto,
    pendencias: { ...PAINEL.pendencias, pedidosParaPreparar: n },
  }) satisfies PainelInicio;

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
const montar = (painel: PainelInicio, preparoEmDestaque: boolean) =>
  act(() =>
    raiz.render(
      <ParaFazer
        painel={painel}
        carregando={false}
        onNavigate={vi.fn()}
        preparoEmDestaque={preparoEmDestaque}
      />,
    ),
  );
const texto = () =>
  (tela.textContent ?? "").split(String.fromCharCode(160)).join(" ");
const linhas = () =>
  Array.from(tela.querySelectorAll("button")).map(
    (b) => b.getAttribute("aria-label") ?? "",
  );

describe("Para fazer com o preparo em destaque no cartão de cima", () => {
  it("só pedidos para preparar: o cabeçalho não conta pendência que a lista não mostra", () => {
    montar(comPreparar(2), true);
    expect(linhas().some((l) => l.startsWith("Pedidos para preparar"))).toBe(
      false,
    );
    expect(texto()).not.toMatch(/\d+ pendência/);
  });

  it("só pedidos para preparar: não diz 'Tudo em dia' e manda olhar o cartão de cima", () => {
    montar(comPreparar(2), true);
    expect(texto()).not.toContain("Tudo em dia");
    expect(texto()).not.toContain("Nenhuma pendência para resolver");
    expect(texto()).toContain("Nada mais para resolver");
    expect(texto()).toContain("preparar os pedidos");
  });

  it("pedido para preparar e conta vencida: o cabeçalho conta 1, a da lista", () => {
    montar(comPreparar(1, { contasVencidas: 1 }), true);
    expect(linhas().some((l) => l.startsWith("Contas vencidas"))).toBe(true);
    expect(texto()).toContain("1 pendência");
    expect(texto()).not.toContain("2 pendências");
  });

  it("loja sem venda paga ainda, mas com pedido para preparar: não diz 'Sem pedidos por enquanto'", () => {
    // Pedido para pagar na entrega espera preparo e ainda não é venda paga.
    const novo = comPreparar(1, {
      hoje: { ...PAINEL.hoje, pedidos: 0, receita: 0 },
      mes: { ...PAINEL.mes, pedidos: 0, receita: 0, receitaMesAnterior: 0 },
    });
    montar(novo, true);
    expect(texto()).not.toContain("Sem pedidos por enquanto");
    expect(texto()).not.toContain("Quando chegar o primeiro pedido");
    expect(texto()).toContain("Nada mais para resolver");
  });

  it("sem pedido para preparar o 'Tudo em dia' continua como era", () => {
    montar(comPreparar(0), true);
    expect(texto()).toContain("Tudo em dia");
    expect(texto()).toContain("Nenhuma pendência para resolver");
  });
});

describe("Para fazer sem o cartão de cima (preparo não está em destaque)", () => {
  it("a linha de pedidos para preparar aparece e entra na contagem", () => {
    montar(comPreparar(2, { contasVencidas: 1 }), false);
    expect(linhas().some((l) => l.startsWith("Pedidos para preparar"))).toBe(
      true,
    );
    expect(texto()).toContain("2 pendências");
  });
});

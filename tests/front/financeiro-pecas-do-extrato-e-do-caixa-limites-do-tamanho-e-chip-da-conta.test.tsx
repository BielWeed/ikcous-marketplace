// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026): limites exatos do tamanho da letra dos valores
// do Extrato e do Caixa, e o chip "Todas as contas ›" do Extrato.
//
// O que os testes antigos não viam:
//  - o corte EXATO de cada faixa (12 caracteres ainda é letra normal, 13 já
//    encolhe) na linha do Extrato e na linha e no herói do Caixa;
//  - o sinal "+"/"−" conta como um caractere a mais no cartão do topo;
//  - com "Ocultar valores" ligado a linha usa o tamanho da MÁSCARA, nunca o do
//    valor real (senão a letra entrega a ordem de grandeza);
//  - o chip mostra o NOME da conta escolhida, e conta inativa vem marcada.
//
// Lista premium (26/11/2026): o chip deixou de ter um `<select>` invisível
// por cima e virou o gatilho da lista de escolha do painel (folha "Mostrar
// contas" no celular). A escolha passa pelo helper, como a lojista faz.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classeDoValorDoHeroi,
  classeDoValorDaLinha as linhaDoCaixa,
} from "@/components/admin/financeiro/partesDoCaixa";
import {
  ChipDaConta,
  classeDoValorDoTopo,
  classeDoValorDaLinha as linhaDoExtrato,
} from "@/components/admin/financeiro/partesDoExtrato";
import type { ContaFinanceira } from "@/types/financeiro";
import { escolherNaLista, opcoesDaLista } from "./helpers/lista-de-escolha";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Valores com N caracteres no texto "R$ ..." (sem sinal):
//   "R$ 100,00" = 9 · "R$ 1.234,56" = 11 · "R$ 12.345,67" = 12 · "R$ 123.456,78" = 13 · "R$ 1.234.567,89" = 15
const COM_9 = 100;
const COM_11 = 1234.56;
const COM_12 = 12345.67;
const COM_13 = 123456.78;
const COM_15 = 1234567.89;

describe("Extrato: a linha de uma lista muda de letra no caractere certo", () => {
  it("até 12 caracteres a letra é `text-base`; com 13 passa para `text-sm`", () => {
    expect(linhaDoExtrato(COM_11, false, false)).toContain("text-base");
    expect(linhaDoExtrato(COM_12, false, false)).toContain("text-base");
    expect(linhaDoExtrato(COM_13, false, false)).toContain("text-sm");
    expect(linhaDoExtrato(COM_13, false, false)).not.toContain("text-base");
  });

  it("até 9 caracteres a letra é de 18px; com 10 já é `text-base`", () => {
    expect(linhaDoExtrato(COM_9, false, false)).toContain("text-[18px]");
    expect(linhaDoExtrato(COM_9, true, false)).toContain("text-base");
  });

  it("com Ocultar valores a letra é a da máscara, qualquer que seja o valor", () => {
    const grande = linhaDoExtrato(COM_15, true, true);
    const pequeno = linhaDoExtrato(5, false, true);
    expect(grande).toContain("text-[18px]");
    expect(pequeno).toBe(grande);
    // Sem ocultar, o mesmo valor grande encolhe (prova de que o controle mede).
    expect(linhaDoExtrato(COM_15, true, false)).not.toContain("text-[18px]");
  });
});

describe("Extrato: o cartão do topo conta o sinal como um caractere", () => {
  it("13 caracteres sem sinal cabem na letra grande; com sinal viram 14 e encolhem", () => {
    const semSinal = classeDoValorDoTopo(COM_13, false, false);
    const comSinal = classeDoValorDoTopo(COM_13, true, false);
    expect(semSinal).toContain("text-[clamp(2rem,10vw,2.75rem)]");
    expect(comSinal).toContain("text-[clamp(1.5rem,7vw,2rem)]");
  });

  it("valor negativo conta o sinal mesmo sem pedir (o texto vem com o menos)", () => {
    expect(classeDoValorDoTopo(-COM_13, false, false)).toContain(
      "text-[clamp(1.5rem,7vw,2rem)]",
    );
  });
});

describe("Caixa: a linha e o herói mudam de letra no caractere certo", () => {
  it("a linha: até 11 caracteres `text-base`, 12 e 13 `text-sm`, 15 `text-xs`", () => {
    expect(linhaDoCaixa(COM_11, false, false)).toContain("text-base");
    expect(linhaDoCaixa(COM_12, false, false)).toContain("text-sm");
    expect(linhaDoCaixa(COM_13, false, false)).toContain("text-sm");
    expect(linhaDoCaixa(COM_15, false, false)).toContain("text-xs");
  });

  it("o herói não conta sinal: 13 caracteres ainda cabem na letra grande", () => {
    expect(classeDoValorDoHeroi(COM_13, false)).toContain(
      "text-[clamp(2rem,10vw,2.75rem)]",
    );
    expect(classeDoValorDoHeroi(COM_15, false)).toContain(
      "text-[clamp(1.5rem,7vw,2rem)]",
    );
  });

  it("o herói com Ocultar valores usa a letra da máscara", () => {
    expect(classeDoValorDoHeroi(COM_15, true)).toContain(
      "text-[clamp(2rem,10vw,2.75rem)]",
    );
  });
});

describe("Extrato: o chip da conta", () => {
  let raiz: Root | null = null;
  let alvo: HTMLElement | null = null;

  afterEach(() => {
    act(() => raiz?.unmount());
    alvo?.remove();
    raiz = null;
    alvo = null;
  });

  const conta = (
    id: string,
    nome: string,
    ativa: boolean,
  ): ContaFinanceira => ({
    id,
    nome,
    tipo: "banco",
    saldoInicial: 0,
    saldoInicialEm: null,
    ativa,
    ordem: 1,
    sistema: false,
    saldo: 0,
  });
  const contas = [
    conta("c1", "Gaveta da loja", true),
    conta("c2", "Conta antiga", false),
  ];

  function montar(valor: string, aoMudar: (id: string) => void = () => {}) {
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
    act(() =>
      raiz?.render(
        <ChipDaConta
          id="chip"
          valor={valor}
          aoMudar={aoMudar}
          contas={contas}
        />,
      ),
    );
    return alvo;
  }

  it("sem escolha mostra 'Todas as contas'; com escolha mostra o NOME da conta", () => {
    const vazio = montar("");
    expect(vazio.querySelector("span.truncate")?.textContent).toBe(
      "Todas as contas",
    );
    act(() => raiz?.unmount());
    alvo?.remove();

    const escolhido = montar("c1");
    expect(escolhido.querySelector("span.truncate")?.textContent).toBe(
      "Gaveta da loja",
    );
  });

  it("conta que não existe mais na lista cai em 'Todas as contas'", () => {
    const orfao = montar("c-que-sumiu");
    expect(orfao.querySelector("span.truncate")?.textContent).toBe(
      "Todas as contas",
    );
  });

  it("é o gatilho da lista: nome 'Conta, Todas as contas', pílula de 44px", () => {
    montar("");
    const chip = document.getElementById("chip") as HTMLButtonElement;
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.getAttribute("aria-haspopup")).toBe("listbox");
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(chip.getAttribute("aria-label")).toBe("Conta, Todas as contas");
    expect(chip.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["rounded-full", "border-solid", "min-h-11"]),
    );
    // Nada de `<select>` escondido por cima.
    expect(document.querySelector("select")).toBeNull();
  });

  it("com escolha, o nome do chip diz a conta escolhida", () => {
    montar("c1");
    expect(document.getElementById("chip")?.getAttribute("aria-label")).toBe(
      "Conta, Gaveta da loja",
    );
  });

  it("a lista abre com 'Todas as contas' primeiro e marca a desativada", () => {
    montar("");
    let lidas: ReturnType<typeof opcoesDaLista> = [];
    act(() => {
      lidas = opcoesDaLista("chip");
    });
    expect(lidas).toEqual([
      { valor: "", rotulo: "Todas as contas", desabilitada: false },
      { valor: "c1", rotulo: "Gaveta da loja", desabilitada: false },
      // Desativada continua escolhível: o extrato dela ainda existe.
      { valor: "c2", rotulo: "Conta antiga", desabilitada: false },
    ]);
    act(() => (document.getElementById("chip") as HTMLButtonElement).click());
    const opcao = (valor: string) =>
      document.querySelector(`[role="option"][data-valor="${valor}"]`)
        ?.textContent ?? "";
    expect(opcao("")).toContain("Somar tudo");
    expect(opcao("c2")).toContain("Desativada");
    expect(opcao("c1")).not.toContain("Desativada");
    // O título da folha é "Mostrar contas".
    expect(document.body.textContent).toContain("Mostrar contas");
  });

  it("escolher na lista avisa com o id da conta", () => {
    const aoMudar = vi.fn();
    montar("", aoMudar);
    act(() => escolherNaLista("chip", "c2"));
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenLastCalledWith("c2");
  });
});

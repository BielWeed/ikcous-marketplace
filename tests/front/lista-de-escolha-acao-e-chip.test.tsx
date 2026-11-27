// @vitest-environment jsdom
//
// Dois usos da lista além do campo comum:
//  - modo AÇÃO (Combinações dos banners): cada escolha dispara `aoEscolher`
//    uma vez, nada fica marcado e o campo volta ao placeholder — escolher a
//    mesma de novo reaplica;
//  - GATILHO PRÓPRIO (o chip "Todas as contas ›" do Extrato): quem desenha o
//    botão é a tela, que recebe as props de acessibilidade prontas.
import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import { ListaDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/ListaDeEscolha";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { Landmark, Layers, Wallet } from "lucide-react";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

const COMBINACOES: OpcaoDaLista[] = [
  { valor: "noite", rotulo: "Noite", subinfo: "Fundo escuro, texto claro" },
  { valor: "areia", rotulo: "Areia", subinfo: "Fundo bege, texto marrom" },
];

const opcao = (valor: string) =>
  document.querySelector<HTMLElement>(
    `[role="option"][data-valor="${valor}"]`,
  ) as HTMLElement;

describe("lista de escolha — modo ação", () => {
  function montar() {
    const aoEscolher = vi.fn();
    act(() => {
      raiz.render(
        <CampoDeEscolha
          id="banner-combinacao"
          rotulo="Combinações"
          modo="acao"
          placeholder="Escolha uma combinação"
          opcoes={COMBINACOES}
          aoEscolher={aoEscolher}
        />,
      );
    });
    return aoEscolher;
  }
  const botao = () =>
    document.getElementById("banner-combinacao") as HTMLButtonElement;
  const mostrado = () =>
    document.getElementById("banner-combinacao-valor")?.textContent;

  it("mostra o placeholder e nenhuma opção marcada", () => {
    montar();
    expect(mostrado()).toBe("Escolha uma combinação");
    expect(botao().dataset.valor).toBe("");
    act(() => botao().click());
    expect(
      document.querySelector('[role="option"][aria-selected="true"]'),
    ).toBeNull();
    expect(opcao("noite").textContent).toContain("Fundo escuro, texto claro");
  });

  it("escolher chama aoEscolher uma vez, fecha e volta ao placeholder", () => {
    const aoEscolher = montar();
    act(() => botao().click());
    act(() => opcao("areia").click());
    expect(aoEscolher).toHaveBeenCalledTimes(1);
    expect(aoEscolher).toHaveBeenCalledWith("areia");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(mostrado()).toBe("Escolha uma combinação");
  });

  it("reaplicar a mesma combinação chama de novo", () => {
    const aoEscolher = montar();
    act(() => botao().click());
    act(() => opcao("areia").click());
    act(() => botao().click());
    act(() => opcao("areia").click());
    expect(aoEscolher).toHaveBeenCalledTimes(2);
  });
});

describe("lista de escolha — gatilho próprio (chip)", () => {
  const CONTAS: OpcaoDaLista[] = [
    {
      valor: "",
      rotulo: "Todas as contas",
      subinfo: "Somar tudo",
      icone: Layers,
    },
    { valor: "banco", rotulo: "Conta no banco", icone: Landmark },
    {
      valor: "velha",
      rotulo: "Carteira antiga",
      subinfo: "Desativada",
      icone: Wallet,
    },
  ];

  function Chip() {
    const [conta, setConta] = useState("");
    return (
      <ListaDeEscolha
        id="fin-extrato-conta"
        rotulo="Conta"
        tituloDaLista="Mostrar contas"
        opcoes={CONTAS}
        valor={conta}
        aoMudar={setConta}
        gatilho={({ botao, textoMostrado, escolhida, aberta }) => (
          <button
            {...botao}
            aria-label={`Conta, ${textoMostrado}`}
            data-aberta={aberta}
            className="rounded-full border-solid"
          >
            {escolhida?.icone ? <escolhida.icone aria-hidden="true" /> : null}
            {textoMostrado} ›
          </button>
        )}
      />
    );
  }
  const chip = () =>
    document.getElementById("fin-extrato-conta") as HTMLButtonElement;

  it("o chip recebe aria-expanded, aria-controls, aria-haspopup e data-valor", () => {
    act(() => raiz.render(<Chip />));
    const c = chip();
    expect(c.getAttribute("aria-haspopup")).toBe("listbox");
    expect(c.getAttribute("aria-expanded")).toBe("false");
    expect(c.getAttribute("aria-controls")).toBe("fin-extrato-conta-lista");
    expect(c.dataset.valor).toBe("");
    expect(c.getAttribute("aria-label")).toBe("Conta, Todas as contas");
    expect(c.querySelector("svg")).not.toBeNull();
    expect(c.className).toContain("rounded-full");
  });

  it("abre a folha 'Mostrar contas' com ícone por conta e a subinfo", () => {
    act(() => raiz.render(<Chip />));
    act(() => chip().click());
    expect(chip().getAttribute("aria-expanded")).toBe("true");
    expect(chip().dataset.aberta).toBe("true");
    const folha = document.querySelector('[data-lista-de-escolha="folha"]');
    expect(folha?.textContent).toContain("Mostrar contas");
    expect(opcao("").getAttribute("aria-selected")).toBe("true");
    expect(opcao("").textContent).toContain("Somar tudo");
    expect(opcao("velha").textContent).toContain("Desativada");
    expect(opcao("banco").querySelector("svg")).not.toBeNull();
  });

  it("escolher troca o texto e o ícone do chip e devolve o foco a ele", async () => {
    act(() => raiz.render(<Chip />));
    act(() => chip().click());
    act(() => opcao("banco").click());
    expect(chip().getAttribute("aria-label")).toBe("Conta, Conta no banco");
    expect(chip().dataset.valor).toBe("banco");
    // O Radix devolve o foco num `setTimeout(0)` depois de desmontar a folha.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.activeElement).toBe(chip());
  });
});

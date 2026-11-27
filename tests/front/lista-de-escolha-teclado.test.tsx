// @vitest-environment jsdom
//
// Teclado da lista de escolha: ↓↑ pulam a desabilitada e não dão a volta,
// Home/End vão às pontas, Enter e Espaço escolhem (Espaço não, na busca, onde
// é letra), letra pula para a opção sem busca, e Alt/Ctrl/Meta com seta são do
// navegador (nada acontece). O anel ouro só aparece depois da primeira tecla.
import { CorpoDaLista } from "@/components/admin/primitivos/lista-de-escolha/CorpoDaLista";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { act } from "react";
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

const CONTAS: OpcaoDaLista[] = [
  { valor: "sis", rotulo: "Sistema", desabilitada: true },
  { valor: "caixa", rotulo: "Caixa da loja" },
  { valor: "banco", rotulo: "Conta no banco" },
  { valor: "velha", rotulo: "Conta velha", desabilitada: true },
  { valor: "mp", rotulo: "Mercado Pago" },
];

const MUITAS: OpcaoDaLista[] = [
  "Acre",
  "Alagoas",
  "Amapá",
  "Bahia",
  "Ceará",
  "Goiás",
  "Pará",
  "Rio de Janeiro",
  "Rio Grande do Sul",
  "São Paulo",
].map((nome) => ({ valor: nome, rotulo: nome }));

function montar(
  opcoes: readonly OpcaoDaLista[],
  valorEscolhido: string | null,
  comBusca = false,
) {
  const aoEscolher = vi.fn();
  act(() => {
    raiz.render(
      <CorpoDaLista
        id="conta"
        rotulo="Conta"
        opcoes={opcoes}
        valorEscolhido={valorEscolhido}
        comBusca={comBusca}
        variante="popover"
        aoEscolher={aoEscolher}
      />,
    );
  });
  return aoEscolher;
}

const listbox = () =>
  document.querySelector<HTMLElement>('[role="listbox"]') as HTMLElement;
const busca = () =>
  document.querySelector<HTMLInputElement>(
    '[role="combobox"]',
  ) as HTMLInputElement;
const ativaEm = (alvo: HTMLElement) => {
  const id = alvo.getAttribute("aria-activedescendant");
  return id
    ? (document.getElementById(id)?.dataset.valor ?? "(id sem opção)")
    : null;
};

function tecla(
  alvo: HTMLElement,
  key: string,
  extra: Partial<KeyboardEventInit> = {},
) {
  const evento = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  act(() => {
    alvo.dispatchEvent(evento);
  });
  return evento;
}

describe("lista de escolha — teclado sem busca", () => {
  it("abre apontando a escolhida", () => {
    montar(CONTAS, "banco");
    expect(ativaEm(listbox())).toBe("banco");
  });

  it("↓ pula a desabilitada e não dá a volta no fim", () => {
    montar(CONTAS, "banco");
    const evento = tecla(listbox(), "ArrowDown");
    expect(evento.defaultPrevented).toBe(true);
    expect(ativaEm(listbox())).toBe("mp");
    tecla(listbox(), "ArrowDown");
    expect(ativaEm(listbox())).toBe("mp");
  });

  it("↑ pula a desabilitada do topo e para na primeira habilitada", () => {
    montar(CONTAS, "banco");
    tecla(listbox(), "ArrowUp");
    expect(ativaEm(listbox())).toBe("caixa");
    tecla(listbox(), "ArrowUp");
    expect(ativaEm(listbox())).toBe("caixa");
  });

  it("sem escolhida, ↓ começa na primeira habilitada", () => {
    montar(CONTAS, "");
    expect(ativaEm(listbox())).toBeNull();
    tecla(listbox(), "ArrowDown");
    expect(ativaEm(listbox())).toBe("caixa");
  });

  it("Home e End vão às pontas habilitadas", () => {
    montar(CONTAS, "banco");
    tecla(listbox(), "End");
    expect(ativaEm(listbox())).toBe("mp");
    tecla(listbox(), "Home");
    expect(ativaEm(listbox())).toBe("caixa");
  });

  it("Enter escolhe a ativa, uma vez", () => {
    const aoEscolher = montar(CONTAS, "banco");
    tecla(listbox(), "ArrowDown");
    tecla(listbox(), "Enter");
    expect(aoEscolher).toHaveBeenCalledTimes(1);
    expect(aoEscolher).toHaveBeenCalledWith("mp");
  });

  it("Espaço escolhe a ativa no listbox", () => {
    const aoEscolher = montar(CONTAS, "banco");
    const evento = tecla(listbox(), " ");
    expect(evento.defaultPrevented).toBe(true);
    expect(aoEscolher).toHaveBeenCalledWith("banco");
  });

  it("Enter sem ativa não escolhe nada", () => {
    const aoEscolher = montar(CONTAS, "");
    tecla(listbox(), "Enter");
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("letra pula para a próxima opção que começa com ela", () => {
    montar(CONTAS, "");
    tecla(listbox(), "m");
    expect(ativaEm(listbox())).toBe("mp");
    tecla(listbox(), "C");
    expect(ativaEm(listbox())).toBe("caixa");
    tecla(listbox(), "c");
    expect(ativaEm(listbox())).toBe("banco");
  });

  it("Alt, Ctrl e Meta com seta não fazem nada (são do navegador)", () => {
    montar(CONTAS, "banco");
    for (const mod of ["altKey", "ctrlKey", "metaKey"] as const) {
      const evento = tecla(listbox(), "ArrowDown", { [mod]: true });
      expect(evento.defaultPrevented, mod).toBe(false);
      expect(ativaEm(listbox()), mod).toBe("banco");
    }
    tecla(listbox(), "c", { ctrlKey: true });
    expect(ativaEm(listbox())).toBe("banco");
  });

  it("o anel ouro só aparece depois da primeira tecla", () => {
    montar(CONTAS, "banco");
    expect(document.querySelector(".lista-de-escolha-ativa")).toBeNull();
    tecla(listbox(), "ArrowDown");
    const comAnel = [...document.querySelectorAll(".lista-de-escolha-ativa")];
    expect(comAnel.map((o) => (o as HTMLElement).dataset.valor)).toEqual([
      "mp",
    ]);
  });
});

describe("lista de escolha — teclado com busca", () => {
  it("↓↑ andam pela lista e a busca aponta a ativa", () => {
    montar(MUITAS, "Bahia", true);
    expect(ativaEm(busca())).toBe("Bahia");
    tecla(busca(), "ArrowDown");
    expect(ativaEm(busca())).toBe("Ceará");
    tecla(busca(), "ArrowUp");
    tecla(busca(), "ArrowUp");
    expect(ativaEm(busca())).toBe("Amapá");
  });

  it("Espaço na busca é letra: não escolhe nem é engolido", () => {
    const aoEscolher = montar(MUITAS, "Bahia", true);
    const evento = tecla(busca(), " ");
    expect(evento.defaultPrevented).toBe(false);
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("letra na busca não pula de opção (é texto)", () => {
    montar(MUITAS, "Bahia", true);
    const evento = tecla(busca(), "s");
    expect(evento.defaultPrevented).toBe(false);
    expect(ativaEm(busca())).toBe("Bahia");
  });

  it("Home e End na busca andam no texto, não na lista", () => {
    montar(MUITAS, "Bahia", true);
    expect(tecla(busca(), "End").defaultPrevented).toBe(false);
    expect(ativaEm(busca())).toBe("Bahia");
  });

  it("Enter na busca escolhe a ativa", () => {
    const aoEscolher = montar(MUITAS, "Bahia", true);
    tecla(busca(), "ArrowDown");
    tecla(busca(), "Enter");
    expect(aoEscolher).toHaveBeenCalledWith("Ceará");
  });
});

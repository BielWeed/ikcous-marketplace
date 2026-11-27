// @vitest-environment jsdom
//
// Lote Z da lista de escolha — as pontas soltas do componente-base:
//  - campo que TRAVA com a lista aberta (o envio começou): a lista fecha e
//    nenhuma escolha passa;
//  - Tab e Shift+Tab no popover do computador saem dele (combobox do APG): a
//    lista fecha e o foco segue para o campo seguinte (ou o anterior);
//  - girar o aparelho ou redimensionar cruzando 1024px com a lista aberta
//    devolve a entrada que a folha empurrou no histórico;
//  - a opção que o Enter vai escolher já mostra o anel ouro antes do Enter.
import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

class ResizeObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// A largura que se troca no meio do teste: `computador` decide o
// `(min-width: 1024px)`, e `mudarLargura` avisa quem assinou.
let computador = false;
const ouvintes = new Set<() => void>();
function mudarLargura(paraComputador: boolean) {
  computador = paraComputador;
  act(() => {
    for (const ouvir of ouvintes) ouvir();
  });
}

beforeEach(() => {
  computador = false;
  ouvintes.clear();
  vi.stubGlobal("ResizeObserver", ResizeObserverFalso);
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    get matches() {
      return consulta.includes("min-width: 1024px") && computador;
    },
    media: consulta,
    onchange: null,
    addEventListener: (_tipo: string, ouvir: () => void) => ouvintes.add(ouvir),
    removeEventListener: (_tipo: string, ouvir: () => void) =>
      ouvintes.delete(ouvir),
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PARCELAS: OpcaoDaLista[] = Array.from({ length: 12 }, (_, i) => ({
  valor: String(i + 1),
  rotulo: `${i + 1}x`,
}));
const POUCAS = PARCELAS.slice(0, 4);

function render(
  aoMudar: (v: string) => void,
  {
    opcoes = PARCELAS,
    valor = "2",
    desabilitado = false,
  }: {
    opcoes?: readonly OpcaoDaLista[];
    valor?: string;
    desabilitado?: boolean;
  } = {},
) {
  act(() => {
    raiz.render(
      <>
        <input id="antes" aria-label="Campo de antes" />
        <CampoDeEscolha
          id="parcelas"
          rotulo="Parcelar em até"
          opcoes={opcoes}
          valor={valor}
          aoMudar={aoMudar}
          desabilitado={desabilitado}
        />
        <input id="depois" aria-label="Campo de depois" />
      </>,
    );
  });
}

const botao = () => document.getElementById("parcelas") as HTMLButtonElement;
const folha = () =>
  document.querySelector<HTMLElement>('[data-lista-de-escolha="folha"]');
const popover = () =>
  document.querySelector<HTMLElement>('[data-lista-de-escolha="popover"]');
const comAnel = () =>
  [...document.querySelectorAll<HTMLElement>(".lista-de-escolha-ativa")].map(
    (o) => o.dataset.valor,
  );

// O Radix devolve o foco num `setTimeout(0)` depois de desmontar a lista.
const esperar = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

function tecla(alvo: Element, key: string, extra: KeyboardEventInit = {}) {
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

function digitar(input: HTMLInputElement, texto: string) {
  const definir = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    definir?.call(input, texto);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("lista de escolha — campo que trava com a lista aberta", () => {
  it.each([
    ["celular (folha)", false],
    ["computador (popover)", true],
  ])("no %s, a lista fecha e não reabre ao destravar", async (_nome, pc) => {
    computador = pc;
    const aoMudar = vi.fn();
    render(aoMudar);
    await act(async () => botao().click());
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();

    render(aoMudar, { desabilitado: true });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(folha()).toBeNull();
    expect(popover()).toBeNull();
    expect(botao().getAttribute("aria-expanded")).toBe("false");

    // O envio acabou: a lista NÃO volta sozinha.
    render(aoMudar, { desabilitado: false });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(aoMudar).not.toHaveBeenCalled();
  });
});

describe("lista de escolha — Tab sai do popover do computador", () => {
  it.each([
    ["com busca", PARCELAS],
    ["sem busca", POUCAS],
  ])("%s: Tab fecha e leva o foco ao campo seguinte", async (_nome, opcoes) => {
    computador = true;
    const aoMudar = vi.fn();
    render(aoMudar, { opcoes });
    await act(async () => botao().click());
    const dentro = document.activeElement as HTMLElement;
    expect(popover()?.contains(dentro)).toBe(true);

    const evento = tecla(dentro, "Tab");
    expect(evento.defaultPrevented).toBe(true);
    expect(popover()).toBeNull();
    await esperar();
    expect(document.activeElement?.id).toBe("depois");
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("Shift+Tab fecha e leva o foco ao campo anterior", async () => {
    computador = true;
    render(vi.fn());
    await act(async () => botao().click());
    tecla(document.activeElement as HTMLElement, "Tab", { shiftKey: true });
    expect(popover()).toBeNull();
    await esperar();
    expect(document.activeElement?.id).toBe("antes");
  });

  it("Esc continua devolvendo o foco ao próprio campo", async () => {
    computador = true;
    render(vi.fn());
    await act(async () => botao().click());
    tecla(document.activeElement as HTMLElement, "Escape");
    expect(popover()).toBeNull();
    await esperar();
    expect(document.activeElement).toBe(botao());
  });
});

describe("lista de escolha — troca de folha para popover com a lista aberta", () => {
  it("devolve a entrada que a folha empurrou no histórico", async () => {
    const voltar = vi.spyOn(history, "back");
    render(vi.fn());
    await act(async () => botao().click());
    expect(folha()).not.toBeNull();
    expect(history.state?.folhaDePolitica).toBe(true);

    // Girou o aparelho / a janela passou de 1024px.
    mudarLargura(true);
    expect(folha()).toBeNull();
    expect(voltar).toHaveBeenCalledTimes(1);
    await esperar(20);
    expect(history.state?.folhaDePolitica).not.toBe(true);
  });
});

describe("lista de escolha — o anel ouro aparece antes do Enter", () => {
  it("abrir pelo teclado (↓ no campo) já pinta o anel na escolhida", async () => {
    computador = true;
    const aoMudar = vi.fn();
    render(aoMudar, { opcoes: POUCAS, valor: "2" });
    botao().focus();
    tecla(botao(), "ArrowDown");
    await esperar();
    expect(comAnel()).toEqual(["2"]);
  });

  it.each([
    ["Enter", "Enter"],
    ["Espaço", " "],
  ])("abrir com %s no campo já pinta o anel na escolhida", async (_n, key) => {
    computador = true;
    render(vi.fn(), { opcoes: POUCAS, valor: "2" });
    botao().focus();
    // No navegador a tecla no botão vira o `click`; o jsdom não faz isso.
    tecla(botao(), key);
    await act(async () => botao().click());
    expect(comAnel()).toEqual(["2"]);
  });

  it("abrir com o mouse não pinta anel em ninguém", async () => {
    computador = true;
    render(vi.fn(), { opcoes: POUCAS, valor: "2" });
    await act(async () => botao().click());
    expect(popover()).not.toBeNull();
    expect(comAnel()).toEqual([]);
  });

  it("digitar na busca pinta o anel no primeiro resultado, que o Enter escolhe", async () => {
    computador = true;
    const aoMudar = vi.fn();
    render(aoMudar, { valor: "2" });
    await act(async () => botao().click());
    const busca = document.querySelector<HTMLInputElement>(
      '[role="combobox"]',
    ) as HTMLInputElement;
    digitar(busca, "11");
    expect(comAnel()).toEqual(["11"]);
    tecla(busca, "Enter");
    expect(aoMudar).toHaveBeenCalledWith("11");
  });
});

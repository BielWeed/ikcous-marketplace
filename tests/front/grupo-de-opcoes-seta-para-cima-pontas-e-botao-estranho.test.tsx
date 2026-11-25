// @vitest-environment jsdom
//
// GrupoDeOpcoes (as "bolinhas" do painel: aparência, frete, desconto...):
// o teste de teclado que já existia anda de seta para a direita/baixo e confere
// Home/End. Caça por mutação (25/11/2026) — sobreviveram: a seta para CIMA
// (andava para frente), Home/End em quem já está na ponta (clicava na própria
// opção de novo, regravando a escolha), o `preventDefault` das setas (a tela
// rolava junto), o contêiner do grupo virar parada de Tab (`tabIndex=-1`) e
// um botão que NÃO é opção (ex.: "Ajuda") entrar na ciranda das setas.
//
// Mutante equivalente anotado: `(atual + direcao + n) % n` ->
// `(atual + direcao) % n`: com índice -1, `botoes.at(-1)` já é a última opção,
// então o "volta ao fim" sai igual com ou sem o `+ n`.
import { GrupoDeOpcoes } from "@/components/admin/GrupoDeOpcoes";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;
const aoEscolher = vi.fn<(id: string) => void>();

beforeEach(() => {
  aoEscolher.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(marcada = "b") {
  act(() => {
    raiz.render(
      <GrupoDeOpcoes aria-label="Escolha">
        {["a", "b", "c"].map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === marcada}
            onClick={() => aoEscolher(id)}
          >
            {id}
          </button>
        ))}
        <button type="button" id="ajuda">
          Ajuda
        </button>
      </GrupoDeOpcoes>,
    );
  });
}

const radios = () => [
  ...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
];
const grupo = () => host.querySelector('[role="radiogroup"]') as HTMLElement;

/** Aperta a tecla e devolve o evento, para olhar `defaultPrevented`. */
function tecla(alvo: HTMLElement, key: string): KeyboardEvent {
  const evento = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    alvo.dispatchEvent(evento);
  });
  return evento;
}

describe("GrupoDeOpcoes: seta para cima", () => {
  it("anda para a opção ANTERIOR e a escolhe e foca", () => {
    montar("c");
    const [, b] = radios();
    radios()[2].focus();
    const evento = tecla(radios()[2], "ArrowUp");
    expect(aoEscolher).toHaveBeenCalledExactlyOnceWith("b");
    expect(document.activeElement).toBe(b);
    expect(evento.defaultPrevented).toBe(true);
  });

  it("da primeira opção volta para a ÚLTIMA", () => {
    montar("a");
    radios()[0].focus();
    tecla(radios()[0], "ArrowUp");
    expect(aoEscolher).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("seta para a esquerda faz o mesmo que a de cima", () => {
    montar("c");
    radios()[2].focus();
    tecla(radios()[2], "ArrowLeft");
    expect(aoEscolher).toHaveBeenCalledExactlyOnceWith("b");
  });
});

describe("GrupoDeOpcoes: pontas e eventos", () => {
  it("Home na primeira opção e End na última NÃO clicam de novo na mesma opção", () => {
    montar("a");
    radios()[0].focus();
    const home = tecla(radios()[0], "Home");
    expect(aoEscolher).not.toHaveBeenCalled();
    // Mesmo sem mudar, o gesto é do grupo: a tela não deve rolar.
    expect(home.defaultPrevented).toBe(true);
    radios()[2].focus();
    tecla(radios()[2], "End");
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("Home e End de uma opção do meio vão às pontas", () => {
    montar("b");
    radios()[1].focus();
    tecla(radios()[1], "Home");
    expect(aoEscolher).toHaveBeenLastCalledWith("a");
    tecla(radios()[1], "End");
    expect(aoEscolher).toHaveBeenLastCalledWith("c");
  });

  it("tecla que não é do grupo (letra, Tab) não é engolida", () => {
    montar();
    radios()[1].focus();
    expect(tecla(radios()[1], "a").defaultPrevented).toBe(false);
    expect(tecla(radios()[1], "Tab").defaultPrevented).toBe(false);
    expect(aoEscolher).not.toHaveBeenCalled();
  });
});

describe("GrupoDeOpcoes: quem entra na ciranda das setas", () => {
  it("o contêiner é um radiogroup que NÃO é parada de Tab (só a opção marcada é)", () => {
    montar("b");
    expect(grupo().getAttribute("role")).toBe("radiogroup");
    expect(grupo().getAttribute("aria-label")).toBe("Escolha");
    expect(grupo().tabIndex).toBe(-1);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("botão que não é opção (Ajuda) fica fora: a seta do fim volta para a PRIMEIRA opção", () => {
    montar("c");
    radios()[2].focus();
    tecla(radios()[2], "ArrowRight");
    expect(aoEscolher).toHaveBeenCalledExactlyOnceWith("a");
    expect(document.activeElement).toBe(radios()[0]);
  });

  it("o botão estranho não mexe no tabIndex dele e a seta apertada nele não faz nada", () => {
    montar();
    const ajuda = host.querySelector("#ajuda") as HTMLButtonElement;
    expect(ajuda.tabIndex).toBe(0);
    ajuda.focus();
    const evento = tecla(ajuda, "ArrowRight");
    expect(evento.defaultPrevented).toBe(false);
    expect(aoEscolher).not.toHaveBeenCalled();
  });
});

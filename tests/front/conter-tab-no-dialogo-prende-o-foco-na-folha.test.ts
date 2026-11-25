// @vitest-environment jsdom
//
// O Tab dentro de uma folha/janela do painel (grade de variações, produto,
// devoluções) não pode escapar para a tela de trás: no último controle volta
// ao primeiro, no primeiro com Shift volta ao último, e controle desligado,
// escondido, inerte ou fora da sequência do teclado não conta. Prova direta
// de `conterTabNoDialogo` (caça por mutação, 24/11/2026).
import {
  conterTabNoDialogo,
  controlesDoDialogo,
} from "@/components/admin/primitivos/conterTabNoDialogo";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dialogo: HTMLDivElement;
let fora: HTMLButtonElement;

function evento(
  parcial: {
    key?: string;
    shiftKey?: boolean;
    defaultPrevented?: boolean;
  } = {},
) {
  let impedido = false;
  return {
    key: parcial.key ?? "Tab",
    shiftKey: parcial.shiftKey ?? false,
    defaultPrevented: parcial.defaultPrevented ?? false,
    preventDefault: () => {
      impedido = true;
    },
    foiImpedido: () => impedido,
  };
}

function montar(html: string) {
  dialogo.innerHTML = html;
}

const id = (nome: string) => document.getElementById(nome) as HTMLElement;

beforeEach(() => {
  dialogo = document.createElement("div");
  dialogo.tabIndex = -1;
  fora = document.createElement("button");
  fora.id = "fora";
  document.body.append(fora, dialogo);
});

afterEach(() => {
  dialogo.remove();
  fora.remove();
});

describe("conterTabNoDialogo: o ciclo do teclado", () => {
  beforeEach(() => {
    montar('<button id="a">A</button><input id="b"/><button id="c">C</button>');
  });

  it("Tab no último controle volta ao primeiro", () => {
    id("c").focus();
    const e = evento();
    conterTabNoDialogo(e, dialogo);
    expect(e.foiImpedido()).toBe(true);
    expect(document.activeElement).toBe(id("a"));
  });

  it("Shift+Tab no primeiro controle vai ao último", () => {
    id("a").focus();
    const e = evento({ shiftKey: true });
    conterTabNoDialogo(e, dialogo);
    expect(e.foiImpedido()).toBe(true);
    expect(document.activeElement).toBe(id("c"));
  });

  it("no meio do caminho o navegador segue sozinho (nada é impedido)", () => {
    id("b").focus();
    const aFrente = evento();
    conterTabNoDialogo(aFrente, dialogo);
    expect(aFrente.foiImpedido()).toBe(false);
    expect(document.activeElement).toBe(id("b"));

    const paraTras = evento({ shiftKey: true });
    conterTabNoDialogo(paraTras, dialogo);
    expect(paraTras.foiImpedido()).toBe(false);
  });

  it("Tab no primeiro e Shift+Tab no último também seguem livres", () => {
    id("a").focus();
    const e1 = evento();
    conterTabNoDialogo(e1, dialogo);
    expect(e1.foiImpedido()).toBe(false);

    id("c").focus();
    const e2 = evento({ shiftKey: true });
    conterTabNoDialogo(e2, dialogo);
    expect(e2.foiImpedido()).toBe(false);
  });

  it("foco fora da janela é puxado para dentro: Tab ao primeiro, Shift+Tab ao último", () => {
    fora.focus();
    const e1 = evento();
    conterTabNoDialogo(e1, dialogo);
    expect(e1.foiImpedido()).toBe(true);
    expect(document.activeElement).toBe(id("a"));

    fora.focus();
    const e2 = evento({ shiftKey: true });
    conterTabNoDialogo(e2, dialogo);
    expect(e2.foiImpedido()).toBe(true);
    expect(document.activeElement).toBe(id("c"));
  });

  it("foco na própria janela (sem controle) também entra pelo primeiro ou pelo último", () => {
    dialogo.focus();
    const e1 = evento();
    conterTabNoDialogo(e1, dialogo);
    expect(e1.foiImpedido()).toBe(true);
    expect(document.activeElement).toBe(id("a"));

    dialogo.focus();
    const e2 = evento({ shiftKey: true });
    conterTabNoDialogo(e2, dialogo);
    expect(document.activeElement).toBe(id("c"));
  });

  it("outra tecla, ou evento já tratado por quem veio antes, não mexe em nada", () => {
    id("c").focus();
    const enter = evento({ key: "Enter" });
    conterTabNoDialogo(enter, dialogo);
    expect(enter.foiImpedido()).toBe(false);
    expect(document.activeElement).toBe(id("c"));

    const tratado = evento({ defaultPrevented: true });
    conterTabNoDialogo(tratado, dialogo);
    expect(tratado.foiImpedido()).toBe(false);
    expect(document.activeElement).toBe(id("c"));
  });
});

describe("conterTabNoDialogo: o que não entra no ciclo", () => {
  it("janela sem nenhum controle: o Tab é impedido e o foco fica na janela", () => {
    montar("<p>Só texto</p>");
    fora.focus();
    const e = evento();
    conterTabNoDialogo(e, dialogo);
    expect(e.foiImpedido()).toBe(true);
    expect(document.activeElement).toBe(dialogo);
  });

  it("desligado, escondido, inerte, invisível, hidden e fora da sequência não contam", () => {
    montar(`
      <button id="um">1</button>
      <button id="desligado" disabled>x</button>
      <input id="oculto" type="hidden" />
      <div hidden><button id="no-hidden">x</button></div>
      <div inert><button id="no-inert">x</button></div>
      <button id="sem-display" style="display:none">x</button>
      <button id="sem-visibilidade" style="visibility:hidden">x</button>
      <button id="fora-da-sequencia" tabindex="-1">x</button>
      <button id="dois">2</button>
    `);
    const ids = controlesDoDialogo(dialogo).map((c) => c.id);
    expect(ids).toEqual(["um", "dois"]);

    // O ciclo usa só os dois que contam: Tab no "2" volta ao "1".
    id("dois").focus();
    const e = evento();
    conterTabNoDialogo(e, dialogo);
    expect(document.activeElement).toBe(id("um"));
  });

  it("link com href, campo de texto, select e textarea entram; âncora sem href não", () => {
    montar(`
      <a id="link" href="#x">l</a>
      <a id="ancora">sem href</a>
      <select id="sel"><option>1</option></select>
      <textarea id="area"></textarea>
    `);
    expect(controlesDoDialogo(dialogo).map((c) => c.id)).toEqual([
      "link",
      "sel",
      "area",
    ]);
  });
});

// @vitest-environment jsdom
// Tab dentro de um diálogo do painel: o foco dá a volta (último -> primeiro,
// Shift+Tab no primeiro -> último), nunca escapa para a página por trás, e
// controles desabilitados/escondidos/inertes não entram na sequência. A função
// não tinha teste próprio.
import {
  conterTabNoDialogo,
  controlesDoDialogo,
} from "@/components/admin/primitivos/conterTabNoDialogo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fora: HTMLButtonElement;
let dialogo: HTMLDivElement;

function montar(html: string) {
  dialogo = document.createElement("div");
  dialogo.tabIndex = -1;
  dialogo.innerHTML = html;
  document.body.append(dialogo);
}

function tab(shiftKey = false, key = "Tab", defaultPrevented = false) {
  const preventDefault = vi.fn();
  conterTabNoDialogo(
    { key, shiftKey, defaultPrevented, preventDefault },
    dialogo,
  );
  return preventDefault;
}

const el = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  fora = document.createElement("button");
  fora.id = "fora";
  document.body.append(fora);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("controlesDoDialogo — quem entra na sequência do teclado", () => {
  it("lista botões, campos, links com href e tabindex, na ordem do documento", () => {
    montar(`
      <button id="a">a</button>
      <input id="b" />
      <select id="c"></select>
      <textarea id="d"></textarea>
      <a id="e" href="#x">e</a>
      <div id="f" tabindex="0">f</div>`);
    expect(controlesDoDialogo(dialogo).map((c) => c.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });

  it("deixa de fora desabilitado, hidden, tabindex negativo e link sem href", () => {
    montar(`
      <button id="ok">ok</button>
      <button id="desab" disabled>x</button>
      <input id="oculto" type="hidden" />
      <button id="neg" tabindex="-1">x</button>
      <a id="semhref">x</a>
      <fieldset disabled><input id="dentro" /></fieldset>`);
    expect(controlesDoDialogo(dialogo).map((c) => c.id)).toEqual(["ok"]);
  });

  it("deixa de fora o que está dentro de [hidden] ou [inert]", () => {
    montar(`
      <button id="ok">ok</button>
      <div hidden><button id="h">x</button></div>
      <div inert><button id="i">x</button></div>`);
    expect(controlesDoDialogo(dialogo).map((c) => c.id)).toEqual(["ok"]);
  });

  it("deixa de fora display:none e visibility:hidden", () => {
    montar(`
      <button id="ok">ok</button>
      <button id="dn" style="display:none">x</button>
      <button id="vh" style="visibility:hidden">x</button>`);
    expect(controlesDoDialogo(dialogo).map((c) => c.id)).toEqual(["ok"]);
  });

  it("div com tabindex=-1 (o próprio diálogo, painéis programáticos) não entra", () => {
    montar(`<div id="prog" tabindex="-1">x</div><button id="ok">ok</button>`);
    expect(controlesDoDialogo(dialogo).map((c) => c.id)).toEqual(["ok"]);
  });
});

describe("conterTabNoDialogo — a volta do foco", () => {
  beforeEach(() => {
    montar(`
      <button id="a">a</button>
      <input id="b" />
      <button id="c">c</button>`);
  });

  it("Tab no último volta ao primeiro e segura o Tab", () => {
    el("c").focus();
    const prevent = tab();
    expect(prevent).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(el("a"));
  });

  it("Shift+Tab no primeiro vai ao último e segura o Tab", () => {
    el("a").focus();
    const prevent = tab(true);
    expect(prevent).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(el("c"));
  });

  it("Tab no meio e Tab no primeiro: deixa o navegador andar (não segura)", () => {
    el("b").focus();
    expect(tab()).not.toHaveBeenCalled();
    el("a").focus();
    expect(tab()).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(el("a"));
  });

  it("Shift+Tab no meio e Shift+Tab no último: deixa o navegador andar", () => {
    el("b").focus();
    expect(tab(true)).not.toHaveBeenCalled();
    el("c").focus();
    expect(tab(true)).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(el("c"));
  });

  it("foco fora do diálogo (na página de trás): Tab puxa de volta ao primeiro", () => {
    fora.focus();
    const prevent = tab();
    expect(prevent).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(el("a"));
  });

  it("foco fora do diálogo com Shift+Tab: puxa para o último", () => {
    fora.focus();
    const prevent = tab(true);
    expect(prevent).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(el("c"));
  });

  it("foco no próprio diálogo: Tab vai ao primeiro, Shift+Tab ao último", () => {
    dialogo.focus();
    expect(document.activeElement).toBe(dialogo);
    expect(tab()).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(el("a"));
    dialogo.focus();
    expect(tab(true)).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(el("c"));
  });

  it("outra tecla não faz nada", () => {
    el("c").focus();
    expect(tab(false, "Enter")).not.toHaveBeenCalled();
    expect(tab(false, "ArrowDown")).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(el("c"));
  });

  it("evento já tratado por outro (defaultPrevented) não é mexido de novo", () => {
    el("c").focus();
    const prevent = tab(false, "Tab", true);
    expect(prevent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(el("c"));
  });
});

describe("conterTabNoDialogo — bordas", () => {
  it("diálogo sem nenhum controle: segura o Tab e põe o foco no próprio diálogo", () => {
    montar("<p>só texto</p>");
    fora.focus();
    const prevent = tab();
    expect(prevent).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(dialogo);
  });

  it("diálogo com um controle só: Tab e Shift+Tab ficam nele", () => {
    montar(`<button id="unico">x</button>`);
    el("unico").focus();
    expect(tab()).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(el("unico"));
    expect(tab(true)).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(el("unico"));
  });

  it("o último controle desabilitado não conta como 'último': o penúltimo fecha a volta", () => {
    montar(`
      <button id="a">a</button>
      <button id="b">b</button>
      <button id="c" disabled>c</button>`);
    el("b").focus();
    expect(tab()).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(el("a"));
  });
});

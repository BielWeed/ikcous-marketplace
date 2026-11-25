// @vitest-environment jsdom
//
// O teclado preso no diálogo do painel
// (`src/components/admin/primitivos/conterTabNoDialogo.ts`): quais controles
// entram na sequência do Tab e o que acontece nas bordas (último + Tab, primeiro
// + Shift+Tab, foco fora, diálogo sem controle nenhum). Os testes das telas só
// passam por aqui de longe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  conterTabNoDialogo,
  controlesDoDialogo,
} from "@/components/admin/primitivos/conterTabNoDialogo";

let raiz: HTMLElement;
let dialogo: HTMLElement;

function montar(html: string): HTMLElement {
  dialogo.innerHTML = html;
  return dialogo;
}

function evento(
  key: string,
  extras: { shiftKey?: boolean; defaultPrevented?: boolean } = {},
) {
  return {
    key,
    shiftKey: extras.shiftKey ?? false,
    defaultPrevented: extras.defaultPrevented ?? false,
    preventDefault: vi.fn(),
  };
}

function ids(lista: HTMLElement[]): string[] {
  return lista.map((e) => e.id);
}

beforeEach(() => {
  raiz = document.createElement("div");
  dialogo = document.createElement("div");
  dialogo.setAttribute("tabindex", "-1");
  dialogo.setAttribute("role", "dialog");
  raiz.appendChild(dialogo);
  document.body.appendChild(raiz);
});

afterEach(() => {
  raiz.remove();
});

describe("controlesDoDialogo", () => {
  it("lista botão, campo, seleção, área de texto, link com href e [tabindex], na ordem da tela", () => {
    montar(`
      <button id="b">b</button>
      <input id="i" />
      <select id="s"><option>1</option></select>
      <textarea id="t"></textarea>
      <a id="a" href="/x">a</a>
      <div id="d" tabindex="0">d</div>
    `);
    expect(ids(controlesDoDialogo(dialogo))).toEqual([
      "b",
      "i",
      "s",
      "t",
      "a",
      "d",
    ]);
  });

  it("link sem href e texto solto não entram", () => {
    montar(
      `<a id="a">sem href</a><span id="x">texto</span><button id="b">ok</button>`,
    );
    expect(ids(controlesDoDialogo(dialogo))).toEqual(["b"]);
  });

  it("tabindex negativo fica de fora (foco só por código); tabindex 0 e positivo entram", () => {
    montar(`
      <div id="menos" tabindex="-1"></div>
      <div id="zero" tabindex="0"></div>
      <div id="dois" tabindex="2"></div>
    `);
    expect(ids(controlesDoDialogo(dialogo))).toEqual(["zero", "dois"]);
  });

  it("controle desabilitado e campo hidden não fazem parte da sequência", () => {
    montar(`
      <button id="off" disabled>x</button>
      <input id="oculto" type="hidden" />
      <input id="texto" type="text" disabled />
      <input id="ok" type="text" />
    `);
    expect(ids(controlesDoDialogo(dialogo))).toEqual(["ok"]);
  });

  it("dentro de [hidden] ou [inert] não entra, nem filho de filho", () => {
    montar(`
      <div hidden><button id="h">h</button></div>
      <div inert><span><button id="n">n</button></span></div>
      <button id="ok">ok</button>
    `);
    expect(ids(controlesDoDialogo(dialogo))).toEqual(["ok"]);
  });

  it("display: none e visibility: hidden no próprio controle tiram da sequência", () => {
    montar(`
      <button id="sumido" style="display: none">x</button>
      <button id="invisivel" style="visibility: hidden">x</button>
      <button id="visivel" style="display: block; visibility: visible">x</button>
    `);
    expect(ids(controlesDoDialogo(dialogo))).toEqual(["visivel"]);
  });

  it("diálogo vazio devolve lista vazia", () => {
    montar("");
    expect(controlesDoDialogo(dialogo)).toEqual([]);
  });
});

describe("conterTabNoDialogo", () => {
  function tresBotoes() {
    montar(`
      <button id="a">a</button>
      <button id="b">b</button>
      <button id="c">c</button>
    `);
    return {
      a: dialogo.querySelector<HTMLElement>("#a") as HTMLElement,
      b: dialogo.querySelector<HTMLElement>("#b") as HTMLElement,
      c: dialogo.querySelector<HTMLElement>("#c") as HTMLElement,
    };
  }

  it("tecla que não é Tab não mexe em nada", () => {
    const { c } = tresBotoes();
    c.focus();
    const e = evento("Enter");
    conterTabNoDialogo(e, dialogo);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(c);
  });

  it("Tab que já foi tratado por outro (defaultPrevented) não é tratado de novo", () => {
    const { c } = tresBotoes();
    c.focus();
    const e = evento("Tab", { defaultPrevented: true });
    conterTabNoDialogo(e, dialogo);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(c);
  });

  it("Tab no ÚLTIMO controle volta ao primeiro", () => {
    const { a, c } = tresBotoes();
    c.focus();
    const e = evento("Tab");
    conterTabNoDialogo(e, dialogo);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(a);
  });

  it("Shift+Tab no PRIMEIRO controle vai ao último", () => {
    const { a, c } = tresBotoes();
    a.focus();
    const e = evento("Tab", { shiftKey: true });
    conterTabNoDialogo(e, dialogo);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(c);
  });

  it("Tab no primeiro e no do meio segue o caminho normal do navegador", () => {
    const { a, b } = tresBotoes();
    for (const el of [a, b]) {
      el.focus();
      const e = evento("Tab");
      conterTabNoDialogo(e, dialogo);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(el);
    }
  });

  it("Shift+Tab no último e no do meio segue o caminho normal do navegador", () => {
    const { b, c } = tresBotoes();
    for (const el of [b, c]) {
      el.focus();
      const e = evento("Tab", { shiftKey: true });
      conterTabNoDialogo(e, dialogo);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(el);
    }
  });

  it("foco FORA do diálogo: Tab puxa para o primeiro, Shift+Tab para o último", () => {
    const { a, c } = tresBotoes();
    const fora = document.createElement("button");
    raiz.appendChild(fora);

    fora.focus();
    const e1 = evento("Tab");
    conterTabNoDialogo(e1, dialogo);
    expect(e1.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(a);

    fora.focus();
    const e2 = evento("Tab", { shiftKey: true });
    conterTabNoDialogo(e2, dialogo);
    expect(e2.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(c);
  });

  it("foco no próprio diálogo (sem controle focado): Tab vai ao primeiro, Shift+Tab ao último", () => {
    const { a, c } = tresBotoes();

    dialogo.focus();
    expect(document.activeElement).toBe(dialogo);
    const e1 = evento("Tab");
    conterTabNoDialogo(e1, dialogo);
    expect(e1.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(a);

    dialogo.focus();
    const e2 = evento("Tab", { shiftKey: true });
    conterTabNoDialogo(e2, dialogo);
    expect(e2.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(c);
  });

  it("um controle só: Tab e Shift+Tab ficam nele", () => {
    montar(`<button id="unico">x</button>`);
    const unico = dialogo.querySelector<HTMLElement>("#unico") as HTMLElement;

    unico.focus();
    const e1 = evento("Tab");
    conterTabNoDialogo(e1, dialogo);
    expect(e1.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(unico);

    const e2 = evento("Tab", { shiftKey: true });
    conterTabNoDialogo(e2, dialogo);
    expect(e2.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(unico);
  });

  it("diálogo sem controle nenhum: segura o Tab e põe o foco no próprio diálogo", () => {
    montar("<p>só texto</p><button disabled>x</button>");
    const fora = document.createElement("button");
    raiz.appendChild(fora);
    fora.focus();

    const e = evento("Tab");
    conterTabNoDialogo(e, dialogo);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(dialogo);
  });

  it("controle escondido não conta como 'último': o último visível é que vira a borda", () => {
    montar(`
      <button id="a">a</button>
      <button id="b">b</button>
      <button id="c" disabled>c</button>
      <button id="d" style="display: none">d</button>
    `);
    const a = dialogo.querySelector<HTMLElement>("#a") as HTMLElement;
    const b = dialogo.querySelector<HTMLElement>("#b") as HTMLElement;
    b.focus();
    const e = evento("Tab");
    conterTabNoDialogo(e, dialogo);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(a);
  });
});

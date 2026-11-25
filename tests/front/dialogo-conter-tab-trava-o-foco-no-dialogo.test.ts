// @vitest-environment jsdom
// O Tab dentro de um diálogo do painel (devoluções, formulário de produto) não
// pode escapar para a página de trás: no último controle volta ao primeiro, no
// primeiro com Shift volta ao último, e fora do diálogo ele puxa o foco para
// dentro. Nenhum teste citava `conterTabNoDialogo`/`controlesDoDialogo`; este
// arquivo prende a sequência do teclado e o filtro do que NÃO entra nela
// (desabilitado, hidden, inert, display:none, visibility:hidden, tabindex<0).
import {
  conterTabNoDialogo,
  controlesDoDialogo,
} from "@/components/admin/primitivos/conterTabNoDialogo";
import { afterEach, describe, expect, it, vi } from "vitest";

function montar(html: string): HTMLElement {
  const dialogo = document.createElement("div");
  dialogo.setAttribute("tabindex", "-1");
  dialogo.innerHTML = html;
  document.body.append(dialogo);
  return dialogo;
}

function evento(
  chave: string,
  extra: { shiftKey?: boolean; defaultPrevented?: boolean } = {},
) {
  return {
    key: chave,
    shiftKey: extra.shiftKey ?? false,
    defaultPrevented: extra.defaultPrevented ?? false,
    preventDefault: vi.fn(),
  };
}

const q = (dialogo: HTMLElement, id: string) =>
  dialogo.querySelector<HTMLElement>(`#${id}`) as HTMLElement;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("conterTabNoDialogo — a sequência do teclado fica dentro do diálogo", () => {
  const TRES = `<button id="a">A</button><button id="b">B</button><button id="c">C</button>`;

  it("Tab no último controle volta ao primeiro e segura o Tab do navegador", () => {
    const dialogo = montar(TRES);
    q(dialogo, "c").focus();
    const e = evento("Tab");
    conterTabNoDialogo(e, dialogo);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(q(dialogo, "a"));
  });

  it("Shift+Tab no primeiro controle vai ao último", () => {
    const dialogo = montar(TRES);
    q(dialogo, "a").focus();
    const e = evento("Tab", { shiftKey: true });
    conterTabNoDialogo(e, dialogo);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(q(dialogo, "c"));
  });

  it("no meio da sequência o navegador anda sozinho: nada é seguro nem movido", () => {
    const dialogo = montar(TRES);
    q(dialogo, "b").focus();
    for (const shiftKey of [false, true]) {
      const e = evento("Tab", { shiftKey });
      conterTabNoDialogo(e, dialogo);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(q(dialogo, "b"));
    }
  });

  it("Tab no PRIMEIRO e Shift+Tab no ÚLTIMO são passos normais (só a ponta contrária vira)", () => {
    const dialogo = montar(TRES);
    q(dialogo, "a").focus();
    const adiante = evento("Tab");
    conterTabNoDialogo(adiante, dialogo);
    expect(adiante.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(q(dialogo, "a"));

    q(dialogo, "c").focus();
    const atras = evento("Tab", { shiftKey: true });
    conterTabNoDialogo(atras, dialogo);
    expect(atras.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(q(dialogo, "c"));
  });

  it("foco fora do diálogo: Tab puxa para o primeiro, Shift+Tab para o último", () => {
    const dialogo = montar(TRES);
    const fora = document.createElement("button");
    document.body.append(fora);
    fora.focus();

    const adiante = evento("Tab");
    conterTabNoDialogo(adiante, dialogo);
    expect(adiante.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(q(dialogo, "a"));

    fora.focus();
    const atras = evento("Tab", { shiftKey: true });
    conterTabNoDialogo(atras, dialogo);
    expect(atras.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(q(dialogo, "c"));
  });

  it("foco no próprio contêiner do diálogo (tabindex -1): Tab vai ao primeiro, Shift+Tab ao último", () => {
    const dialogo = montar(TRES);
    dialogo.focus();
    expect(document.activeElement).toBe(dialogo);

    const adiante = evento("Tab");
    conterTabNoDialogo(adiante, dialogo);
    expect(adiante.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(q(dialogo, "a"));

    dialogo.focus();
    const atras = evento("Tab", { shiftKey: true });
    conterTabNoDialogo(atras, dialogo);
    expect(atras.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(q(dialogo, "c"));
  });

  it("outra tecla e evento já tratado por outro handler não mexem em nada", () => {
    const dialogo = montar(TRES);
    q(dialogo, "c").focus();
    const enter = evento("Enter");
    conterTabNoDialogo(enter, dialogo);
    expect(enter.preventDefault).not.toHaveBeenCalled();

    const jaTratado = evento("Tab", { defaultPrevented: true });
    conterTabNoDialogo(jaTratado, dialogo);
    expect(jaTratado.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(q(dialogo, "c"));
  });

  it("um controle só: Tab e Shift+Tab ficam nele (primeiro = último)", () => {
    const dialogo = montar(`<button id="so">Só</button>`);
    q(dialogo, "so").focus();
    for (const shiftKey of [false, true]) {
      const e = evento("Tab", { shiftKey });
      conterTabNoDialogo(e, dialogo);
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(q(dialogo, "so"));
    }
  });

  it("sem nenhum controle utilizável: segura o Tab e leva o foco ao próprio diálogo", () => {
    const dialogo = montar("<button disabled>X</button><span>texto</span>");
    const e = evento("Tab");
    conterTabNoDialogo(e, dialogo);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(dialogo);
  });
});

describe("controlesDoDialogo — o que entra e o que fica fora da sequência", () => {
  it("entra: botão, campo, select, textarea, link com href e div com tabindex=0", () => {
    const dialogo = montar(
      `<button id="b1"></button><input id="i1"><select id="s1"></select><textarea id="t1"></textarea><a id="l1" href="#x"></a><div id="d1" tabindex="0"></div>`,
    );
    expect(controlesDoDialogo(dialogo).map((c) => c.id)).toEqual([
      "b1",
      "i1",
      "s1",
      "t1",
      "l1",
      "d1",
    ]);
  });

  const FORA: ReadonlyArray<readonly [string, string]> = [
    ["botão desabilitado", `<button id="x" disabled></button>`],
    ["campo desabilitado", `<input id="x" disabled>`],
    ["input hidden", `<input id="x" type="hidden">`],
    ["tabindex negativo", `<button id="x" tabindex="-1"></button>`],
    ["link sem href", `<a id="x">sem href</a>`],
    ["dentro de [hidden]", `<div hidden><button id="x"></button></div>`],
    ["dentro de [inert]", `<div inert><button id="x"></button></div>`],
    ["display:none", `<button id="x" style="display: none"></button>`],
    [
      "visibility:hidden",
      `<button id="x" style="visibility: hidden"></button>`,
    ],
  ];

  it.each(FORA)(
    "%s não entra na sequência — e por isso o Tab do último VISÍVEL ainda dá a volta",
    (_nome, excluido) => {
      const dialogo = montar(
        `<button id="a"></button><button id="b"></button>${excluido}`,
      );
      expect(controlesDoDialogo(dialogo).map((c) => c.id)).toEqual(["a", "b"]);

      q(dialogo, "b").focus();
      const e = evento("Tab");
      conterTabNoDialogo(e, dialogo);
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(q(dialogo, "a"));
    },
  );

  it.each(FORA)(
    "%s no INÍCIO também não vira o 'primeiro' do Shift+Tab",
    (_nome, excluido) => {
      const dialogo = montar(
        `${excluido}<button id="a"></button><button id="b"></button>`,
      );
      q(dialogo, "a").focus();
      const e = evento("Tab", { shiftKey: true });
      conterTabNoDialogo(e, dialogo);
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(q(dialogo, "b"));
    },
  );
});

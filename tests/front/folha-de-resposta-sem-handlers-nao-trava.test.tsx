// @vitest-environment jsdom
//
// A pergunta de descarte da folha de resposta só existe com os DOIS handlers.
// `perguntandoDescarte` sozinho (sem `aoContinuarEditando`/`aoDescartar`) não
// pode deixar a folha travada: sem pergunta na tela, sem `inert` no fundo, e
// Esc volta a fechar pela via normal (`aoFechar`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FolhaDeResposta } from "@/components/admin/atendimento/FolhaDeResposta";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("FolhaDeResposta — perguntandoDescarte sem handlers não trava", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const aoFechar = vi.fn();

  beforeEach(() => {
    aoFechar.mockClear();
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderizar(extra: Record<string, unknown>) {
    act(() => {
      raiz.render(
        <FolhaDeResposta
          aberta
          aoFechar={aoFechar}
          cliente="Cliente Teste"
          produto="Produto de Teste"
          pergunta="Tem em estoque?"
          resposta="rascunho"
          aoMudarResposta={() => {}}
          aoPublicar={() => {}}
          enviando={false}
          semConexao={false}
          {...extra}
        />,
      );
    });
  }

  const esc = () =>
    act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

  it("sem handlers: sem pergunta, sem inert, e Esc fecha pela via normal", async () => {
    renderizar({ perguntandoDescarte: true });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    await esc();
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("controle: com os dois handlers a pergunta aparece dentro da folha, o fundo fica inerte e Esc só continua editando", async () => {
    const aoContinuarEditando = vi.fn();
    const aoDescartar = vi.fn();
    renderizar({
      perguntandoDescarte: true,
      aoContinuarEditando,
      aoDescartar,
    });
    const folha = document.querySelector('[data-slot="sheet-content"]');
    const pergunta = document.querySelector('[role="alertdialog"]');
    expect(folha).toBeTruthy();
    expect(pergunta).toBeTruthy();
    expect(folha?.contains(pergunta)).toBe(true);
    expect(document.querySelector("[inert]")).toBeTruthy();
    await esc();
    expect(aoContinuarEditando).toHaveBeenCalledTimes(1);
    expect(aoDescartar).not.toHaveBeenCalled();
    expect(aoFechar).not.toHaveBeenCalled();
  });
});

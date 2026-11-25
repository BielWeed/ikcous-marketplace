// @vitest-environment jsdom
//
// PerguntaDeDescarte (atendimento do painel): a pergunta "Descartar o que você
// escreveu?" que abre por cima da folha. A lógica própria dela é o FOCO:
//   - ao abrir, o foco vai para "Continuar editando" (o botão seguro — Enter
//     sem querer não apaga o que foi digitado);
//   - ao fechar, o foco volta para onde estava, se esse lugar ainda existe;
//     se o elemento já saiu da tela (foi removido), não tenta focar nada;
//   - cada botão chama a sua ação, uma vez, e só ela.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PerguntaDeDescarte } from "@/components/admin/atendimento/PerguntaDeDescarte";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("PerguntaDeDescarte — foco e botões", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let origem: HTMLButtonElement;

  beforeEach(() => {
    origem = document.createElement("button");
    origem.textContent = "abrir pergunta";
    document.body.appendChild(origem);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    origem.remove();
  });

  const botao = (rotulo: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === rotulo,
    );

  function Casca({
    aoContinuar = () => {},
    aoDescartar = () => {},
  }: {
    aoContinuar?: () => void;
    aoDescartar?: () => void;
  }) {
    const [aberta, setAberta] = useState(true);
    return aberta ? (
      <PerguntaDeDescarte
        aoContinuar={() => {
          aoContinuar();
          setAberta(false);
        }}
        aoDescartar={aoDescartar}
      />
    ) : null;
  }

  function abrir(props: Parameters<typeof Casca>[0] = {}) {
    origem.focus();
    act(() => {
      raiz.render(<Casca {...props} />);
    });
  }

  it("ao abrir, o foco vai para 'Continuar editando' (e não para 'Descartar')", () => {
    abrir();
    expect(document.activeElement).toBe(botao("Continuar editando"));
    expect(document.activeElement).not.toBe(botao("Descartar"));
  });

  it("é um diálogo de alerta modal ligado ao título e ao texto", () => {
    abrir();
    const dialogo = hospedeiro.querySelector('[role="alertdialog"]');
    expect(dialogo?.getAttribute("aria-modal")).toBe("true");
    const titulo = hospedeiro.querySelector(
      `#${dialogo?.getAttribute("aria-labelledby")}`,
    );
    const texto = hospedeiro.querySelector(
      `#${dialogo?.getAttribute("aria-describedby")}`,
    );
    expect(titulo?.textContent).toBe("Descartar o que você escreveu?");
    expect(texto?.textContent).toContain("será perdido");
  });

  it("ao fechar, o foco volta para o lugar de onde veio", () => {
    abrir();
    expect(document.activeElement).not.toBe(origem);
    act(() => {
      botao("Continuar editando")?.click();
    });
    expect(hospedeiro.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(origem);
  });

  it("se o lugar de origem já saiu da tela, não tenta focar nada (sem erro)", () => {
    abrir();
    origem.remove();
    expect(() => {
      act(() => {
        raiz.unmount();
      });
    }).not.toThrow();
    // O foco não foi para o elemento solto.
    expect(document.activeElement).not.toBe(origem);
    raiz = createRoot(hospedeiro);
  });

  it("cada botão chama só a sua ação, uma vez", () => {
    const continuar = vi.fn();
    const descartar = vi.fn();
    abrir({ aoContinuar: continuar, aoDescartar: descartar });
    act(() => {
      botao("Descartar")?.click();
    });
    expect(descartar).toHaveBeenCalledTimes(1);
    expect(continuar).not.toHaveBeenCalled();
    act(() => {
      botao("Continuar editando")?.click();
    });
    expect(continuar).toHaveBeenCalledTimes(1);
    expect(descartar).toHaveBeenCalledTimes(1);
  });
});

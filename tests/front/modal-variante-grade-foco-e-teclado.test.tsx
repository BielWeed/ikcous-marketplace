// @vitest-environment jsdom
import { ModalVarianteGrade } from "@/components/admin/products/ModalVarianteGrade";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ModalVarianteGrade — foco e teclado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let origem: HTMLButtonElement;
  const fechar = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    origem = document.createElement("button");
    origem.textContent = "+ Grade";
    document.body.append(origem, hospedeiro);
    raiz = createRoot(hospedeiro);
    origem.focus();
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    origem.remove();
  });

  async function renderizar(aberto = true) {
    await act(async () => {
      raiz.render(
        <ModalVarianteGrade
          aberto={aberto}
          onFechar={fechar}
          variantesExistentes={[]}
          sugestoesDeAtributo={["Cor", "Tamanho"]}
          grupoUnicoEmUso={null}
          skusDaLoja={[]}
          precoDoProduto="100"
          onEfetivar={() => true}
        />,
      );
    });
  }

  function dialogo() {
    const elemento = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!elemento) throw new Error("Diálogo ausente");
    return elemento;
  }

  async function tecla(elemento: HTMLElement, key: string, shiftKey = false) {
    const evento = new KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      elemento.dispatchEvent(evento);
    });
    return evento;
  }

  it("leva o foco do botão de origem para o diálogo ao abrir", async () => {
    await renderizar(false);
    expect(document.activeElement).toBe(origem);
    await renderizar();
    expect(document.activeElement).toBe(dialogo());
  });

  it("prende Tab e Shift+Tab entre os controles habilitados do diálogo", async () => {
    await renderizar();
    const controles = [
      ...dialogo().querySelectorAll<HTMLElement>(
        "button, input, select, textarea",
      ),
    ].filter((elemento) => !elemento.matches(":disabled"));
    const primeiro = controles.at(0);
    const ultimo = controles.at(-1);
    if (!primeiro || !ultimo) throw new Error("Controles ausentes");
    await act(async () => ultimo.focus());
    expect((await tecla(ultimo, "Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(primeiro);
    expect((await tecla(primeiro, "Tab", true)).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(ultimo);
  });

  it("Escape usa o mesmo callback de Cancelar uma única vez", async () => {
    await renderizar();
    await tecla(dialogo(), "Escape");
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it.each(["fechar", "desmontar"])(
    "devolve o foco à origem ao %s",
    async (modo) => {
      await renderizar();
      dialogo().querySelector("input")?.focus();
      expect(document.activeElement).not.toBe(origem);
      if (modo === "fechar") await renderizar(false);
      else await act(async () => raiz.render(null));
      expect(document.activeElement).toBe(origem);
    },
  );
});

// @vitest-environment jsdom
//
// GRADE DE VARIAÇÕES — a tecla Esc não pode jogar fora, calada, a grade que a
// lojista já montou. Antes o Esc chamava `onFechar` direto e a próxima abertura
// limpava linhas, estoque, preço e código: uma grade inteira digitada sumia com
// um Esc sem querer (ou o Esc que fecharia um menu).
//
// Regra: sem nada digitado/gerado, o Esc fecha direto como sempre; com algo que
// seria perdido, o Esc pergunta "Descartar?" (a janela do app, a mesma de
// "Descartar a resposta?"). Os botões Cancelar/fechar continuam diretos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalVarianteGrade } from "@/components/admin/products/ModalVarianteGrade";
import { BOTAO_GERAR_GRADE, casaOTexto } from "./helpers/gerar-grade";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fechar = vi.fn();

function montar() {
  act(() => {
    root.render(
      <ModalVarianteGrade
        aberto
        onFechar={fechar}
        variantesExistentes={[]}
        sugestoesDeAtributo={[]}
        grupoUnicoEmUso={null}
        skusDaLoja={[]}
        precoDoProduto=""
        onEfetivar={() => true}
      />,
    );
  });
}

function campo<T extends HTMLElement = HTMLInputElement>(seletor: string): T {
  const el = document.body.querySelector<T>(seletor);
  if (!el) throw new Error(`campo não achado: ${seletor}`);
  return el;
}

function botao(texto: string | RegExp): HTMLButtonElement {
  const achado = [...document.body.querySelectorAll("button")].find((b) =>
    casaOTexto(b.textContent, texto),
  );
  if (!achado) throw new Error(`botão não achado: ${texto}`);
  return achado;
}

function clicar(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

/** Digita como a lojista: foca, escreve (o React vê o `input`) e sai do campo. */
function digitar(el: HTMLInputElement, valor: string) {
  act(() => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    el.blur();
  });
}

function esc(alvo: HTMLElement) {
  act(() => {
    alvo.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

const dialogoDaGrade = () =>
  campo<HTMLElement>("#titulo-da-grade").closest(
    '[role="dialog"]',
  ) as HTMLElement;
const pergunta = () => document.body.querySelector('[role="alertdialog"]');

/** Passo 1 → passo 2 com as três combinações P, M, G (atributo "Tamanho"). */
function irParaOPasso2() {
  clicar(botao("Tamanho"));
  for (const valor of ["P", "M", "G"]) {
    digitar(campo("#grade-valor-0"), valor);
    clicar(
      campo<HTMLButtonElement>(
        "button[aria-label='Adicionar valor do atributo 1']",
      ),
    );
  }
  clicar(botao(BOTAO_GERAR_GRADE));
}

beforeEach(() => {
  fechar.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("grade — Esc não descarta o que foi digitado", () => {
  it("(a) grade vazia: Esc fecha direto, sem pergunta", () => {
    montar();
    esc(dialogoDaGrade());

    expect(fechar).toHaveBeenCalledTimes(1);
    expect(pergunta()).toBeNull();
  });

  it("(b) grade gerada e preenchida: Esc NÃO fecha, pergunta antes", () => {
    montar();
    irParaOPasso2();
    digitar(campo('input[aria-label="Estoque de M"]'), "7");
    esc(dialogoDaGrade());

    expect(fechar).not.toHaveBeenCalled();
    expect(pergunta()).not.toBeNull();
    expect(pergunta()?.textContent).toContain("Descartar");
  });

  it("(b2) confirmar o descarte fecha a grade (uma vez)", () => {
    montar();
    irParaOPasso2();
    digitar(campo('input[aria-label="Estoque de M"]'), "7");
    esc(dialogoDaGrade());
    clicar(botao("Descartar"));

    expect(fechar).toHaveBeenCalledTimes(1);
    expect(pergunta()).toBeNull();
  });

  it("(b3) recusar (Continuar editando) mantém a grade aberta com os valores", () => {
    montar();
    irParaOPasso2();
    digitar(campo('input[aria-label="Estoque de M"]'), "7");
    esc(dialogoDaGrade());
    clicar(botao("Continuar editando"));

    expect(fechar).not.toHaveBeenCalled();
    expect(pergunta()).toBeNull();
    expect(campo('input[aria-label="Estoque de M"]').value).toBe("7");
  });

  it("(b4) Esc dentro da pergunta só fecha a pergunta: a grade continua", () => {
    montar();
    irParaOPasso2();
    digitar(campo('input[aria-label="Estoque de M"]'), "7");
    esc(dialogoDaGrade());
    expect(pergunta()).not.toBeNull();
    esc(pergunta() as HTMLElement);

    expect(fechar).not.toHaveBeenCalled();
    expect(pergunta()).toBeNull();
    expect(campo('input[aria-label="Estoque de M"]').value).toBe("7");
  });

  it("(c) só valores escolhidos no passo 1 (ainda sem gerar) também perguntam", () => {
    montar();
    clicar(botao("Tamanho"));
    digitar(campo("#grade-valor-0"), "P");
    clicar(
      campo<HTMLButtonElement>(
        "button[aria-label='Adicionar valor do atributo 1']",
      ),
    );
    esc(dialogoDaGrade());

    expect(fechar).not.toHaveBeenCalled();
    expect(pergunta()).not.toBeNull();
  });

  it("(d) o botão Cancelar continua direto, sem pergunta", () => {
    montar();
    irParaOPasso2();
    clicar(botao("Cancelar"));

    expect(fechar).toHaveBeenCalledTimes(1);
    expect(pergunta()).toBeNull();
  });
});

// @vitest-environment jsdom
//
// GRADE DE VARIAÇÕES, passo 1 — três bordas que as suítes vizinhas deixam:
//
// 1. Valor digitado duas vezes (mesmo com outra caixa) vira UMA peça, uma
//    marcação e um chip só: nunca "2 selecionados" para o mesmo valor.
// 2. A trava de um grupo por produto ("Este produto já usa Cor"): compara sem
//    olhar caixa; só vale quando a grade tem nome; recusa nome diferente.
// 3. O Esc pergunta antes de descartar quando há o que perder, e NÃO pergunta
//    por um campo só de espaços; trocar o tipo do atributo limpa o passo 1,
//    mas as linhas já geradas continuam sendo trabalho a perder.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalVarianteGrade } from "@/components/admin/products/ModalVarianteGrade";
import type { ProductVariant } from "@/types";
import { BOTAO_GERAR_GRADE, casaOTexto } from "./helpers/gerar-grade";

const { toast } = vi.hoisted(() => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fechar = vi.fn();

const existente = (name: string, value: string): ProductVariant => ({
  id: `v-${value}`,
  productId: "prod-1",
  name,
  value,
  stockIncrement: 0,
  active: true,
});

function montar(
  opcoes: {
    existentes?: ProductVariant[];
    grupoUnicoEmUso?: string | null;
  } = {},
) {
  act(() => {
    root.render(
      <ModalVarianteGrade
        aberto
        onFechar={fechar}
        variantesExistentes={opcoes.existentes ?? []}
        sugestoesDeAtributo={[]}
        grupoUnicoEmUso={opcoes.grupoUnicoEmUso ?? null}
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
    typeof texto === "string"
      ? (b.textContent ?? "").trim().startsWith(texto)
      : casaOTexto(b.textContent, texto),
  );
  if (!achado) throw new Error(`botão não achado: ${texto}`);
  return achado;
}

const temBotao = (texto: string) =>
  [...document.body.querySelectorAll("button")].some((b) =>
    (b.textContent ?? "").trim().startsWith(texto),
  );

function clicar(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

function digitar(el: HTMLInputElement, valor: string) {
  act(() => {
    el.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    el.blur();
  });
}

const adicionarValor = (valor: string) => {
  digitar(campo("#grade-valor-0"), valor);
  clicar(
    campo<HTMLButtonElement>(
      "button[aria-label='Adicionar valor do atributo 1']",
    ),
  );
};

function esc() {
  const dialogo = campo<HTMLElement>("#titulo-da-grade").closest(
    '[role="dialog"]',
  ) as HTMLElement;
  act(() => {
    dialogo.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
const pergunta = () => document.body.querySelector('[role="alertdialog"]');
const contagem = () =>
  document.body.querySelector('[data-testid="contagem-do-atributo"]')
    ?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("grade, passo 1 — valor digitado duas vezes", () => {
  it("'Sob medida' e depois 'sob MEDIDA': um chip, uma marcação, '1 selecionado'", () => {
    montar();
    clicar(botao("Tamanho"));
    adicionarValor("Sob medida");
    adicionarValor("sob MEDIDA");
    expect(
      document.body.querySelectorAll('[data-testid="chip-do-produto"]'),
    ).toHaveLength(1);
    expect(
      document.body.querySelectorAll('button[aria-label^="Tirar "]'),
    ).toHaveLength(1);
    expect(contagem()).toBe("1 selecionado");
  });

  it("o valor repetido não vira segunda opção na conta do resumo", () => {
    montar();
    clicar(botao("Tamanho"));
    adicionarValor("Sob medida");
    adicionarValor("Sob medida");
    expect(botao(BOTAO_GERAR_GRADE).textContent).toBe("Gerar 1 opção");
  });
});

describe("grade, passo 1 — um grupo de variação por produto", () => {
  it("nome da grade diferente do que o produto usa: recusa e fica no passo 1", () => {
    montar({ grupoUnicoEmUso: "Cor" });
    clicar(botao("Tamanho"));
    adicionarValor("P");
    clicar(botao(BOTAO_GERAR_GRADE));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0]?.[0]).toBe('Este produto já usa "Cor"');
    expect(temBotao("Salvar")).toBe(false);
  });

  it("mesmo nome com outra caixa ('cor' gravado, 'Cor' em uso): passa para o passo 2", () => {
    montar({
      existentes: [existente("cor", "Azul")],
      grupoUnicoEmUso: "Cor",
    });
    adicionarValor("Verde");
    clicar(botao(BOTAO_GERAR_GRADE));
    expect(toast.error).not.toHaveBeenCalled();
    expect(temBotao("Salvar 1 variação")).toBe(true);
  });

  it("grade sem nome de atributo: a trava não fala em 'já usa'; o aviso é o da própria grade", () => {
    montar({ grupoUnicoEmUso: "Cor" });
    clicar(botao("Outro"));
    adicionarValor("P");
    clicar(botao(BOTAO_GERAR_GRADE));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0]?.[0]).not.toBe(
      'Este produto já usa "Cor"',
    );
    expect(temBotao("Salvar")).toBe(false);
  });
});

describe("grade — Esc só pergunta quando há o que perder", () => {
  it("campo de valor só com espaços: Esc fecha direto", () => {
    montar();
    clicar(botao("Tamanho"));
    digitar(campo("#grade-valor-0"), "   ");
    esc();
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(pergunta()).toBeNull();
  });

  it("valor digitado e ainda não adicionado: Esc pergunta", () => {
    montar();
    clicar(botao("Tamanho"));
    digitar(campo("#grade-valor-0"), "P");
    esc();
    expect(fechar).not.toHaveBeenCalled();
    expect(pergunta()).not.toBeNull();
  });

  it("linhas já geradas, passo 1 esvaziado ao trocar o tipo: Esc ainda pergunta", () => {
    montar();
    clicar(botao("Tamanho"));
    for (const valor of ["P", "M", "G"]) adicionarValor(valor);
    clicar(botao(BOTAO_GERAR_GRADE));
    clicar(botao("← Voltar"));
    // Trocar de Tamanho para Cor limpa o que estava escolhido no passo 1.
    clicar(botao("Cor"));
    expect(contagem()).toBe("nenhuma selecionada");
    esc();
    expect(fechar).not.toHaveBeenCalled();
    expect(pergunta()).not.toBeNull();
  });
});

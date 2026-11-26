// @vitest-environment jsdom
//
// GRADE DE VARIAÇÕES — ABRIR É COMEÇAR LIMPO. O modal fica montado no
// formulário e só alterna `aberto`; o estado de uma abertura nunca pode vazar
// para a próxima:
//
// - depois de "Salvar N variações" aceito, a trava de duplo clique fecha; ao
//   reabrir, ela solta e a grade seguinte também salva;
// - o código base volta ao sugerido (não fica o que a lojista digitou antes);
// - as linhas geradas somem (o Esc de uma grade nova não pergunta por trabalho
//   que já foi embora);
// - o preço e o estoque digitados em "Aplicar para todas" e não aplicados não
//   reaparecem, nem o aviso de "valor segurado", na grade seguinte.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type LinhaProntaDaGrade,
  ModalVarianteGrade,
} from "@/components/admin/products/ModalVarianteGrade";
import { BOTAO_GERAR_GRADE, casaOTexto } from "./helpers/gerar-grade";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fechar = vi.fn();
const onEfetivar = vi.fn<
  (linhas: LinhaProntaDaGrade[], precoDoProduto?: number) => boolean
>(() => true);

function renderizar(aberto: boolean) {
  act(() => {
    root.render(
      <ModalVarianteGrade
        aberto={aberto}
        onFechar={fechar}
        variantesExistentes={[]}
        sugestoesDeAtributo={[]}
        grupoUnicoEmUso={null}
        skusDaLoja={[]}
        skuBaseSugerida="CAM"
        precoDoProduto="10.00"
        onEfetivar={onEfetivar}
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

function irParaOPasso2() {
  clicar(botao("Tamanho"));
  for (const valor of ["P", "M"]) {
    digitar(campo("#grade-valor-0"), valor);
    clicar(
      campo<HTMLButtonElement>(
        "button[aria-label='Adicionar valor do atributo 1']",
      ),
    );
  }
  clicar(botao(BOTAO_GERAR_GRADE));
}

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

const baseDoCodigo = () => campo("#grade-sku-base").value;
const precoParaTodas = () =>
  campo('input[aria-label="Preço para todas as linhas"]').value;
const estoqueParaTodas = () =>
  campo('input[aria-label="Estoque para todas as linhas"]').value;
const aviso = () =>
  document.body.querySelector('[data-testid="valor-segurado-aviso"]');

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

describe("grade — reabrir começa limpo", () => {
  it("depois de salvar, a próxima abertura também consegue salvar (a trava de duplo clique solta)", () => {
    renderizar(true);
    irParaOPasso2();
    clicar(botao("Salvar"));
    expect(onEfetivar).toHaveBeenCalledTimes(1);

    // Um segundo toque na MESMA abertura não entrega o lote de novo.
    clicar(botao("Salvar"));
    expect(onEfetivar).toHaveBeenCalledTimes(1);

    renderizar(false);
    renderizar(true);
    irParaOPasso2();
    clicar(botao("Salvar"));
    expect(onEfetivar).toHaveBeenCalledTimes(2);
  });

  it("o código base volta ao sugerido, não fica o que se digitou antes", () => {
    renderizar(true);
    irParaOPasso2();
    expect(baseDoCodigo()).toBe("CAM");
    digitar(campo("#grade-sku-base"), "OUTRO");
    expect(baseDoCodigo()).toBe("OUTRO");

    renderizar(false);
    renderizar(true);
    irParaOPasso2();
    expect(baseDoCodigo()).toBe("CAM");
  });

  it("as linhas geradas somem: o Esc da grade nova fecha direto, sem perguntar", () => {
    renderizar(true);
    irParaOPasso2();
    renderizar(false);
    renderizar(true);
    esc();
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("preço e estoque de 'Aplicar para todas' não aplicados não voltam na grade seguinte", () => {
    renderizar(true);
    irParaOPasso2();
    digitar(campo('input[aria-label="Preço para todas as linhas"]'), "5000");
    digitar(campo('input[aria-label="Estoque para todas as linhas"]'), "9");
    expect(precoParaTodas()).not.toBe("");
    expect(estoqueParaTodas()).toBe("9");
    expect(aviso()).not.toBeNull();

    renderizar(false);
    renderizar(true);
    irParaOPasso2();
    expect(precoParaTodas()).toBe("");
    expect(estoqueParaTodas()).toBe("");
    expect(aviso()).toBeNull();
  });
});

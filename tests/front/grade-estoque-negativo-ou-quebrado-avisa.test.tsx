// @vitest-environment jsdom
//
// GRADE DE VARIANTES — estoque negativo ou quebrado avisa e NÃO cria/aplica.
// Antes o menos era arrancado em silêncio ("-5" nascia com estoque 5) e
// "2.5" virava 25. Mesma regra e mesmas frases do formulário comum de variação.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type LinhaProntaDaGrade,
  ModalVarianteGrade,
} from "@/components/admin/products/ModalVarianteGrade";

const { toastErro } = vi.hoisted(() => ({ toastErro: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: toastErro,
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NEGATIVO =
  "O estoque da variação não pode ser negativo. Digite 0 ou mais.";
const QUEBRADO =
  "Digite o estoque da variação só com números inteiros (sem vírgula nem ponto).";

let container: HTMLDivElement;
let root: Root;
const onEfetivar = vi.fn<
  (linhas: LinhaProntaDaGrade[], precoDoProduto?: number) => boolean
>(() => true);

function campo<T extends HTMLElement = HTMLInputElement>(seletor: string): T {
  const el = document.body.querySelector<T>(seletor);
  if (!el) throw new Error(`campo não achado: ${seletor}`);
  return el;
}
const porRotulo = (rotulo: string) => campo(`input[aria-label="${rotulo}"]`);

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
function botao(texto: string): HTMLButtonElement {
  const achado = [...document.body.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").trim().startsWith(texto),
  );
  if (!achado) throw new Error(`botão não achado: ${texto}`);
  return achado;
}
const clicar = (el: HTMLElement) =>
  act(() => {
    el.click();
  });

function abrirNoPasso2() {
  act(() => {
    root.render(
      <ModalVarianteGrade
        aberto
        onFechar={() => {}}
        variantesExistentes={[]}
        sugestoesDeAtributo={[]}
        grupoUnicoEmUso={null}
        skusDaLoja={[]}
        precoDoProduto="10.00"
        onEfetivar={onEfetivar}
      />,
    );
  });
  digitar(campo("#grade-nome-0"), "Tamanho");
  for (const valor of ["P", "M", "G"]) {
    digitar(campo("#grade-valor-0"), valor);
    clicar(
      campo<HTMLButtonElement>(
        "button[aria-label='Adicionar valor do atributo 1']",
      ),
    );
  }
  clicar(botao("Gerar grade"));
}

const entregue = () => onEfetivar.mock.calls.at(-1)?.[0] ?? [];

beforeEach(() => {
  onEfetivar.mockClear();
  toastErro.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("grade — estoque inválido na linha", () => {
  it.each([
    ["-5", NEGATIVO],
    ["2.5", QUEBRADO],
    ["1e3", QUEBRADO],
  ])("%s avisa e não cria", (digitado, frase) => {
    abrirNoPasso2();
    digitar(porRotulo("Estoque de P"), digitado);
    clicar(botao("Salvar"));
    expect(toastErro).toHaveBeenCalledWith(frase);
    expect(onEfetivar).not.toHaveBeenCalled();
  });

  it("5 e 0 continuam valendo", () => {
    abrirNoPasso2();
    digitar(porRotulo("Estoque de P"), "5");
    digitar(porRotulo("Estoque de M"), "0");
    clicar(botao("Salvar"));
    expect(toastErro).not.toHaveBeenCalled();
    expect(entregue().map((l) => l.stockIncrement)).toEqual([5, 0, 0]);
  });
});

describe("grade — estoque inválido em Aplicar para todas", () => {
  it.each([
    ["-5", NEGATIVO],
    ["2.5", QUEBRADO],
  ])("%s avisa e não aplica", (digitado, frase) => {
    abrirNoPasso2();
    digitar(porRotulo("Estoque para todas as linhas"), digitado);
    clicar(botao("Aplicar para todas"));
    expect(toastErro).toHaveBeenCalledWith(frase);
    expect(porRotulo("Estoque de P").value).toBe("0");
    // Nem sai pelo valor segurado ao salvar.
    clicar(botao("Salvar"));
    expect(onEfetivar).not.toHaveBeenCalled();
  });

  it("5 aplica em todas", () => {
    abrirNoPasso2();
    digitar(porRotulo("Estoque para todas as linhas"), "5");
    clicar(botao("Aplicar para todas"));
    expect(porRotulo("Estoque de G").value).toBe("5");
    expect(toastErro).not.toHaveBeenCalled();
  });
});

describe("grade — estoque inválido em Aplicar para todas, sem apertar Aplicar", () => {
  const DICA = expect.stringContaining('"Aplicar para todas"');

  it.each([
    ["-5", NEGATIVO],
    ["2.5", QUEBRADO],
  ])(
    "%s ao Salvar: a frase é a mesma e o aviso diz QUAL campo está errado",
    (digitado, frase) => {
      abrirNoPasso2();
      digitar(porRotulo("Estoque para todas as linhas"), digitado);
      clicar(botao("Salvar"));
      expect(toastErro).toHaveBeenCalledWith(
        frase,
        expect.objectContaining({ description: DICA }),
      );
      expect(onEfetivar).not.toHaveBeenCalled();
    },
  );

  it("erro numa linha (não no Aplicar para todas) segue sem apontar para o Aplicar", () => {
    abrirNoPasso2();
    digitar(porRotulo("Estoque de P"), "-5");
    clicar(botao("Salvar"));
    expect(toastErro).toHaveBeenCalledWith(NEGATIVO);
  });
});

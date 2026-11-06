// @vitest-environment jsdom
//
// Grade de variações, passo 2: "Aplicar para todas" com os dois campos vazios
// (ou com preço 0,00 e sem estoque) não muda nada nas linhas, mas o aviso
// dizia "Aplicado para as N linhas". Agora a lojista recebe a dica do que
// digitar e o aviso de "Aplicado" não aparece.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type LinhaProntaDaGrade,
  ModalVarianteGrade,
} from "@/components/admin/products/ModalVarianteGrade";
import { BOTAO_GERAR_GRADE, casaOTexto } from "./helpers/gerar-grade";

const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    info: toastInfo,
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function irParaOPasso2() {
  act(() => {
    root.render(
      <ModalVarianteGrade
        aberto
        onFechar={() => {}}
        variantesExistentes={[]}
        sugestoesDeAtributo={[]}
        grupoUnicoEmUso={null}
        skusDaLoja={[]}
        precoDoProduto=""
        onEfetivar={onEfetivar}
      />,
    );
  });
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

const porRotulo = (rotulo: string) =>
  campo<HTMLInputElement>(`input[aria-label="${rotulo}"]`);

const avisosDeAplicado = () =>
  toastInfo.mock.calls.filter((c) => String(c[0]).startsWith("Aplicado"));

beforeEach(() => {
  toastInfo.mockClear();
  onEfetivar.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("grade — Aplicar para todas sem nada para aplicar", () => {
  it("com estoque e preço vazios não diz 'Aplicado' e dá a dica do que digitar", () => {
    irParaOPasso2();
    clicar(botao("Aplicar para todas"));

    expect(avisosDeAplicado()).toHaveLength(0);
    expect(toastInfo).toHaveBeenCalledWith(
      "Digite um estoque ou um preço maior que zero para aplicar.",
    );
  });

  it("com preço 0,00 e sem estoque também não diz 'Aplicado'", () => {
    irParaOPasso2();
    digitar(porRotulo("Preço para todas as linhas"), "0");
    clicar(botao("Aplicar para todas"));

    expect(avisosDeAplicado()).toHaveLength(0);
  });

  it("com um estoque digitado aplica e avisa como antes", () => {
    irParaOPasso2();
    digitar(porRotulo("Estoque para todas as linhas"), "4");
    clicar(botao("Aplicar para todas"));

    expect(avisosDeAplicado()).toHaveLength(1);
    expect(String(avisosDeAplicado()[0][0])).toContain("Aplicado para as 2");
  });
});

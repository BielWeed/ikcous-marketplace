// @vitest-environment jsdom
//
// GRADE DE VARIANTES — o CÓDIGO INTERNO (SKU) na hora de "Salvar N variações".
// O código é único em TODA a loja no banco (`product_variants_sku_key`): um
// repetido derruba o lote inteiro com erro genérico. Por isso o modal confere
// ANTES de entregar as linhas ao formulário, contra duas listas:
//   - os códigos da loja inteira (`skusDaLoja`), e
//   - os códigos das variações que ESTE produto já tem (inclusive as desligadas).
// A conferência ignora caixa e espaços nas pontas. Colidiu: avisa QUAL código
// e não entrega nada; o formulário não recebe linha nenhuma.
// Base vazia = variação sem código (nada de "" no lugar de "sem código").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type LinhaProntaDaGrade,
  ModalVarianteGrade,
} from "@/components/admin/products/ModalVarianteGrade";
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
const onEfetivar = vi.fn<
  (linhas: LinhaProntaDaGrade[], precoDoProduto?: number) => boolean
>(() => true);

const variante = (
  value: string,
  sku: string | undefined,
  active = true,
): ProductVariant => ({
  id: `v-${value}`,
  productId: "prod-1",
  name: "Tamanho",
  value,
  sku,
  stockIncrement: 0,
  active,
});

function montar(
  opcoes: {
    existentes?: ProductVariant[];
    skusDaLoja?: string[];
    skuBaseSugerida?: string;
  } = {},
) {
  act(() => {
    root.render(
      <ModalVarianteGrade
        aberto
        onFechar={() => {}}
        variantesExistentes={opcoes.existentes ?? []}
        sugestoesDeAtributo={[]}
        grupoUnicoEmUso={null}
        skusDaLoja={opcoes.skusDaLoja ?? []}
        skuBaseSugerida={opcoes.skuBaseSugerida}
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

/** Passo 1 → passo 2 com P, M e G do atributo Tamanho (que já abre marcado se o produto o usa). */
function irParaOPasso2(jaTemTamanho: boolean) {
  if (!jaTemTamanho) clicar(botao("Tamanho"));
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

const codigoBase = (valor: string) => digitar(campo("#grade-sku-base"), valor);
const salvar = () => clicar(botao("Salvar"));
const entregue = (): LinhaProntaDaGrade[] =>
  onEfetivar.mock.calls.at(-1)?.[0] ?? [];

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

describe("grade — código interno ao salvar", () => {
  it("controle: base livre gera CAM-P, CAM-M e CAM-G e entrega as três linhas", () => {
    montar();
    irParaOPasso2(false);
    codigoBase("CAM");
    salvar();
    expect(toast.error).not.toHaveBeenCalled();
    expect(onEfetivar).toHaveBeenCalledTimes(1);
    expect(entregue().map((l) => l.sku)).toEqual(["CAM-P", "CAM-M", "CAM-G"]);
  });

  it("base vazia: cada variação nasce SEM código (undefined, nunca texto vazio)", () => {
    montar();
    irParaOPasso2(false);
    salvar();
    expect(onEfetivar).toHaveBeenCalledTimes(1);
    expect(entregue()).toHaveLength(3);
    for (const linha of entregue()) {
      expect(linha.sku).toBeUndefined();
      expect("sku" in linha && linha.sku === "").toBe(false);
    }
  });

  it("código que já existe em OUTRO produto da loja: avisa qual e não entrega nada", () => {
    montar({ skusDaLoja: ["CAM-M"] });
    irParaOPasso2(false);
    codigoBase("CAM");
    salvar();
    expect(onEfetivar).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0]?.[0]).toBe(
      'O código interno "CAM-M" já existe na loja',
    );
  });

  it("a conferência com a loja ignora caixa e espaços nas pontas", () => {
    montar({ skusDaLoja: ["  cam-g  "] });
    irParaOPasso2(false);
    codigoBase("CAM");
    salvar();
    expect(onEfetivar).not.toHaveBeenCalled();
    expect(toast.error.mock.calls[0]?.[0]).toBe(
      'O código interno "CAM-G" já existe na loja',
    );
  });

  it("código de uma variação que ESTE produto já tem (mesmo com a lista da loja vazia): recusa", () => {
    montar({ existentes: [variante("GG", "CAM-P")], skusDaLoja: [] });
    irParaOPasso2(true);
    codigoBase("CAM");
    salvar();
    expect(onEfetivar).not.toHaveBeenCalled();
    expect(toast.error.mock.calls[0]?.[0]).toBe(
      'O código interno "CAM-P" já existe na loja',
    );
  });

  it("variação desligada do produto também guarda o código dela", () => {
    montar({ existentes: [variante("GG", "CAM-M", false)] });
    irParaOPasso2(true);
    codigoBase("CAM");
    salvar();
    expect(onEfetivar).not.toHaveBeenCalled();
    expect(toast.error.mock.calls[0]?.[0]).toBe(
      'O código interno "CAM-M" já existe na loja',
    );
  });

  it("variação existente SEM código não atrapalha ninguém", () => {
    montar({ existentes: [variante("GG", undefined)] });
    irParaOPasso2(true);
    codigoBase("CAM");
    salvar();
    expect(toast.error).not.toHaveBeenCalled();
    expect(entregue().map((l) => l.sku)).toEqual(["CAM-P", "CAM-M", "CAM-G"]);
  });

  it("corrigir a base depois da recusa deixa salvar (nada ficou travado)", () => {
    montar({ skusDaLoja: ["CAM-M"] });
    irParaOPasso2(false);
    codigoBase("CAM");
    salvar();
    expect(onEfetivar).not.toHaveBeenCalled();
    codigoBase("BLU");
    salvar();
    expect(onEfetivar).toHaveBeenCalledTimes(1);
    expect(entregue().map((l) => l.sku)).toEqual(["BLU-P", "BLU-M", "BLU-G"]);
  });
});

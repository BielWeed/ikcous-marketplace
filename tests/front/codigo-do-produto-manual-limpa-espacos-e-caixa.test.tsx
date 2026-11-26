// @vitest-environment jsdom
//
// Código interno do produto digitado à mão: o que sobe para o formulário já
// vem limpo — sem espaços nas pontas, em CAIXA ALTA e com QUALQUER espaço do
// meio virado hífen (vários seguidos viram um hífen só). O código é único na
// loja inteira: "cam  base" e "CAM-BASE" têm de ser o mesmo código.
import { CodigoDoProduto } from "@/components/admin/products/CodigoDoProduto";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onManual = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  act(() => {
    raiz.render(
      <CodigoDoProduto
        automatico={false}
        onAlternar={() => {}}
        codigoGerado="CAM-7K3F"
        onOutro={() => {}}
        valorManual=""
        onManual={onManual}
        erro=""
        rotuloDoCampo="Código interno"
      />,
    );
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

function digitar(valor: string) {
  const el = hospedeiro.querySelector("#product-sku") as HTMLInputElement;
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

describe("código do produto digitado", () => {
  it.each([
    ["  cam base  ", "CAM-BASE"],
    ["cam   base", "CAM-BASE"],
    ["cam\tbase", "CAM-BASE"],
    ["camiseta", "CAMISETA"],
    ["  ", ""],
  ])("%j sobe como %j", (digitado, esperado) => {
    digitar(digitado);
    expect(onManual).toHaveBeenLastCalledWith(esperado);
  });
});

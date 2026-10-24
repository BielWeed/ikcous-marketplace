// @vitest-environment jsdom
// A pílula de quantidade (Carrinho e página do produto) fica sobre `bg-muted`.
// No tema escuro `bg-muted` é #27272a, a MESMA cor do `text-zinc-800` que o
// número usava: o número sumia (1:1) e os ícones ficavam a ~1,9:1. Na pílula,
// número, ícones e hover vêm do tema; os outros tamanhos não mudam.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QuantitySelector } from "@/components/ui/custom/QuantitySelector";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let contedor: HTMLDivElement;

beforeEach(() => {
  contedor = document.createElement("div");
  document.body.appendChild(contedor);
  raiz = createRoot(contedor);
});

afterEach(() => {
  act(() => raiz.unmount());
  contedor.remove();
});

function montar(size: "pill" | "sm" | "md") {
  act(() => {
    raiz.render(
      <QuantitySelector
        quantity={2}
        maxQuantity={5}
        onChange={() => {}}
        size={size}
      />,
    );
  });
}

describe("QuantitySelector: cores da pílula", () => {
  it("pílula: número, ícones e hover usam o tema, sem zinc fixo", () => {
    montar("pill");
    const grupo = contedor.querySelector('[role="group"]') as HTMLElement;
    expect(grupo.className).toMatch(/\bbg-muted\b/);
    const numero = contedor.querySelector("span.font-black") as HTMLElement;
    expect(numero.className).toMatch(/\btext-foreground\b/);
    expect(numero.className).not.toMatch(/zinc/);
    for (const botao of contedor.querySelectorAll("button")) {
      expect(botao.className).toMatch(/\bhover:bg-background\b/);
      expect(botao.className).not.toMatch(/zinc/);
      const icone = botao.querySelector("svg") as SVGElement;
      expect(icone.getAttribute("class")).toMatch(/\btext-foreground\b/);
      expect(icone.getAttribute("class")).not.toMatch(/zinc/);
    }
  });

  it("tamanhos sm e md continuam como eram", () => {
    for (const size of ["sm", "md"] as const) {
      montar(size);
      const numero = contedor.querySelector("span.font-black") as HTMLElement;
      expect(numero.className).toMatch(/\btext-zinc-800\b/);
      for (const botao of contedor.querySelectorAll("button")) {
        expect(botao.className).toMatch(/\bhover:bg-zinc-50\b/);
      }
    }
  });
});

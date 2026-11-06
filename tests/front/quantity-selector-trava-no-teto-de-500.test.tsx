// @vitest-environment jsdom
// Estoque maior que 500: o "+" seguia ativo até o estoque inteiro e o carrinho
// cortava em 500 em silêncio. O seletor é o ponto único das quatro telas
// (página do produto, barra fixa, folha de opções e linha do carrinho): ele
// trava no teto de 500 por item, mesmo com estoque maior.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function montar(quantity: number, maxQuantity: number) {
  const onChange = vi.fn();
  act(() => {
    raiz.render(
      <QuantitySelector
        quantity={quantity}
        maxQuantity={maxQuantity}
        onChange={onChange}
        size="pill"
      />,
    );
  });
  const mais = contedor.querySelector(
    'button[aria-label="Aumentar quantidade"]',
  ) as HTMLButtonElement;
  return { mais, onChange };
}

describe("QuantitySelector — teto de 500 por item", () => {
  it("estoque 800, em 500: o '+' trava, não chama onChange e explica o motivo", () => {
    const { mais, onChange } = montar(500, 800);
    expect(mais.disabled).toBe(true);
    act(() => mais.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(mais.title).toBe("Máximo de 500 por pedido");
  });

  it("estoque 800, em 499: o '+' ainda sobe para 500", () => {
    const { mais, onChange } = montar(499, 800);
    expect(mais.disabled).toBe(false);
    act(() => mais.click());
    expect(onChange).toHaveBeenCalledWith(500);
    expect(mais.title).toBe("Aumentar");
  });

  it("controle, estoque 500, em 500: trava (o limite é o estoque, e a dica diz isso — não a do teto)", () => {
    const { mais, onChange } = montar(500, 500);
    expect(mais.disabled).toBe(true);
    act(() => mais.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(mais.title).toBe("Limite do estoque (500 unidades)");
  });

  it("controle, estoque 3, em 3: trava; em 2 sobe para 3", () => {
    expect(montar(3, 3).mais.disabled).toBe(true);
    const { mais, onChange } = montar(2, 3);
    expect(mais.disabled).toBe(false);
    act(() => mais.click());
    expect(onChange).toHaveBeenCalledWith(3);
  });
});

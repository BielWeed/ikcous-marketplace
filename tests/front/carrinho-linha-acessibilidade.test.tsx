// @vitest-environment jsdom
//
// Caça 8 (26/10/2026), item 9: com 3 produtos no carrinho o leitor de tela
// ouvia "Remover item" três vezes e "Quantidade" três vezes, sem saber de qual
// produto. Agora cada lixeira e cada grupo de quantidade dizem o nome.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuantitySelector } from "@/components/ui/custom/QuantitySelector";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("QuantitySelector — nome do grupo", () => {
  it("sem produto continua 'Quantidade'; com produto vira 'Quantidade de X'", async () => {
    await act(async () => {
      raiz.render(
        <>
          <QuantitySelector quantity={1} maxQuantity={5} onChange={vi.fn()} />
          <QuantitySelector
            quantity={2}
            maxQuantity={5}
            onChange={vi.fn()}
            produto="Vestido Floral"
          />
        </>,
      );
    });
    const grupos = [...hospedeiro.querySelectorAll('[role="group"]')];
    expect(grupos.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Quantidade",
      "Quantidade de Vestido Floral",
    ]);
  });
});

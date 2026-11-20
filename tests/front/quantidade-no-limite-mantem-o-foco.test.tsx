// @vitest-environment jsdom
import { QuantitySelector } from "@/components/ui/custom/QuantitySelector";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it.each([
  ["Diminuir quantidade", 1],
  ["Aumentar quantidade", 3],
] as const)(
  "mantém o foco em '%s' ao chegar em %i sem ultrapassar o limite",
  (rotulo, limite) => {
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    const alterou = vi.fn();

    function Seletor() {
      const [quantidade, setQuantidade] = useState(2);
      return (
        <QuantitySelector
          size="folha"
          quantity={quantidade}
          maxQuantity={3}
          onChange={(valor) => {
            alterou(valor);
            setQuantidade(valor);
          }}
        />
      );
    }

    try {
      act(() => raiz.render(<Seletor />));
      const botao = hospedeiro.querySelector<HTMLButtonElement>(
        `button[aria-label="${rotulo}"]`,
      )!;
      botao.focus();
      expect(document.activeElement).toBe(botao);

      act(() => botao.click());
      expect(alterou).toHaveBeenCalledWith(limite);
      expect(botao.disabled).toBe(false);
      expect(botao.getAttribute("aria-disabled")).toBe("true");
      expect(document.activeElement).toBe(botao);

      act(() => botao.click());
      expect(alterou).toHaveBeenCalledTimes(1);
    } finally {
      act(() => raiz.unmount());
      hospedeiro.remove();
    }
  },
);

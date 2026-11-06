// @vitest-environment jsdom
//
// Campo com máscara (preço, custo, desconto, WhatsApp) é `type="text"` e não
// dizia ao celular qual teclado abrir: o lojista digitava "29,90" num teclado
// de letras. A máscara de moeda só aceita dígitos (centavos) e a de telefone só
// dígitos também, então o campo pede teclado numérico / de telefone — sem mexer
// na máscara nem no valor salvo. Quem passa `inputMode` continua mandando, e a
// moeda que aceita sinal fica sem o teclado só-dígitos (o do iPhone não tem "-").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LocalBufferedInput — teclado do celular", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  const campo = () => hospedeiro.querySelector("input") as HTMLInputElement;

  const desenhar = (
    props: Partial<React.ComponentProps<typeof LocalBufferedInput>>,
  ) => {
    act(() => {
      raiz.render(<LocalBufferedInput value="" onFlush={vi.fn()} {...props} />);
    });
  };

  for (const useShadcn of [false, true]) {
    const origem = useShadcn ? "Input shadcn" : "input simples";

    it(`moeda abre o teclado numérico (${origem})`, () => {
      desenhar({ mask: "currency", useShadcn });
      expect(campo().getAttribute("inputmode")).toBe("numeric");
      expect(campo().type).toBe("text");
    });

    it(`telefone abre o teclado de telefone (${origem})`, () => {
      desenhar({ mask: "phone", useShadcn });
      expect(campo().getAttribute("inputmode")).toBe("tel");
    });

    it(`moeda com sinal não força o teclado só de dígitos (${origem})`, () => {
      desenhar({ mask: "currency", permiteNegativo: true, useShadcn });
      expect(campo().hasAttribute("inputmode")).toBe(false);
    });

    it(`o inputMode do chamador vence (${origem})`, () => {
      desenhar({
        mask: "currency",
        permiteNegativo: true,
        inputMode: "text",
        useShadcn,
      });
      expect(campo().getAttribute("inputmode")).toBe("text");
      desenhar({ mask: "currency", inputMode: "decimal", useShadcn });
      expect(campo().getAttribute("inputmode")).toBe("decimal");
    });

    it(`sem máscara não ganha inputMode (${origem})`, () => {
      desenhar({ useShadcn });
      expect(campo().hasAttribute("inputmode")).toBe(false);
    });
  }
});

// @vitest-environment jsdom
//
// A máscara de moeda aceita dígitos sem limite. Com 24 dígitos ou mais, o
// número chegava perto de 1e21 e o `toFixed(2)` do JavaScript devolvia TEXTO COM
// EXPOENTE ("1e+21"). A limpeza seguinte arranca o "e" e o "+" e lia "121":
// R$ 121,00, abaixo do teto de R$ 9.999.999,99, gravado em silêncio como preço
// da variação. Agora o valor é limitado antes de virar texto: nunca sai
// expoente, e o número enorme continua enorme (o teto de preço o recusa).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { limparNumero, precoDaLinha } from "@/utils/preco-da-grade";
import { acimaDoTetoDePreco } from "@/utils/teto-de-preco";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LocalBufferedInput — moeda com dígitos demais nunca vira expoente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const aoSalvar = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    aoSalvar.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  const campo = () => hospedeiro.querySelector("input") as HTMLInputElement;

  async function montar() {
    await act(async () => {
      raiz.render(
        <LocalBufferedInput value="" mask="currency" onFlush={aoSalvar} />,
      );
    });
  }

  async function digitar(texto: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo(), texto);
      campo().dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: texto.slice(-1),
        }),
      );
      await vi.advanceTimersByTimeAsync(300);
    });
  }

  const entregue = () => aoSalvar.mock.lastCall?.[0] as string;

  it.each([
    ["25 dígitos 1", "1".repeat(25)],
    ["25 dígitos (1 e 24 zeros: 'e+22', lido como 122)", `1${"0".repeat(24)}`],
    ["24 dígitos 9", "9".repeat(24)],
    ["22 dígitos 9 (abaixo de 1e21 em reais: já era certo)", "9".repeat(22)],
    ["400 dígitos (o número vira Infinity)", "9".repeat(400)],
  ])(
    "%s: o texto entregue nunca tem expoente e cai no teto",
    async (_n, dig) => {
      await montar();
      await digitar(dig);

      const texto = entregue();
      expect(texto).toMatch(/^\d+\.\d{2}$/);
      expect(texto).not.toMatch(/e/i);
      expect(acimaDoTetoDePreco(texto)).toBe(true);
      // O caminho que a grade e o modal seguem depois da máscara.
      expect(precoDaLinha(texto)).toBeGreaterThan(9_999_999.99);
      expect(acimaDoTetoDePreco(limparNumero(texto))).toBe(true);
    },
  );

  it("o campo não fica em branco nem mostra símbolo estranho com 400 dígitos", async () => {
    await montar();
    await digitar("9".repeat(400));
    expect(campo().value).toMatch(/^[\d.]+,\d{2}$/);
  });

  it("sair do campo (blur) entrega o mesmo texto sem expoente", async () => {
    await montar();
    await digitar("1".repeat(25));
    aoSalvar.mockClear();
    await act(async () => {
      campo().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    const texto = entregue();
    expect(texto).toMatch(/^\d+\.\d{2}$/);
    expect(acimaDoTetoDePreco(texto)).toBe(true);
  });

  it("o valor limitado que volta do formulário não é mostrado como R$ 1,22", async () => {
    // O formulário devolve ao campo o texto entregue. Com limite de 1e20 o
    // `Math.round(v*100).toString()` virava "1e+22" e o campo mostrava "1,22".
    await montar();
    await digitar("1".repeat(25));
    const devolvido = entregue();
    await act(async () => {
      raiz.render(
        <LocalBufferedInput
          value={devolvido}
          mask="currency"
          onFlush={aoSalvar}
        />,
      );
    });
    expect(campo().value).not.toBe("1,22");
    expect(campo().value).toBe("1.000.000.000.000.000.000,00");
  });

  it("preço normal segue idêntico (controle)", async () => {
    await montar();
    await digitar("8990");
    expect(campo().value).toBe("89,90");
    expect(entregue()).toBe("89.90");
    await digitar("999999999");
    expect(entregue()).toBe("9999999.99");
    expect(acimaDoTetoDePreco(entregue())).toBe(false);
  });
});

// @vitest-environment jsdom
//
// O campo de moeda com `mask="currency"` nunca ficava vazio: apagar com
// backspace o "0,05" dava "0,0", lido como "00" e devolvido como "0,00". Num
// campo onde "vazio" quer dizer "sem preço próprio" (a variação segue o preço
// do produto), esse "0,00" virava preço ZERO e a variação saía de graça.
//
// A prop opcional `zeroVazio` faz o zero DIGITADO virar campo vazio. Ela só
// vale onde foi pedida: os outros usos da máscara (PDV, financeiro, preço do
// produto, telefone) continuam exatamente como eram — este arquivo prova as
// duas metades.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(el: HTMLInputElement, valor: string) {
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("LocalBufferedInput — zeroVazio", () => {
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

  async function montar(props: {
    value?: string;
    mask?: "currency" | "phone";
    zeroVazio?: boolean;
  }) {
    await act(async () => {
      raiz.render(
        <LocalBufferedInput
          value={props.value ?? ""}
          mask={props.mask ?? "currency"}
          zeroVazio={props.zeroVazio}
          onFlush={aoSalvar}
        />,
      );
    });
  }

  async function digitarEEsperar(valor: string) {
    await act(async () => {
      digitar(campo(), valor);
      await vi.advanceTimersByTimeAsync(300);
    });
  }

  it("SEM a prop (todos os outros usos): apagar o 0,05 com backspace continua dando 0,00", async () => {
    await montar({});
    await digitarEEsperar("0,05");
    expect(campo().value).toBe("0,05");

    await digitarEEsperar("0,0");
    expect(campo().value).toBe("0,00");
    expect(aoSalvar).toHaveBeenLastCalledWith("0.00");
  });

  it("COM a prop: o zero digitado vira campo vazio e entrega vazio", async () => {
    await montar({ zeroVazio: true });
    await digitarEEsperar("0,05");
    expect(campo().value).toBe("0,05");
    expect(aoSalvar).toHaveBeenLastCalledWith("0.05");

    await digitarEEsperar("0,0");
    expect(campo().value).toBe("");
    expect(aoSalvar).toHaveBeenLastCalledWith("");
  });

  it("COM a prop: digitar um 0 sozinho também deixa o campo vazio", async () => {
    await montar({ zeroVazio: true });
    await digitarEEsperar("0");
    expect(campo().value).toBe("");
    expect(aoSalvar).toHaveBeenLastCalledWith("");
  });

  it("COM a prop: valor maior que zero se comporta igual ao de sempre", async () => {
    await montar({ zeroVazio: true });
    await digitarEEsperar("1");
    expect(campo().value).toBe("0,01");
    await digitarEEsperar("0,010");
    expect(campo().value).toBe("0,10");
    await digitarEEsperar("4990");
    expect(campo().value).toBe("49,90");
    expect(aoSalvar).toHaveBeenLastCalledWith("49.90");
  });

  it("COM a prop: o zero que JÁ estava salvo é mostrado como 0,00 (a lojista vê o que há)", async () => {
    await montar({ value: "0", zeroVazio: true });
    expect(campo().value).toBe("0,00");
  });

  it("COM a prop: o campo vazio sai vazio ao perder o foco", async () => {
    await montar({ zeroVazio: true });
    await act(async () => {
      campo().focus();
      campo().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {
      campo().blur();
    });
    expect(aoSalvar).toHaveBeenLastCalledWith("");
  });

  it("a prop não vaza para o HTML da página", async () => {
    await montar({ zeroVazio: true });
    expect(campo().hasAttribute("zerovazio")).toBe(false);
    expect(campo().hasAttribute("zeroVazio")).toBe(false);
  });

  it("a máscara de telefone não muda (com ou sem a prop)", async () => {
    await montar({ mask: "phone" });
    await digitarEEsperar("11987654321");
    expect(campo().value).toBe("(11) 98765-4321");
    expect(aoSalvar).toHaveBeenLastCalledWith("11987654321");
  });
});

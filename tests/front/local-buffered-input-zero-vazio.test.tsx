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

  // Custo do produto: vazio quer dizer "sem custo" e 0,00 quer dizer "brinde".
  // Com `zeroDigitadoVale`, o zero que a pessoa DIGITA vale (campo mostra 0,00 e
  // entrega "0.00"); o que continua esvaziando o campo é APAGAR até sobrar zero.
  describe("zeroDigitadoVale (custo R$ 0,00 de brinde)", () => {
    async function montarCusto(
      props: { value?: string; zeroDigitadoVale?: boolean } = {},
    ) {
      await act(async () => {
        raiz.render(
          <LocalBufferedInput
            value={props.value ?? ""}
            mask="currency"
            zeroVazio
            zeroDigitadoVale={props.zeroDigitadoVale}
            onFlush={aoSalvar}
          />,
        );
      });
    }

    async function evento(valor: string, inputType?: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          globalThis.HTMLInputElement.prototype,
          "value",
        )?.set?.call(campo(), valor);
        campo().dispatchEvent(
          inputType === undefined
            ? new Event("input", { bubbles: true })
            : new InputEvent("input", { bubbles: true, inputType }),
        );
        await vi.advanceTimersByTimeAsync(300);
      });
    }

    it("COM a prop: digitar 0 num campo vazio vale custo zero", async () => {
      await montarCusto({ zeroDigitadoVale: true });
      await evento("0", "insertText");
      expect(campo().value).toBe("0,00");
      expect(aoSalvar).toHaveBeenLastCalledWith("0.00");
    });

    it("COM a prop: digitar 000 também vale custo zero", async () => {
      await montarCusto({ zeroDigitadoVale: true });
      await evento("0", "insertText");
      await evento("0,000", "insertText");
      await evento("0,0000", "insertText");
      expect(campo().value).toBe("0,00");
      expect(aoSalvar).toHaveBeenLastCalledWith("0.00");
    });

    it("COM a prop: colar 0 vale custo zero", async () => {
      await montarCusto({ zeroDigitadoVale: true });
      await evento("0", "insertFromPaste");
      expect(campo().value).toBe("0,00");
      expect(aoSalvar).toHaveBeenLastCalledWith("0.00");
    });

    it("COM a prop: digitar 0 e depois 5 continua dando 0,05", async () => {
      await montarCusto({ zeroDigitadoVale: true });
      await evento("0", "insertText");
      await evento("0,005", "insertText");
      expect(campo().value).toBe("0,05");
      expect(aoSalvar).toHaveBeenLastCalledWith("0.05");
    });

    it("COM a prop: apagar tecla por tecla até sobrar zero deixa o campo VAZIO (sem custo)", async () => {
      await montarCusto({ value: "12.5", zeroDigitadoVale: true });
      expect(campo().value).toBe("12,50");
      await evento("12,5", "deleteContentBackward");
      expect(campo().value).toBe("1,25");
      await evento("1,2", "deleteContentBackward");
      expect(campo().value).toBe("0,12");
      await evento("0,1", "deleteContentBackward");
      expect(campo().value).toBe("0,01");
      await evento("0,0", "deleteContentBackward");
      expect(campo().value).toBe("");
      expect(aoSalvar).toHaveBeenLastCalledWith("");
    });

    it("COM a prop: apagar o 0,00 que já estava salvo também deixa vazio", async () => {
      await montarCusto({ value: "0", zeroDigitadoVale: true });
      expect(campo().value).toBe("0,00");
      await evento("0,0", "deleteContentBackward");
      expect(campo().value).toBe("");
      expect(aoSalvar).toHaveBeenLastCalledWith("");
    });

    it("COM a prop: recortar (selecionar tudo e cortar) deixa vazio", async () => {
      await montarCusto({ value: "12.5", zeroDigitadoVale: true });
      await evento("", "deleteByCut");
      expect(campo().value).toBe("");
      expect(aoSalvar).toHaveBeenLastCalledWith("");
    });

    it("COM a prop, sem inputType e com vírgula (0,0): mantém o esvaziar de sempre", async () => {
      await montarCusto({ value: "12.5", zeroDigitadoVale: true });
      await evento("0,0");
      expect(campo().value).toBe("");
      expect(aoSalvar).toHaveBeenLastCalledWith("");
    });

    it("SEM a prop (zeroVazio sozinho): digitar 0 continua esvaziando o campo", async () => {
      await montarCusto({});
      await evento("0", "insertText");
      expect(campo().value).toBe("");
      expect(aoSalvar).toHaveBeenLastCalledWith("");
    });

    it("SEM a prop: apagar até sobrar zero também esvazia (igual a antes)", async () => {
      await montarCusto({ value: "0.05" });
      await evento("0,0", "deleteContentBackward");
      expect(campo().value).toBe("");
      expect(aoSalvar).toHaveBeenLastCalledWith("");
    });

    it("a prop não vaza para o HTML da página", async () => {
      await montarCusto({ zeroDigitadoVale: true });
      expect(campo().hasAttribute("zerodigitadovale")).toBe(false);
      expect(campo().hasAttribute("zeroDigitadoVale")).toBe(false);
    });
  });
});

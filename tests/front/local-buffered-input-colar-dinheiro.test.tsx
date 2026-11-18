// @vitest-environment jsdom
//
// Num campo de dinheiro (`mask="currency"`) a máscara trabalha em CENTAVOS: quem
// digita tecla a tecla vê 1 -> 0,01 -> 0,15 -> 1,50. Isso está certo e não muda.
// Mas COLAR "150" também virava R$ 1,50, "12,5" virava R$ 1,25 e "49,9" virava
// R$ 4,99: a vírgula era descartada e o número dividido por 100. Colar (ou soltar
// um texto) agora lê o texto como número brasileiro e entrega o valor que a
// pessoa copiou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LocalBufferedInput — colar valor em campo de dinheiro", () => {
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

  async function montar(
    props: {
      value?: string;
      permiteNegativo?: boolean;
      validate?: (val: string) => string | null;
    } = {},
  ) {
    await act(async () => {
      raiz.render(
        <LocalBufferedInput
          value={props.value ?? ""}
          mask="currency"
          permiteNegativo={props.permiteNegativo}
          validate={props.validate}
          onFlush={aoSalvar}
        />,
      );
    });
  }

  // O que o navegador faz: o campo passa a ter `valorNoCampo` e dispara `input`
  // com o tipo da edição (e, em input de texto, `data` = o texto inserido).
  async function evento(
    valorNoCampo: string,
    inputType: string,
    data?: string,
  ) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo(), valorNoCampo);
      campo().dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType, data }),
      );
      await vi.advanceTimersByTimeAsync(300);
    });
  }

  const colar = (texto: string) => evento(texto, "insertFromPaste");

  it.each([
    ["150", "150,00", "150.00"],
    ["12,5", "12,50", "12.50"],
    ["49,9", "49,90", "49.90"],
    ["49,90", "49,90", "49.90"],
    ["1.234,56", "1.234,56", "1234.56"],
    ["R$ 10", "10,00", "10.00"],
    ["R$ 1.500,5", "1.500,50", "1500.50"],
    ["  7  ", "7,00", "7.00"],
    [" 10 ", "10,00", "10.00"],
    ["10", "10,00", "10.00"],
    ["1234.56", "1.234,56", "1234.56"],
    ["1,5", "1,50", "1.50"],
    ["12.5", "12,50", "12.50"],
    ["12.50", "12,50", "12.50"],
    ["1.234", "1.234,00", "1234.00"],
    ["1.234.567", "1.234.567,00", "1234567.00"],
    [",5", "0,50", "0.50"],
    ["0", "0,00", "0.00"],
  ])("colar %j mostra %s e entrega %s", async (colado, tela, gravado) => {
    await montar();
    await colar(colado);
    expect(campo().value).toBe(tela);
    expect(aoSalvar).toHaveBeenLastCalledWith(gravado);
  });

  it("o que a tela mostra é o que é gravado (ida e volta pelo valor salvo)", async () => {
    await montar();
    await colar("1.234,56");
    expect(campo().value).toBe("1.234,56");
    expect(aoSalvar).toHaveBeenLastCalledWith("1234.56");
    // O pai devolve o valor gravado pela prop `value`: a tela não muda.
    await montar({ value: "1234.56" });
    expect(campo().value).toBe("1.234,56");
  });

  it("soltar um texto no campo (drop) lê o número do mesmo jeito", async () => {
    await montar();
    await evento("12,5", "insertFromDrop");
    expect(campo().value).toBe("12,50");
    expect(aoSalvar).toHaveBeenLastCalledWith("12.50");
  });

  it("lixo não numérico: ignora a colagem, mantém o valor e não grava nada", async () => {
    await montar({ value: "49.9" });
    expect(campo().value).toBe("49,90");
    for (const lixo of ["abc", "R$", "", ",", "1,2,3", "1,234.56", "12..5"]) {
      await colar(lixo);
      expect(campo().value).toBe("49,90");
    }
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it("colar com o campo já preenchido: vale o texto colado, não a soma com o que havia", async () => {
    await montar({ value: "1.5" });
    expect(campo().value).toBe("1,50");
    // O navegador entrega o campo já misturado ("1,50" + "150") mas informa o
    // que foi inserido em `data`.
    await evento("1,50150", "insertFromPaste", "150");
    expect(campo().value).toBe("150,00");
    expect(aoSalvar).toHaveBeenLastCalledWith("150.00");
  });

  it("colar por cima de uma seleção: o texto colado substitui o valor", async () => {
    await montar({ value: "49.9" });
    await evento("12,5", "insertFromPaste", "12,5");
    expect(campo().value).toBe("12,50");
    expect(aoSalvar).toHaveBeenLastCalledWith("12.50");
  });

  it.each([
    "1e3",
    "-5",
    "-12,5",
    "−10",
    "10-",
    "(10)",
    "R$ -10",
    "1 0",
    "10abc",
    "10R$",
  ])(
    "colar %j não altera o valor nem agenda gravação e mostra erro acessível",
    async (colado) => {
      await montar({ value: "49.9" });
      await colar(colado);
      expect(campo().value).toBe("49,90");
      expect(aoSalvar).not.toHaveBeenCalled();
      expect(campo().getAttribute("aria-invalid")).toBe("true");
      const alerta = hospedeiro.querySelector('[role="alert"]');
      expect(alerta?.textContent).toContain("Valor inválido");
      expect(campo().getAttribute("aria-describedby")).toBe(alerta?.id);
      await act(async () => {
        campo().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      expect(aoSalvar).toHaveBeenLastCalledWith("49.90");
    },
  );

  it.each(["-12,5", "−12,5", "R$ -12,5"])(
    "com permiteNegativo: o sinal colado em %j é mantido",
    async (colado) => {
      await montar({ value: "49.9", permiteNegativo: true });
      await colar(colado);
      expect(campo().value).toBe("-12,50");
      expect(aoSalvar).toHaveBeenLastCalledWith("-12.50");
    },
  );

  it.each(["12,5-", "12,5−", "(12,5)", "R$ (12,5)"])(
    "com permiteNegativo: o sinal contábil colado em %j é mantido",
    async (colado) => {
      await montar({ permiteNegativo: true });
      await colar(colado);
      expect(campo().value).toBe("-12,50");
      expect(aoSalvar).toHaveBeenLastCalledWith("-12.50");
    },
  );

  it.each(["-10abc", "(10abc)", "--10", "10--", "(-10)", "-(10)", "1 0"])(
    "com permiteNegativo: %j continua sendo lixo, não número com sinal",
    async (colado) => {
      await montar({ value: "49.9", permiteNegativo: true });
      await colar(colado);
      expect(campo().value).toBe("49,90");
      expect(aoSalvar).not.toHaveBeenCalled();
      expect(campo().getAttribute("aria-invalid")).toBe("true");
    },
  );

  it("sem validate: sair após recusar colagem limpa o aviso do valor anterior válido", async () => {
    await montar({ value: "49.9" });
    await act(async () => {
      campo().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    await colar("10abc");
    expect(campo().value).toBe("49,90");
    expect(campo().getAttribute("aria-invalid")).toBe("true");
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();

    await act(async () => {
      campo().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(campo().value).toBe("49,90");
    expect(aoSalvar).toHaveBeenLastCalledWith("49.90");
    expect(campo().hasAttribute("aria-invalid")).toBe(false);
    expect(campo().hasAttribute("aria-describedby")).toBe(false);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("sem validate: digitar depois da colagem recusada limpa o aviso", async () => {
    await montar({ value: "49.9" });
    await colar("10abc");
    expect(campo().getAttribute("aria-invalid")).toBe("true");

    await evento("49,901", "insertText", "1");

    expect(campo().value).toBe("499,01");
    expect(aoSalvar).toHaveBeenLastCalledWith("499.01");
    expect(campo().hasAttribute("aria-invalid")).toBe(false);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("usa o aviso do validador sem passar o texto colado já alterado", async () => {
    await montar({
      value: "49.9",
      validate: (val) =>
        /^\d+(\.\d+)?$/.test(val) ? null : "Informe um valor válido",
    });
    await colar("1e3");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Informe um valor válido",
    );
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it("colar um valor válido depois da rejeição limpa o aviso", async () => {
    await montar({ value: "49.9" });
    await colar("1e3");
    expect(campo().getAttribute("aria-invalid")).toBe("true");
    await colar("R$ 10");
    expect(campo().value).toBe("10,00");
    expect(aoSalvar).toHaveBeenLastCalledWith("10.00");
    expect(campo().hasAttribute("aria-invalid")).toBe(false);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("depois de colar dá para continuar digitando em centavos", async () => {
    await montar();
    await colar("12,5");
    await evento("12,505", "insertText");
    expect(campo().value).toBe("125,05");
    expect(aoSalvar).toHaveBeenLastCalledWith("125.05");
  });

  describe("digitar tecla a tecla continua em centavos (não mudou)", () => {
    it("1, 15, 150 viram 0,01, 0,15, 1,50", async () => {
      await montar();
      await evento("1", "insertText", "1");
      expect(campo().value).toBe("0,01");
      await evento("0,015", "insertText", "5");
      expect(campo().value).toBe("0,15");
      await evento("0,150", "insertText", "0");
      expect(campo().value).toBe("1,50");
      expect(aoSalvar).toHaveBeenLastCalledWith("1.50");
    });

    it("sem tipo de edição (evento sintético): '150' continua sendo R$ 1,50", async () => {
      await montar();
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          globalThis.HTMLInputElement.prototype,
          "value",
        )?.set?.call(campo(), "150");
        campo().dispatchEvent(new Event("input", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(campo().value).toBe("1,50");
      expect(aoSalvar).toHaveBeenLastCalledWith("1.50");
    });

    it("apagar com backspace continua em centavos", async () => {
      await montar({ value: "12.5" });
      await evento("12,5", "deleteContentBackward");
      expect(campo().value).toBe("1,25");
      expect(aoSalvar).toHaveBeenLastCalledWith("1.25");
    });
  });
});

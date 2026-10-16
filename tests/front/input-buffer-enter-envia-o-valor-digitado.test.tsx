// @vitest-environment jsdom
// Enter envia o formulário sem blur: o pai precisa receber o texto do buffer
// antes do submit, mesmo quando ainda não passaram os 200 ms do debounce.
import { act, useRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Mascara = "currency" | "phone";

describe.each([false, true])("Enter (useShadcn=%s)", (useShadcn) => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const aoDescarregar = vi.fn();
  const aoEnviar = vi.fn();
  const aoTeclar = vi.fn();
  const aoPropagar = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    aoDescarregar.mockClear();
    aoEnviar.mockClear();
    aoTeclar.mockClear();
    aoPropagar.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  function Formulario({
    valorInicial = "",
    mask,
  }: {
    valorInicial?: string;
    mask?: Mascara;
  }) {
    const [valor, setValor] = useState(valorInicial);
    const ultimoValor = useRef(valorInicial);
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <form
        onSubmit={(e) => {
          e.preventDefault();
          aoEnviar(ultimoValor.current);
        }}
        onKeyDown={(e) => aoPropagar(e.key)}
      >
        <LocalBufferedInput
          value={valor}
          mask={mask}
          useShadcn={useShadcn}
          onFlush={(novoValor) => {
            ultimoValor.current = novoValor;
            setValor(novoValor);
            aoDescarregar(novoValor);
          }}
          onKeyDown={(e) => {
            aoTeclar(e.key, ultimoValor.current, e.defaultPrevented);
          }}
        />
        <button type="submit">Salvar</button>
      </form>
    );
  }

  const campo = () => hospedeiro.querySelector("input") as HTMLInputElement;

  async function montar(valorInicial = "", mask?: Mascara) {
    await act(async () => {
      raiz.render(<Formulario valorInicial={valorInicial} mask={mask} />);
    });
    await act(async () => campo().focus());
  }

  async function digitar(valor: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo(), valor);
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function esperarDebounce() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
  }

  async function apertarEnterEEnviar() {
    const evento = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      campo().dispatchEvent(evento);
      // jsdom não faz o submit implícito do Enter. Sem blur nem avanço do
      // relógio, simulamos o envio imediatamente depois do keydown.
      hospedeiro
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(evento.defaultPrevented).toBe(false);
  }

  it("envia 150,00 no Enter enquanto o pai ainda guarda 0,15", async () => {
    await montar("", "currency");
    await digitar("1");
    await digitar("0,015");
    await esperarDebounce();
    expect(aoDescarregar).toHaveBeenLastCalledWith("0.15");

    await digitar("0,150");
    await digitar("1,500");
    await digitar("15,000");
    expect(campo().value).toBe("150,00");
    expect(aoDescarregar).toHaveBeenCalledTimes(1);
    await apertarEnterEEnviar();

    expect(aoEnviar).toHaveBeenCalledExactlyOnceWith("150.00");
    expect(aoTeclar).toHaveBeenCalledExactlyOnceWith("Enter", "150.00", false);
    expect(aoPropagar).toHaveBeenCalledExactlyOnceWith("Enter");
    expect(document.activeElement).toBe(campo());
  });

  it("envia o texto simples digitado antes do delay", async () => {
    await montar("texto antigo");
    await digitar("texto novo");
    expect(aoDescarregar).not.toHaveBeenCalled();
    await apertarEnterEEnviar();
    expect(aoEnviar).toHaveBeenCalledExactlyOnceWith("texto novo");
  });

  it.each([
    { mask: undefined, valor: "texto salvo", exibicao: "texto salvo" },
    { mask: "currency" as const, valor: "15", exibicao: "15,00" },
    {
      mask: "phone" as const,
      valor: "11987654321",
      exibicao: "(11) 98765-4321",
    },
  ])(
    "Enter sem digitar mantém $valor e não chama onFlush",
    async ({ mask, valor, exibicao }) => {
      await montar(valor, mask);
      await apertarEnterEEnviar();
      await esperarDebounce();
      expect(campo().value).toBe(exibicao);
      expect(aoEnviar).toHaveBeenCalledExactlyOnceWith(valor);
      expect(aoDescarregar).not.toHaveBeenCalled();
    },
  );

  it("envia só os dígitos do telefone antes do delay", async () => {
    await montar("", "phone");
    await digitar("11987654321");
    expect(campo().value).toBe("(11) 98765-4321");
    await apertarEnterEEnviar();
    expect(aoEnviar).toHaveBeenCalledExactlyOnceWith("11987654321");
  });

  it("o blur continua descarregando imediatamente e cancela o debounce", async () => {
    await montar("", "currency");
    await digitar("15000");
    await act(async () => campo().blur());
    expect(aoDescarregar).toHaveBeenCalledExactlyOnceWith("150.00");
    await esperarDebounce();
    expect(aoDescarregar).toHaveBeenCalledTimes(1);
  });

  it("o blur sem digitação continua chamando onFlush", async () => {
    await montar("texto salvo");
    await act(async () => campo().blur());
    expect(aoDescarregar).toHaveBeenCalledExactlyOnceWith("texto salvo");
  });

  it("Enter cancela o timer e apertar de novo não duplica a descarga", async () => {
    await montar();
    await digitar("texto novo");
    await apertarEnterEEnviar();
    expect(aoDescarregar).toHaveBeenCalledExactlyOnceWith("texto novo");
    await apertarEnterEEnviar();
    await esperarDebounce();
    expect(aoDescarregar).toHaveBeenCalledTimes(1);
  });

  it("Enter depois do debounce não repete onFlush", async () => {
    await montar();
    await digitar("texto novo");
    await esperarDebounce();
    await apertarEnterEEnviar();
    expect(aoEnviar).toHaveBeenCalledExactlyOnceWith("texto novo");
    expect(aoDescarregar).toHaveBeenCalledExactlyOnceWith("texto novo");
  });

  it("Enter durante composição IME não descarrega nem cancela o debounce", async () => {
    await montar("texto antigo");
    await digitar("texto em composição");
    await act(async () => {
      campo().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          isComposing: true,
        }),
      );
    });
    expect(aoDescarregar).not.toHaveBeenCalled();
    expect(aoTeclar).toHaveBeenCalledExactlyOnceWith(
      "Enter",
      "texto antigo",
      false,
    );
    await esperarDebounce();
    expect(aoDescarregar).toHaveBeenCalledExactlyOnceWith(
      "texto em composição",
    );
  });

  it("outra tecla mantém o debounce e chega ao onKeyDown do chamador", async () => {
    await montar("texto antigo");
    await digitar("texto novo");
    await act(async () => {
      campo().dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true }),
      );
    });
    expect(aoDescarregar).not.toHaveBeenCalled();
    expect(aoTeclar).toHaveBeenCalledExactlyOnceWith(
      "a",
      "texto antigo",
      false,
    );
    await esperarDebounce();
    expect(aoDescarregar).toHaveBeenCalledExactlyOnceWith("texto novo");
  });
});

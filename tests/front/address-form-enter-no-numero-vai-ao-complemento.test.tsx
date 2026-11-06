// @vitest-environment jsdom
//
// Tecla "Ir/Enter" do celular no campo Número salvava o endereço inteiro antes de
// a pessoa ter a chance de escrever o complemento (apto, bloco), que fica logo ao
// lado. Agora o Enter no Número leva ao Complemento (o teclado mostra "Próximo"),
// e o envio continua pelo botão e pelo Enter dos outros campos.
//
// No jsdom o Enter não dispara o envio sozinho (isso é do navegador); o que o
// navegador respeita é o `preventDefault()` do keydown, e é ele que se mede aqui.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  expect(el, `campo ${id} deve estar visível`).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function esperarAte(condicao: () => boolean) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > 2000) {
      throw new Error("esperarAte: condição não ficou verdadeira em 2000ms");
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const OBRIGATORIOS = {
  name: "Casa",
  street: "Rua de Teste",
  number: "123",
  neighborhood: "Bairro de Teste",
  city: "Cidade de Teste",
  state: "MG",
  recipient_name: "Pessoa de Teste",
};

describe("AddressForm — Enter no campo Número", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onSubmit = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    onSubmit.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes("viacep")
            ? { ok: true, status: 200, json: async () => ({ erro: "true" }) }
            : {
                ok: false,
                status: 404,
                json: async () => ({ error: true, code: "not_found" }),
              },
        ),
      ),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(<AddressForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    });
    await act(async () => digitar("cep", "38500000"));
    await esperarAte(() => !!document.getElementById("street"));
    const outro = Array.from(hospedeiro.querySelectorAll("button")).find(
      (botao) => botao.textContent === "Outro",
    );
    expect(outro).toBeDefined();
    await act(async () => outro!.click());
    await act(async () => {
      for (const [campo, valor] of Object.entries(OBRIGATORIOS))
        digitar(campo, valor);
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const apertarEnter = (id: string, init: KeyboardEventInit = {}) => {
    const el = document.getElementById(id) as HTMLInputElement;
    el.focus();
    const evento = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => {
      el.dispatchEvent(evento);
    });
    return evento;
  };

  it("o teclado do celular mostra 'Próximo' no Número", () => {
    expect(
      document.getElementById("number")?.getAttribute("enterkeyhint"),
    ).toBe("next");
  });

  it("Enter no Número não envia: foca o Complemento e guarda o número digitado", async () => {
    const evento = apertarEnter("number");
    expect(evento.defaultPrevented).toBe(true);
    // O `setFocus` do react-hook-form foca num setTimeout.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(document.activeElement?.id).toBe("complement");
    expect((document.getElementById("number") as HTMLInputElement).value).toBe(
      "123",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Enter durante a composição de texto (teclado com sugestão) não é desviado", () => {
    const evento = apertarEnter("number", { isComposing: true });
    expect(evento.defaultPrevented).toBe(false);
  });

  it("Enter no Complemento segue livre (envio pelo teclado continua)", () => {
    const evento = apertarEnter("complement");
    expect(evento.defaultPrevented).toBe(false);
  });

  it("o botão de salvar continua enviando o endereço", async () => {
    await act(async () => {
      hospedeiro
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit.mock.calls[0][0].number).toBe("123");
  });
});

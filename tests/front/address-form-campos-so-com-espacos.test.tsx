// @vitest-environment jsdom
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

const mensagens = {
  name: "Nome/Apelido é obrigatório",
  street: "Logradouro é obrigatório",
  number: "Número é obrigatório",
  neighborhood: "Bairro é obrigatório",
  city: "Cidade é obrigatória",
  state: "Estado é obrigatório",
  recipient_name: "Nome do destinatário é obrigatório",
};

describe("AddressForm — campos obrigatórios só com espaços", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // Abre o preenchimento manual sem fazer nenhuma chamada à rede real.
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
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrirFormulario() {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
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
    return onSubmit;
  }

  async function enviar() {
    const formulario = hospedeiro.querySelector("form");
    expect(formulario).not.toBeNull();
    await act(async () => {
      formulario!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  }

  it.each(["", " ", "   "])(
    "recusa obrigatórios preenchidos com %j e mostra as mensagens de vazio",
    async (valor) => {
      const onSubmit = await abrirFormulario();
      await act(async () => {
        for (const campo of Object.keys(mensagens)) digitar(campo, valor);
      });
      await enviar();
      // Espera um desfecho observável: validação ou envio indevido. Assim o
      // RED acusa a gravação, não um timeout esperando uma mensagem ausente.
      await esperarAte(
        () =>
          onSubmit.mock.calls.length > 0 ||
          !!hospedeiro.querySelector("#erro-recipient_name"),
      );
      expect(onSubmit).not.toHaveBeenCalled();
      for (const [campo, mensagem] of Object.entries(mensagens)) {
        expect(hospedeiro.querySelector(`#erro-${campo}`)?.textContent).toBe(
          mensagem,
        );
      }
    },
  );

  it("mantém os valores válidos com espaços nas pontas e complemento opcional", async () => {
    const onSubmit = await abrirFormulario();
    const valores = {
      name: " Casa de teste ",
      street: " Rua de Teste ",
      number: " 123 ",
      neighborhood: " Bairro de Teste ",
      city: " Cidade de Teste ",
      state: " MG ",
      recipient_name: " Pessoa de Teste ",
    };
    await act(async () => {
      for (const [campo, valor] of Object.entries(valores))
        digitar(campo, valor);
    });
    await enviar();
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      ...valores,
      cep: "38500-000",
      complement: "",
      reference: "",
      is_default: false,
    });
    for (const campo of Object.keys(mensagens)) {
      expect(hospedeiro.querySelector(`#erro-${campo}`)).toBeNull();
    }
  });
});

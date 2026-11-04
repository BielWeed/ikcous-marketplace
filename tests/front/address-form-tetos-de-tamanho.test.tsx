// @vitest-environment jsdom
//
// ENDEREÇO SEM LIMITE DE TAMANHO (rodada 5, achado 0).
//
// Nenhum campo do formulário de endereço tinha teto: uma conta gravava um
// complemento de megabytes e ele ia junto em toda lista de pedidos do painel.
// O teto mora no FORMULÁRIO (sem migration): rua, complemento e referência
// 200; apelido, destinatário e bairro 120; número 20.
//
// Endereço ANTIGO já salvo acima do teto não pode travar a cliente sem
// explicação: ao salvar, o campo certo mostra "Máximo de N caracteres".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address } from "@/types";

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

const SALVO: Address = {
  id: "end-1",
  user_id: "conta-a",
  name: "Escritório",
  recipient_name: "Ana",
  cep: "38500-000",
  street: "Rua do Comércio",
  number: "10",
  complement: "Sala 2",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "Perto da praça",
  is_default: false,
};

describe("AddressForm — tetos de tamanho dos campos", () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ erro: "true" }),
        }),
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

  async function abrirComEndereco(dados: Partial<Address>) {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={{ ...SALVO, ...dados }}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );
    });
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

  it("cada campo de texto tem o teto no próprio input", async () => {
    await abrirComEndereco({});
    // Os campos de rua e bairro ficam sob o cartão; "Editar" abre.
    const editar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === "Editar",
    );
    expect(editar).toBeDefined();
    await act(async () => editar!.click());

    const tetos: Record<string, number> = {
      street: 200,
      complement: 200,
      reference: 200,
      name: 120,
      recipient_name: 120,
      neighborhood: 120,
      number: 20,
    };
    for (const [campo, teto] of Object.entries(tetos)) {
      const el = document.getElementById(campo) as HTMLInputElement | null;
      expect(el, `campo ${campo} deve estar visível`).not.toBeNull();
      expect(el!.maxLength, `maxLength de ${campo}`).toBe(teto);
    }
  });

  it("endereço ANTIGO com complemento acima do teto: não grava e o campo diz o máximo", async () => {
    const onSubmit = await abrirComEndereco({ complement: "a".repeat(201) });
    await enviar();
    await esperarAte(() => !!hospedeiro.querySelector("#erro-complement"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(hospedeiro.querySelector("#erro-complement")?.textContent).toBe(
      "Máximo de 200 caracteres",
    );
    expect(
      document.getElementById("complement")?.getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("endereço ANTIGO com rua, bairro, referência, destinatário e apelido grandes: cada campo avisa", async () => {
    const onSubmit = await abrirComEndereco({
      street: "r".repeat(201),
      neighborhood: "b".repeat(121),
      reference: "p".repeat(201),
      recipient_name: "n".repeat(121),
      name: "x".repeat(121),
      number: "9".repeat(21),
    });
    await enviar();
    await esperarAte(() => !!hospedeiro.querySelector("#erro-street"));
    expect(onSubmit).not.toHaveBeenCalled();
    const esperado: Record<string, string> = {
      street: "Máximo de 200 caracteres",
      neighborhood: "Máximo de 120 caracteres",
      reference: "Máximo de 200 caracteres",
      recipient_name: "Máximo de 120 caracteres",
      name: "Máximo de 120 caracteres",
      number: "Máximo de 20 caracteres",
    };
    for (const [campo, mensagem] of Object.entries(esperado)) {
      expect(
        hospedeiro.querySelector(`#erro-${campo}`)?.textContent,
        `mensagem de ${campo}`,
      ).toBe(mensagem);
    }
  });

  it("CONTROLE: no teto exato salva, e corrigir o campo grande libera o envio", async () => {
    const onSubmit = await abrirComEndereco({
      complement: "c".repeat(200),
      street: "s".repeat(200),
    });
    await enviar();
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].complement).toBe("c".repeat(200));
  });

  it("corrigir o campo que passou do teto libera o envio", async () => {
    const onSubmit = await abrirComEndereco({ complement: "a".repeat(300) });
    await enviar();
    await esperarAte(() => !!hospedeiro.querySelector("#erro-complement"));
    await act(async () => digitar("complement", "Sala 2"));
    await enviar();
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit.mock.calls[0][0].complement).toBe("Sala 2");
    expect(hospedeiro.querySelector("#erro-complement")).toBeNull();
  });
});

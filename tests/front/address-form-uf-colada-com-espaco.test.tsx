// @vitest-environment jsdom
//
// Colar " SP " no campo UF do cadastro de endereço. Com `maxLength={2}` o
// navegador guardava " S" (cortava antes de tirar os espaços) e a cliente via
// "Estado inválido" por ter copiado uma UF válida. O corte em 2 letras agora é
// do `onChange`, depois de normalizar.
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

describe("AddressForm — UF colada com espaço", () => {
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

  const campoUf = () => document.getElementById("state") as HTMLInputElement;

  const completos = {
    name: "Casa",
    street: "Rua Teste",
    number: "1",
    neighborhood: "Centro",
    city: "Cidade Teste",
    recipient_name: "Pessoa Teste",
  };

  it.each([" sp ", "SP ", " SP", "s p"])(
    "colar %j deixa 'SP' no campo e grava 'SP'",
    async (colado) => {
      const onSubmit = await abrirFormulario();
      await act(async () => {
        for (const [campo, valor] of Object.entries(completos))
          digitar(campo, valor);
        digitar("state", colado);
      });
      expect(campoUf().value).toBe("SP");

      const formulario = hospedeiro.querySelector("form");
      await act(async () => {
        formulario!.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      await esperarAte(() => onSubmit.mock.calls.length > 0);
      expect(onSubmit.mock.calls[0]?.[0].state).toBe("SP");
      expect(hospedeiro.textContent).not.toContain("Estado inválido");
    },
  );

  it("digitar normalmente continua igual: 'mg' vira 'MG' e o excesso é cortado em 2 letras", async () => {
    await abrirFormulario();
    await act(async () => digitar("state", "mg"));
    expect(campoUf().value).toBe("MG");
    await act(async () => digitar("state", "mgx"));
    expect(campoUf().value).toBe("MG");
  });

  it("o campo não tem `maxLength`: o navegador cortaria o texto colado ANTES da limpeza (o jsdom não reproduz esse corte, por isso a trava é no atributo)", async () => {
    await abrirFormulario();
    expect(campoUf().hasAttribute("maxlength")).toBe(false);
    expect(campoUf().getAttribute("autocomplete")).toBe("address-level1");
  });
});

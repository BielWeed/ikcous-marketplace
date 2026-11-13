// @vitest-environment jsdom
//
// "Novo endereço" não pode apagar o que a cliente já digitou.
//
// AddressForm só reseta o formulário UMA vez, quando isLoaded sobe. Com rede
// lenta e sem configuração da loja em cache, a cliente abria o formulário e
// começava a preencher (CEP, rua, número) ANTES de isLoaded; quando a
// configuração terminava de carregar, o reset inicial zerava tudo. Aqui:
// o que ela digitou sobrevive, e o que ela NÃO tocou ainda recebe o padrão
// (apelido "Casa", nome da conta em "Quem vai receber").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address } from "@/types";

const loja = vi.hoisted(() => ({ isLoaded: false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "local", originCep: "38500-000" },
    isLoaded: loja.isLoaded,
  }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// address-form-edicao-tardia-preenche.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const valor = (id: string) =>
  (document.getElementById(id) as HTMLInputElement).value;

const enderecoSalvo: Address = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  cep: "38500-000",
  street: "Rua Teste",
  number: "123",
  complement: "",
  neighborhood: "Centro",
  city: "Testópolis",
  state: "MG",
  reference: "",
  recipient_name: "Cliente Teste",
  is_default: true,
};

describe("AddressForm — novo endereço sobrevive ao isLoaded subir", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    loja.isLoaded = false;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // CEP que nenhum provedor conhece: os campos abrem para preencher à mão.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes("viacep")
            ? { ok: true, status: 200, json: async () => ({ erro: "true" }) }
            : { ok: false, status: 404, json: async () => ({ error: true }) },
        ),
      ),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderizar(nomeDaConta?: string, initialData?: Address) {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={initialData}
          nomeDaConta={nomeDaConta}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });
  }

  async function esvaziar() {
    await act(async () => {
      for (let i = 0; i < 40; i++) await Promise.resolve();
    });
  }

  // Digita o CEP e espera a busca falhar: rua e número ficam à mão.
  async function abrirCamposAMao() {
    await act(async () => {
      digitar("cep", "38509999");
    });
    await esvaziar();
  }

  const apelidoCasaLigado = () =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent === "Casa")
      ?.getAttribute("aria-pressed");

  it("digitou antes de isLoaded: o digitado continua e o apelido padrão também", async () => {
    await renderizar("Mariana Lopes");

    await abrirCamposAMao();
    await act(async () => {
      digitar("street", "Rua Digitada");
      digitar("number", "77");
    });
    // Âncora: a digitação entrou antes do reset.
    expect(valor("street")).toBe("Rua Digitada");

    loja.isLoaded = true;
    await renderizar("Mariana Lopes");
    await act(async () => {
      await Promise.resolve();
    });

    expect(valor("cep")).toBe("38509-999");
    expect(valor("street")).toBe("Rua Digitada");
    expect(valor("number")).toBe("77");
    expect(apelidoCasaLigado()).toBe("true");
    expect(valor("recipient_name")).toBe("Mariana Lopes");
  });

  it("digitou só o CEP: o que ela não tocou recebe os padrões", async () => {
    await renderizar("Mariana Lopes");
    await abrirCamposAMao();
    loja.isLoaded = true;
    await renderizar("Mariana Lopes");
    await act(async () => {
      await Promise.resolve();
    });

    expect(valor("cep")).toBe("38509-999");
    expect(valor("street")).toBe("");
    expect(apelidoCasaLigado()).toBe("true");
    expect(valor("recipient_name")).toBe("Mariana Lopes");
  });

  it("nome da conta chega junto de isLoaded e ela não mexeu nele: preenche", async () => {
    await renderizar(undefined);
    await abrirCamposAMao();
    await act(async () => {
      digitar("street", "Rua Digitada");
    });

    loja.isLoaded = true;
    await renderizar("Mariana Lopes");
    await act(async () => {
      await Promise.resolve();
    });

    expect(valor("street")).toBe("Rua Digitada");
    expect(valor("recipient_name")).toBe("Mariana Lopes");
  });

  it("edição de endereço salvo continua igual: isLoaded sobe e os campos vêm do endereço", async () => {
    await renderizar(undefined, enderecoSalvo);
    loja.isLoaded = true;
    await renderizar(undefined, enderecoSalvo);
    await act(async () => {
      await Promise.resolve();
    });

    expect(valor("cep")).toBe("38500-000");
    expect(
      document.querySelector('[data-testid="cartao-do-endereco"]')?.textContent,
    ).toContain("Rua Teste");
    expect(valor("recipient_name")).toBe("Cliente Teste");
  });
});

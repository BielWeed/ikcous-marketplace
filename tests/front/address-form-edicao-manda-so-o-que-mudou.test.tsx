// @vitest-environment jsdom
//
// EDITAR ENDEREÇO COM A TELA VELHA NÃO DESFAZ A CORREÇÃO DE OUTRO APARELHO.
//
// A cliente abre "Editar endereço" no tablet (número 10) e deixa a tela
// aberta; no celular corrige o número para 100 e salva. De volta ao tablet,
// ela altera SÓ o complemento e salva: o formulário reenviava TODOS os campos,
// inclusive o número 10 que ela nem tocou, e a correção do celular era
// desfeita com o aviso "Endereço atualizado". Agora, EDITANDO, o formulário
// entrega também (2º argumento do `onSubmit`) só o que a pessoa de fato mudou
// em relação ao que a tela abriu; o bloco do CEP (CEP, rua, bairro, cidade e
// UF) vai inteiro se ela mexeu em qualquer parte dele. Endereço NOVO não tem
// 2º argumento: manda tudo, como sempre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { DadosDoFormularioDeEndereco } from "@/components/ui/custom/AddressForm";
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

async function esvaziar() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

const casa = (extra: Partial<Address> = {}): Address => ({
  id: "end-a",
  user_id: "conta",
  name: "Casa",
  recipient_name: "Ana",
  cep: "38500-000",
  street: "Rua do Comércio",
  number: "10",
  complement: "",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "",
  is_default: true,
  ...extra,
});

describe("AddressForm — edição manda só o que a pessoa mudou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onSubmit: Mock<
    (
      dados: DadosDoFormularioDeEndereco,
      alterados?: Partial<DadosDoFormularioDeEndereco>,
    ) => Promise<void>
  >;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    onSubmit = vi.fn().mockResolvedValue(undefined);
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

  async function abrir(initialData?: Address) {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={initialData}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          nomeDaConta="Ana"
        />,
      );
    });
    await esvaziar();
  }

  async function salvar() {
    await act(async () => {
      hospedeiro
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await esvaziar();
  }

  const alterados = () => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
    return onSubmit.mock.calls[0][1];
  };

  function viaCepResponde(dados: Record<string, string>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: async () => dados }),
      ),
    );
  }

  it("tablet velho: altera SÓ o complemento -- o número que ela não tocou NÃO vai", async () => {
    await abrir(casa({ number: "10" }));
    await act(async () => {
      digitar("complement", "Apto 3");
    });
    await salvar();

    expect(alterados()).toEqual({ complement: "Apto 3" });
  });

  it("a edição que muda o número manda o número (e só ele)", async () => {
    await abrir(casa());
    await act(async () => {
      digitar("number", "100");
    });
    await salvar();

    expect(alterados()).toEqual({ number: "100" });
  });

  it("a versão nova do MESMO endereço chega com a tela aberta: o número novo vale como base e não é reenviado", async () => {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await abrir(casa({ number: "10" }));
    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={casa({ number: "100" })}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );
    });
    await esvaziar();
    await act(async () => {
      digitar("complement", "Apto 3");
    });
    await salvar();

    expect(alterados()).toEqual({ complement: "Apto 3" });
  });

  it("trocar o CEP manda o bloco derivado inteiro (CEP, rua, bairro, cidade e UF), sem o número", async () => {
    viaCepResponde({
      logradouro: "Rua Nova",
      bairro: "Bairro Novo",
      localidade: "Uberlândia",
      uf: "MG",
    });
    await abrir(casa());
    await act(async () => {
      digitar("cep", "38400000");
    });
    await esvaziar();
    await salvar();

    expect(alterados()).toEqual({
      cep: "38400-000",
      street: "Rua Nova",
      neighborhood: "Bairro Novo",
      city: "Uberlândia",
      state: "MG",
    });
  });

  it("mexer só na rua leva o bloco do CEP junto (nunca metade de cada)", async () => {
    await abrir(casa());
    await act(async () => {
      // O endereço salvo abre num cartão; "Editar" abre os campos.
      const cartao = document.querySelector(
        '[data-testid="cartao-do-endereco"]',
      )!;
      [...cartao.querySelectorAll("button")]
        .find((b) => b.textContent === "Editar")!
        .click();
    });
    await act(async () => {
      digitar("street", "Rua do Comércio, lado B");
    });
    await salvar();

    expect(alterados()).toEqual({
      cep: "38500-000",
      street: "Rua do Comércio, lado B",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
    });
  });

  it("apagar o complemento que existia manda o vazio (é uma mudança dela)", async () => {
    await abrir(casa({ complement: "Apto 9" }));
    await act(async () => {
      digitar("complement", "");
    });
    await salvar();

    expect(alterados()).toEqual({ complement: "" });
  });

  it("o principal só entra se ela mexeu no botão", async () => {
    await abrir(casa({ is_default: false }));
    await act(async () => {
      (document.getElementById("is_default") as HTMLButtonElement).click();
    });
    await salvar();

    expect(alterados()).toEqual({ is_default: true });
  });

  it("salvar sem mexer em nada: nada a alterar (objeto vazio), e os dados completos seguem no 1º argumento", async () => {
    await abrir(casa());
    await salvar();

    expect(alterados()).toEqual({});
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      number: "10",
      street: "Rua do Comércio",
    });
  });

  it("endereço NOVO: sem 2º argumento, e o 1º traz tudo", async () => {
    viaCepResponde({
      logradouro: "Rua Tiradentes",
      bairro: "Centro",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
    await abrir(undefined);
    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    await act(async () => {
      digitar("number", "1250");
    });
    await salvar();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][1]).toBeUndefined();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      cep: "38500-000",
      street: "Rua Tiradentes",
      number: "1250",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
    });
  });
});

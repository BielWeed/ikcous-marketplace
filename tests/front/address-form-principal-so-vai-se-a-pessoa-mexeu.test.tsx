// @vitest-environment jsdom
//
// EDITAR COM A TELA VELHA NÃO DEVOLVE A MARCA "PRINCIPAL" (r84-b, achado 2).
//
// A cliente troca o principal de A para B no celular. No tablet, o "Editar
// endereço" de A já estava aberto de antes (mostrando A como principal); ela
// corrige só o complemento e salva. O formulário mandava TODOS os campos,
// inclusive o `is_default: true` velho, e o gatilho do banco tirava a marca de
// B: o principal voltava a ser A sem ela pedir, e o carrinho passava a calcular
// frete e entrega para A. Agora, editando, o formulário só manda `is_default`
// quando a PESSOA mexeu no botão "Endereço principal". Endereço novo continua
// mandando sempre (o gancho de endereços decide o primeiro como principal).
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

describe("AddressForm — `is_default` só vai quando a pessoa mexeu", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onSubmit: Mock<(dados: DadosDoFormularioDeEndereco) => Promise<void>>;

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
    onSubmit = vi
      .fn<(dados: DadosDoFormularioDeEndereco) => Promise<void>>()
      .mockResolvedValue(undefined);
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
        />,
      );
    });
    await esvaziar();
  }

  const botaoPrincipal = () =>
    document.getElementById("is_default") as HTMLButtonElement;

  async function tocarNoPrincipal() {
    await act(async () => {
      botaoPrincipal().click();
    });
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

  const enviado = () => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
    return onSubmit.mock.calls[0][0] as Record<string, unknown>;
  };

  it("editar A (mostrado como principal) mexendo só no número: NÃO manda is_default", async () => {
    await abrir(casa({ is_default: true }));
    expect(botaoPrincipal().getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      digitar("number", "11");
    });
    await salvar();

    const dados = enviado();
    expect(dados.number).toBe("11");
    expect("is_default" in dados).toBe(false);
  });

  it("editar um endereço comum mexendo só no número: NÃO manda is_default (não desmarca o principal que outro aparelho pôs nele)", async () => {
    await abrir(casa({ is_default: false }));
    expect(botaoPrincipal().getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      digitar("number", "11");
    });
    await salvar();

    expect("is_default" in enviado()).toBe(false);
  });

  it("a pessoa LIGA o principal de propósito: manda is_default true", async () => {
    await abrir(casa({ is_default: false }));
    await tocarNoPrincipal();
    expect(botaoPrincipal().getAttribute("aria-checked")).toBe("true");
    await salvar();

    expect(enviado().is_default).toBe(true);
  });

  it("a pessoa DESLIGA o principal de propósito: manda is_default false", async () => {
    await abrir(casa({ is_default: true }));
    await tocarNoPrincipal();
    expect(botaoPrincipal().getAttribute("aria-checked")).toBe("false");
    await salvar();

    expect(enviado().is_default).toBe(false);
  });

  it("a pessoa mexeu e voltou ao que estava (liga e desliga): a escolha dela vale e é mandada", async () => {
    await abrir(casa({ is_default: true }));
    await tocarNoPrincipal();
    await tocarNoPrincipal();
    expect(botaoPrincipal().getAttribute("aria-checked")).toBe("true");
    await salvar();

    expect(enviado().is_default).toBe(true);
  });

  it("endereço NOVO: continua mandando is_default (false por padrão)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            logradouro: "Rua Tiradentes",
            bairro: "Centro",
            localidade: "Monte Carmelo",
            uf: "MG",
          }),
        }),
      ),
    );
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(
        <AddressForm
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          nomeDaConta="Ana"
        />,
      );
    });
    await esvaziar();
    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    await act(async () => {
      digitar("number", "1250");
    });
    await salvar();

    expect(enviado().is_default).toBe(false);
  });

  it("o formulário passa a outro endereço (outro id): o toque dado antes não vale para o novo", async () => {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await abrir(casa({ id: "end-a", is_default: true }));
    await tocarNoPrincipal();

    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={casa({
            id: "end-b",
            name: "Trabalho",
            is_default: true,
          })}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );
    });
    await esvaziar();
    expect(botaoPrincipal().getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      digitar("number", "12");
    });
    await salvar();

    expect("is_default" in enviado()).toBe(false);
  });
});

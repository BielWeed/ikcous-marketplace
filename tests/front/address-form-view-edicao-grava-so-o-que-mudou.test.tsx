// @vitest-environment jsdom
//
// "MINHA CONTA > EDITAR ENDEREÇO" GRAVA SÓ O QUE A CLIENTE MUDOU.
//
// A tela do tablet ficou aberta com o número 10; no celular a cliente
// corrigiu para 100. De volta ao tablet, ela altera só o complemento e salva:
// a tela grava SÓ o complemento, e o número do banco (100) não é tocado.
// Endereço novo continua gravando tudo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { addAddress, updateAddress, lista } = vi.hoisted(() => ({
  addAddress: vi.fn(),
  updateAddress: vi.fn(),
  lista: { itens: [] as unknown[] },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u1", user_metadata: {} },
    profile: { full_name: "Mariana Lopes" },
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: lista.itens,
    loading: false,
    fetchAddresses: vi.fn(),
    addAddress,
    updateAddress,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste", shippingCoverage: "local" },
    isLoaded: true,
  }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
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

async function esvaziar() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

const salvo = {
  id: "end-1",
  user_id: "u1",
  name: "Casa",
  recipient_name: "Mariana Lopes",
  cep: "38500-000",
  street: "Rua Tiradentes",
  number: "10",
  complement: "",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "",
  is_default: false,
};

describe("AddressFormView — grava só o que a cliente mudou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    lista.itens = [salvo];
    updateAddress.mockResolvedValue(true);
    addAddress.mockResolvedValue({ ...salvo, id: "novo" });
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
          json: async () => ({
            logradouro: "Rua Tiradentes",
            bairro: "Centro",
            localidade: "Monte Carmelo",
            uf: "MG",
          }),
        }),
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
  });

  async function abrir(addressId?: string) {
    const { AddressFormView } = await import(
      "@/views/customer/AddressFormView"
    );
    await act(async () => {
      raiz.render(<AddressFormView addressId={addressId} onBack={vi.fn()} />);
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

  it("editar só o complemento: updateAddress recebe SÓ o complemento", async () => {
    await abrir("end-1");
    await act(async () => {
      digitar("complement", "Apto 3");
    });
    await salvar();

    expect(updateAddress).toHaveBeenCalledTimes(1);
    expect(updateAddress).toHaveBeenCalledWith("end-1", {
      complement: "Apto 3",
    });
  });

  it("editar o número: o número vai", async () => {
    await abrir("end-1");
    await act(async () => {
      digitar("number", "100");
    });
    await salvar();

    expect(updateAddress).toHaveBeenCalledWith("end-1", { number: "100" });
  });

  it("endereço NOVO: addAddress recebe tudo", async () => {
    await abrir(undefined);
    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    await act(async () => {
      digitar("number", "1250");
    });
    await salvar();

    expect(updateAddress).not.toHaveBeenCalled();
    expect(addAddress).toHaveBeenCalledTimes(1);
    expect(addAddress.mock.calls[0][0]).toMatchObject({
      cep: "38500-000",
      street: "Rua Tiradentes",
      number: "1250",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
      is_default: false,
    });
  });
});

// @vitest-environment jsdom
//
// A TELA de endereço (AddressFormView) em volta do formulário redesenhado:
// - "Quem vai receber" já nasce com o nome da conta (profile.full_name, ou o
//   nome do metadado do login quando o perfil ainda não chegou);
// - o nome da tela ("Novo endereço") continua visível — a jornada e2e
//   trocar-endereco-carrinho procura esse texto;
// - salvar entrega o endereço a `addAddress` no mesmo formato de sempre e
//   volta (`onBack`) só quando a gravação deu certo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, addAddress, updateAddress } = vi.hoisted(() => ({
  auth: {
    user: { id: "u1", user_metadata: { name: "Nome do Login" } } as {
      id: string;
      user_metadata: { name?: string };
    } | null,
    profile: { full_name: "Mariana Lopes" } as { full_name?: string } | null,
  },
  addAddress: vi.fn(),
  updateAddress: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
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

describe("AddressFormView — nome da conta e salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: "u1", user_metadata: { name: "Nome do Login" } };
    auth.profile = { full_name: "Mariana Lopes" };
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

  async function abrir(onBack = vi.fn()) {
    const { AddressFormView } = await import(
      "@/views/customer/AddressFormView"
    );
    await act(async () => {
      raiz.render(<AddressFormView onBack={onBack} />);
    });
    return onBack;
  }

  async function preencherCepENumero() {
    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    await act(async () => {
      digitar("number", "1250");
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

  it("mantém 'Novo endereço' visível e abre só com o CEP", async () => {
    await abrir();
    expect(hospedeiro.textContent).toContain("Novo endereço");
    expect(hospedeiro.textContent).toContain("Para onde vamos entregar?");
    expect(document.getElementById("street")).toBeNull();
  });

  it("'Quem vai receber' nasce com o nome do perfil", async () => {
    await abrir();
    await preencherCepENumero();
    expect(
      (document.getElementById("recipient_name") as HTMLInputElement).value,
    ).toBe("Mariana Lopes");
  });

  it("perfil ainda não carregado: usa o nome do metadado do login", async () => {
    auth.profile = null;
    await abrir();
    await preencherCepENumero();
    expect(
      (document.getElementById("recipient_name") as HTMLInputElement).value,
    ).toBe("Nome do Login");
  });

  it("sem nome nenhum na conta: o campo nasce vazio e a pessoa digita (como antes)", async () => {
    auth.profile = null;
    auth.user = { id: "u1", user_metadata: {} };
    await abrir();
    await preencherCepENumero();
    expect(
      (document.getElementById("recipient_name") as HTMLInputElement).value,
    ).toBe("");
  });

  it("salvar entrega o endereço a addAddress no formato de sempre e volta", async () => {
    addAddress.mockResolvedValue({ id: "novo" });
    const onBack = await abrir();
    await preencherCepENumero();
    await salvar();

    expect(addAddress).toHaveBeenCalledTimes(1);
    expect(addAddress).toHaveBeenCalledWith({
      name: "Casa",
      cep: "38500-000",
      street: "Rua Tiradentes",
      number: "1250",
      complement: "",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
      reference: "",
      recipient_name: "Mariana Lopes",
      is_default: false,
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("gravação que falha NÃO volta (a pessoa não perde o que digitou)", async () => {
    addAddress.mockResolvedValue(null);
    const onBack = await abrir();
    await preencherCepENumero();
    await salvar();

    expect(addAddress).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
    // O formulário continua na tela, com o que ela digitou.
    expect((document.getElementById("number") as HTMLInputElement).value).toBe(
      "1250",
    );
  });
});

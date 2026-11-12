// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { addAddress, fetchAddresses } = vi.hoisted(() => ({
  addAddress: vi.fn(),
  fetchAddresses: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u1", user_metadata: {} },
    profile: { full_name: "Mariana Lopes" },
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    loading: false,
    fetchAddresses,
    addAddress,
    updateAddress: vi.fn(),
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

function gravacaoEmVoo() {
  let terminar!: (valor: { id: string } | null) => void;
  const promessa = new Promise<{ id: string } | null>((resolve) => {
    terminar = resolve;
  });
  return { promessa, terminar };
}

describe("AddressForm — salvar não envia duas vezes", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function clicar(botao: HTMLButtonElement) {
    // Clique real no botão: submit manual ignoraria a proteção disabled.
    await act(async () => botao.click());
    await esvaziar();
  }

  it("bloqueia outro clique durante a gravação e libera nova tentativa após falhar", async () => {
    const primeira = gravacaoEmVoo();
    const segunda = gravacaoEmVoo();
    addAddress
      .mockReturnValueOnce(primeira.promessa)
      .mockReturnValueOnce(segunda.promessa);
    const onBack = vi.fn();
    const { AddressFormView } = await import(
      "@/views/customer/AddressFormView"
    );
    await act(async () => {
      raiz.render(<AddressFormView onBack={onBack} />);
    });
    await act(async () => digitar("cep", "38500000"));
    await esvaziar();
    await act(async () => digitar("number", "1250"));

    const salvar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    expect(salvar.disabled).toBe(false);
    await clicar(salvar);
    expect(addAddress).toHaveBeenCalledTimes(1);
    const desabilitadoDuranteGravacao = salvar.disabled;
    expect(salvar.getAttribute("aria-busy")).toBe("true");

    await clicar(salvar);
    // Esta asserção precisa falhar se apenas loading sair do disabled.
    expect(addAddress).toHaveBeenCalledTimes(1);
    expect(desabilitadoDuranteGravacao).toBe(true);
    expect(salvar.disabled).toBe(true);

    await act(async () => primeira.terminar(null));
    await esvaziar();
    expect(onBack).not.toHaveBeenCalled();
    expect(salvar.disabled).toBe(false);
    expect(salvar.getAttribute("aria-busy")).toBe("false");
    expect(salvar.textContent).toContain("Salvar endereço");
    expect((document.getElementById("number") as HTMLInputElement).value).toBe(
      "1250",
    );

    await clicar(salvar);
    expect(addAddress).toHaveBeenCalledTimes(2);
    expect(addAddress.mock.calls[1]).toEqual(addAddress.mock.calls[0]);
    expect(salvar.disabled).toBe(true);
    await act(async () => segunda.terminar({ id: "novo" }));
    await esvaziar();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

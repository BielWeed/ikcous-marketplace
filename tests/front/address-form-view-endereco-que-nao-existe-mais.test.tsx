// @vitest-environment jsdom
//
// Editar um endereço que não está na lista (apagado em outro aparelho, link
// antigo) abria um formulário EM BRANCO com o título "Editar endereço".
// Agora: "Carregando…" enquanto a busca corre; depois, se não achou, "Este
// endereço não existe mais." com botão Voltar (ou, se a busca falhou, um
// aviso que não afirma que o endereço sumiu).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  erroAoCarregar: false,
  busca: null as null | Promise<void>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u1", user_metadata: {} },
    profile: { full_name: "Mariana Lopes" },
  }),
}));
vi.mock("@/hooks/useAddresses", async () => {
  const React = await import("react");
  return {
    useAddresses: () => {
      const fetchAddresses = React.useCallback(
        () => estado.busca ?? Promise.resolve(),
        [],
      );
      return {
        addresses: [],
        loading: false,
        erroAoCarregar: estado.erroAoCarregar,
        fetchAddresses,
        addAddress: vi.fn(),
        updateAddress: vi.fn(),
      };
    },
  };
});
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

describe("AddressFormView — endereço de edição que não existe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onBack = vi.fn();

  beforeEach(() => {
    estado.erroAoCarregar = false;
    estado.busca = null;
    onBack.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
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

  async function montar() {
    const { AddressFormView } = await import(
      "@/views/customer/AddressFormView"
    );
    await act(async () => {
      raiz.render(<AddressFormView addressId="sumiu" onBack={onBack} />);
    });
  }

  it("enquanto a busca corre: 'Carregando…', sem formulário", async () => {
    let terminar!: () => void;
    estado.busca = new Promise<void>((r) => {
      terminar = r;
    });
    await montar();
    expect(hospedeiro.textContent).toContain("Carregando…");
    expect(hospedeiro.querySelector("form")).toBeNull();
    await act(async () => terminar());
  });

  it("busca terminou e não achou: 'não existe mais' + Voltar, não formulário em branco", async () => {
    await montar();
    await act(async () => {
      await Promise.resolve();
    });
    expect(hospedeiro.textContent).toContain("Este endereço não existe mais");
    expect(hospedeiro.textContent).not.toContain("Editar endereço");
    expect(hospedeiro.querySelector("form")).toBeNull();
    const voltar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Voltar",
    )!;
    act(() => voltar.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("busca falhou: não afirma que o endereço sumiu", async () => {
    estado.erroAoCarregar = true;
    await montar();
    await act(async () => {
      await Promise.resolve();
    });
    expect(hospedeiro.textContent).toContain("Não conseguimos carregar");
    expect(hospedeiro.textContent).not.toContain("não existe mais");
  });
});

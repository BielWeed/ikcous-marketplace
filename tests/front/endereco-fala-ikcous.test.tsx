// @vitest-environment jsdom
//
// Lote 1 do laudo "o que falta" (29/08, achado loja 11a): a tela de endereço
// dizia "seu produto da ICKOUS" — a marca do app é IKCOUS. Uma letra trocada
// na tela que o cliente vê no momento de dizer onde a encomenda chega.
//
// A prova é de ausência e presença: "ICKOUS" (com I antes do K) não pode
// existir em lugar nenhum da tela, e o cabeçalho correto do formulário novo
// precisa estar lá. Mesmo padrão dos testes de view desta pasta: render de
// verdade (react-dom/client + jsdom), dependências de rede mockadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    loading: false,
    fetchAddresses: vi.fn(),
    saveAddress: vi.fn(),
    deleteAddress: vi.fn(),
    setDefaultAddress: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// O AddressForm interno toca o client real de supabase, que não nasce no
// jsdom (RealtimeClient pede Web Worker). A tela em teste é só texto de
// cabeçalho — dublê de client resolve.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// O AddressForm interno lê a identidade da loja.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja de Teste",
      storeCity: "Cidade",
      storeState: "SP",
    },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O formulário interno usa Radix, que mede tamanho na montagem.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

describe("AddressFormView fala o nome certo da marca", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it('o cabeçalho do formulário novo diz "IKCOUS" e nunca "ICKOUS"', async () => {
    const { AddressFormView } = await import(
      "@/views/customer/AddressFormView"
    );
    await act(async () => {
      raiz.render(<AddressFormView addressId={undefined} onBack={() => {}} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const texto = document.body.textContent ?? "";
    expect(texto).not.toContain("ICKOUS");
    expect(texto).toContain("Onde entregaremos seu produto da IKCOUS?");
  });
});

// @vitest-environment jsdom
//
// Achado 2 da revisão (25/08/2026), no checkout de convidado — par de
// address-form-rua-manual-sobrevive-cep-sem-logradouro.test.tsx. Sem CEP de
// visita anterior no `localStorage` (o campo nasce vazio, como num cadastro
// novo do AddressForm), a rua digitada à mão não pode ser apagada pela
// primeira busca, mesmo quando ela é de localidade única (sem logradouro).
// Um mutante que remova a checagem de `null` de `eraDeOutroCep` (achado 2)
// faz este teste cair, mesmo que a suíte de "troca de CEP" continue verde.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "national", originCep: "38500-000" },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [
      {
        product: {
          id: "prod-1",
          name: "Produto Teste",
          description: "",
          price: 100,
          images: [],
          category: "geral",
          stock: 10,
          sold: 0,
          isActive: true,
          isBestseller: false,
          freeShipping: false,
          createdAt: new Date().toISOString(),
        },
        quantity: 1,
      },
    ],
    cartTotal: 100,
    shippingFee: 0,
    clearCart: vi.fn(),
    selectedShippingOption: null,
    shippingCep: "",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-guest-cep.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type FetchResolver = (data: unknown) => void;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CheckoutView (convidado) — sem CEP de visita anterior, rua digitada à mão sobrevive a um CEP sem logradouro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;
  let armazem: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pendentes = new Map();
    // Sem CEP salvo de visita anterior — o campo nasce vazio.
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    fetchMock = vi.fn((url: string) => {
      const cep = /viacep\.com\.br\/ws\/(\d+)\/json/.exec(url)?.[1] ?? "";
      return new Promise((resolve) => {
        pendentes.set(cep, (data: unknown) =>
          resolve({ json: () => Promise.resolve(data) } as Response),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
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
    Object.assign(mockConfig, {
      shippingCoverage: "national",
      originCep: "38500-000",
    });
  });

  it("primeira visita, sem CEP salvo: a rua digitada à mão não é apagada por um CEP de localidade única", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    expect(
      (document.getElementById("guest-cep") as HTMLInputElement).value,
    ).toBe("");

    act(() => {
      digitar("guest-street", "Rua Sem Nome Oficial, 42");
      digitar("guest-neighborhood", "Zona Rural");
    });

    act(() => {
      digitar("guest-cep", "38500000");
    });
    expect(pendentes.size).toBe(1);
    pendentes.get("38500000")!({
      logradouro: "",
      bairro: "",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const street = document.getElementById("guest-street") as HTMLInputElement;
    const neighborhood = document.getElementById(
      "guest-neighborhood",
    ) as HTMLInputElement;
    const city = document.getElementById("guest-city") as HTMLInputElement;
    const state = document.getElementById("guest-state") as HTMLInputElement;

    expect(city.value).toBe("Monte Carmelo");
    expect(state.value).toBe("MG");

    expect(street.value).toBe("Rua Sem Nome Oficial, 42");
    expect(neighborhood.value).toBe("Zona Rural");
  });
});

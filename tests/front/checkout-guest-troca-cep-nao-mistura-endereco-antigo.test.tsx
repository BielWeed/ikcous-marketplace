// @vitest-environment jsdom
//
// CARRINHO-03 no checkout de CONVIDADO: a mesma cópia do callback de
// AddressForm.tsx existe em CheckoutView.tsx, e ali é pior porque o CEP já
// chega pré-preenchido de `ikcous_last_shipping_cep` (linha ~262). Uma
// primeira busca preenche rua/bairro; se a pessoa troca de ideia e digita um
// CEP de localidade única (sem rua/bairro no ViaCEP), os campos da busca
// ANTERIOR não podem sobreviver misturados com a cidade/estado da busca
// nova.
//
// Par de address-form-troca-cep-nao-mistura-endereco-antigo.test.tsx, mas
// no checkout de convidado (sem `initialData` — a "fonte antiga" aqui vem de
// uma busca anterior na mesma sessão, não de um endereço salvo).
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

describe("CheckoutView (convidado) — trocar o CEP não mistura rua antiga com cidade nova", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;
  let armazem: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pendentes = new Map();
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

  it("segunda busca (localidade única) limpa rua e bairro em vez de manter os da primeira busca", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    // Primeira busca: CEP com rua/bairro completos.
    act(() => {
      digitar("guest-cep", "01310100");
    });
    expect(pendentes.size).toBe(1);
    pendentes.get("01310100")!({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      (document.getElementById("guest-street") as HTMLInputElement).value,
    ).toBe("Avenida Paulista");

    // A pessoa muda de ideia: digita um CEP de localidade única (sem
    // rua/bairro no ViaCEP).
    act(() => {
      digitar("guest-cep", "38500000");
    });
    expect(pendentes.size).toBe(2);
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

    // O defeito: rua e bairro da busca ANTERIOR não podem sobreviver
    // misturados com a cidade/estado da busca nova.
    expect(street.value).toBe("");
    expect(neighborhood.value).toBe("");
  });
});

// @vitest-environment jsdom
//
// Checkout de CONVIDADO: colar mais de 8 dígitos no CEP (ex.: "010020001",
// com um dígito a mais do próprio app de mensagens) cortava o campo em
// "01002-000" mas NÃO buscava o endereço, porque `limpo.length` dava 9. Rua e
// bairro do CEP ANTERIOR ficavam com o CEP novo, e o formulário seguia válido
// — endereço inconsistente enviado. A tela de endereço da conta já decide a
// busca pelos 8 primeiros dígitos (AddressForm.tsx); aqui é o mesmo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "national", originCep: "38500-000" },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
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

async function deixarAsPromessasAssentarem() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("CheckoutView (convidado) — CEP colado com mais de 8 dígitos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pendentes = new Map();
    const armazem = new Map<string, string>();
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
  });

  async function montar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
  }

  async function buscarPrimeiroCep() {
    act(() => {
      digitar("guest-cep", "01001000");
    });
    pendentes.get("01001000")!({
      logradouro: "Praça da Sé",
      bairro: "Sé",
      localidade: "São Paulo",
      uf: "SP",
    });
    await deixarAsPromessasAssentarem();
    expect(
      (document.getElementById("guest-street") as HTMLInputElement).value,
    ).toBe("Praça da Sé");
  }

  it("colar 9 dígitos busca os 8 primeiros e troca rua e bairro do CEP anterior", async () => {
    await montar();
    await buscarPrimeiroCep();

    act(() => {
      digitar("guest-cep", "010020001");
    });

    expect(
      (document.getElementById("guest-cep") as HTMLInputElement).value,
    ).toBe("01002-000");
    // O defeito: nenhuma busca saía para o CEP novo.
    expect(pendentes.has("01002000")).toBe(true);

    pendentes.get("01002000")!({
      logradouro: "Rua Nova do Outro CEP",
      bairro: "Outro Bairro",
      localidade: "São Paulo",
      uf: "SP",
    });
    await deixarAsPromessasAssentarem();

    expect(
      (document.getElementById("guest-street") as HTMLInputElement).value,
    ).toBe("Rua Nova do Outro CEP");
    expect(
      (document.getElementById("guest-neighborhood") as HTMLInputElement).value,
    ).toBe("Outro Bairro");
  });

  it("controle: 8 dígitos digitados um a um buscam só no oitavo", async () => {
    await montar();
    for (const parcial of [
      "0",
      "01",
      "010",
      "0100",
      "01001",
      "010010",
      "0100100",
    ]) {
      act(() => {
        digitar("guest-cep", parcial);
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      digitar("guest-cep", "01001000");
    });
    expect(pendentes.has("01001000")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("controle: 7 dígitos não buscam nada", async () => {
    await montar();
    act(() => {
      digitar("guest-cep", "0100200");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

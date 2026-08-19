// @vitest-environment jsdom
//
// O formulário de checkout (convidado) abria com cidade "Monte Carmelo",
// estado "MG" e CEP "38500-000" já escritos — quem não apagava mandava o
// pedido para uma cidade que não era a dele. Este arquivo prova que os três
// campos nascem vazios, em QUALQUER cobertura de entrega (a cobertura decide
// para onde a loja entrega, nunca onde o cliente mora), e que o "Aviso de
// Região" passa a ler a cidade da loja — sumindo quando ela não configurou.
//
// Montagem copiada de tests/front/checkout-guest-cep.test.tsx e
// tests/front/checkout-ordem-dos-campos-de-endereco.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

// `mockConfig` precisa ser declarado via `vi.hoisted` porque `vi.mock` é
// hoisted acima dos imports — mesmo padrão de checkout-guest-cep.test.tsx.
// Mutável de propósito: cada caso muda `shippingCoverage`/`storeCity`/
// `storeState` e o `afterEach` restaura o objeto inteiro.
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    originCep: undefined as string | undefined,
    storeCity: undefined as string | undefined,
    storeState: undefined as string | undefined,
  },
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

// `user: null` liga o bloco de endereço de convidado, onde os campos vazios
// vivem — cliente logado escolhe endereço salvo por outro caminho.
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// outros testes de checkout deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView (convidado) — para de preencher o endereço do cliente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    // Repõe o objeto INTEIRO, não só os campos que cada caso muda — mesma
    // guarda contra vazamento entre testes de checkout-guest-cep.test.tsx.
    Object.assign(mockConfig, {
      shippingCoverage: "national",
      originCep: undefined,
      storeCity: undefined,
      storeState: undefined,
    });
  });

  it("abre com cidade, estado e CEP vazios, em cobertura nacional", async () => {
    mockConfig.shippingCoverage = "national";
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const cep = document.getElementById("guest-cep") as HTMLInputElement;
    const city = document.getElementById("guest-city") as HTMLInputElement;
    const state = document.getElementById("guest-state") as HTMLInputElement;

    expect(cep.value).toBe("");
    expect(city.value).toBe("");
    expect(state.value).toBe("");
  });

  it("abre com cidade, estado e CEP vazios TAMBÉM em cobertura local", async () => {
    // Em cobertura local a loja entrega só na região dela, mas quem digita o
    // endereço é o cliente: o app pode SUGERIR, nunca PREENCHER.
    mockConfig.shippingCoverage = "local";
    mockConfig.storeCity = "Uberlândia";
    mockConfig.storeState = "MG";
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const cep = document.getElementById("guest-cep") as HTMLInputElement;
    const city = document.getElementById("guest-city") as HTMLInputElement;
    const state = document.getElementById("guest-state") as HTMLInputElement;

    expect(cep.value).toBe("");
    expect(city.value).toBe("");
    expect(state.value).toBe("");
  });

  it("o aviso de região mostra a cidade da loja quando ela configurou", async () => {
    mockConfig.storeCity = "Uberlândia";
    mockConfig.storeState = "MG";
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    expect(hospedeiro.textContent).toContain("Uberlândia, MG");
  });

  it("o aviso de região some quando a loja não configurou cidade", async () => {
    mockConfig.storeCity = undefined;
    mockConfig.storeState = undefined;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    // O bloco inteiro some — nunca "Monte Carmelo", nunca vírgula solta.
    expect(hospedeiro.textContent).not.toContain("Aviso de Região");
    expect(hospedeiro.textContent).not.toContain("Monte Carmelo");
  });
});

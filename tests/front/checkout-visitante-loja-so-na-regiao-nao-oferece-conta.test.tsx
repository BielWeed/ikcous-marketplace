// @vitest-environment jsdom
//
// Lote 242 (caça 12-A #2): loja que SÓ entrega na região dela.
//
// DEFEITO MEDIDO: o visitante de fora da área lia, ao mesmo tempo, "Esta loja
// entrega apenas na região dela" (a calculadora) e "Crie sua conta para receber
// em outro CEP" (a barra do Finalizar). Criar a conta não resolve nada ali: a
// loja não entrega fora da região para ninguém. Agora a oferta de conta não
// aparece nessa loja (o Finalizar segue apagado, e o motivo é o da calculadora);
// nas outras lojas a regra do convidado (30/08/2026) segue igual.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "local",
    originCep: "38500-000",
    localDeliveryEnabled: true as boolean | undefined,
  },
}));

// A calculadora de frete do checkout (cotação automática pelo endereço)
// tem suíte própria (shipping-calculator-*.test.tsx e
// checkout-frete-automatico-*.test.tsx). Aqui ela é neutra: não cota, não
// mexe na opção de frete que o teste preparou e não reporta status.
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
    freteIndefinido: false,
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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function pegarBotaoFinalizar(): HTMLButtonElement {
  const botao = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement;
  expect(botao).toBeDefined();
  return botao;
}

describe("CheckoutView (visitante) — loja que só entrega na região", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
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
      "fetch",
      vi.fn(() => new Promise(() => {})),
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
    vi.restoreAllMocks();
    Object.assign(mockConfig, {
      shippingCoverage: "local",
      originCep: "38500-000",
      localDeliveryEnabled: true,
    });
  });

  async function montarEDigitar(cep: string) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    act(() => {
      digitar("guest-cep", cep);
    });
    // A barra do Finalizar renderiza com atraso proposital (useDeferredRender).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    return (document.body.textContent ?? "").replace(/\u00A0/g, " ");
  }

  const botaoDeConta = () =>
    [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Entrar ou criar conta"),
    );

  it("loja só na região + CEP de fora: não oferece criar conta, e o Finalizar segue apagado", async () => {
    const texto = await montarEDigitar("01310100");

    expect(texto).not.toContain("Crie sua conta para receber em outro CEP");
    expect(texto).not.toContain("Entrega fora da cidade é só com conta");
    expect(botaoDeConta()).toBeUndefined();
    expect(pegarBotaoFinalizar().disabled).toBe(true);
  });

  it("controle: loja que entrega no país + CEP de fora: a oferta de conta segue (regra do visitante)", async () => {
    mockConfig.shippingCoverage = "national";

    const texto = await montarEDigitar("01310100");

    expect(texto).toContain("Crie sua conta para receber em outro CEP");
    expect(botaoDeConta()).toBeDefined();
    expect(pegarBotaoFinalizar().disabled).toBe(true);
  });

  it("controle: loja só na região + CEP da cidade: nenhum aviso de conta", async () => {
    const texto = await montarEDigitar("38500000");

    expect(texto).not.toContain("Crie sua conta para receber em outro CEP");
    expect(botaoDeConta()).toBeUndefined();
  });

  it("controle: loja 'só retiro' (sem entrega própria) com cobertura local + CEP de fora: o aviso não muda", async () => {
    mockConfig.localDeliveryEnabled = false;

    const texto = await montarEDigitar("01310100");

    expect(texto).toContain("Crie sua conta para receber em outro CEP");
  });
});

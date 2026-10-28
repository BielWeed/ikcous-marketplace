import type { CartItem, Product, ShippingOption } from "@/types";
// @vitest-environment jsdom
//
// Lote 257 (caça 13-F, achado 2): o resumo de cima e a barra de baixo do
// checkout montavam o dinheiro com `toFixed(2).replace(".", ",")` e saíam
// "R$ 1299,90" (sem o ponto do milhar), enquanto o resto da MESMA tela
// (`formatCurrency`) dizia "R$ 1.299,90". Aqui o pedido passa de mil reais em
// cada linha (item, subtotal, frete, frete riscado, desconto e total) e as duas
// superfícies têm de usar o mesmo formato. Só exibição: o valor enviado ao
// servidor não muda (provado nos testes de pedido, que seguem verdes).
//
// Harness: o mesmo de checkout-economia-do-frete-na-barra.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    originCep: "38500-000",
    localCepRange: undefined as string | undefined,
    localDeliveryFee: 1234.5 as number | undefined,
    freeShippingMin: 0 as number,
    enableCoupons: true,
  },
}));

const { mockUseCartOverrides } = vi.hoisted(() => ({
  mockUseCartOverrides: {
    freteGratis: false,
    selectedShippingOption: null as ShippingOption | null,
    freteIndefinido: false,
  },
}));

const { mockValidateCoupon } = vi.hoisted(() => ({
  mockValidateCoupon: vi.fn(),
}));

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

const mockAddresses = [
  {
    id: "addr-1",
    user_id: "user-1",
    name: "Casa",
    recipient_name: "Cliente Teste",
    cep: "01310-100",
    street: "Av Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    is_default: true,
  },
];

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: mockAddresses,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

// Referência ESTÁVEL (ver o comentário longo do teste de economia do frete).
const mockUser = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      cartTotal: 0,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      shippingCep: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      ...mockUseCartOverrides,
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: mockValidateCoupon }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(preco: number): Product {
  return {
    id: "prod-1",
    name: "Casaco de couro",
    description: "",
    price: preco,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Dinheiro de quatro dígitos ou mais SEM ponto de milhar: "R$ 1299,90". */
const DINHEIRO_SEM_MILHAR = /R\$\s?\d{4,},\d{2}/;

describe("CheckoutView — valores a partir de mil reais levam o ponto do milhar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  beforeEach(async () => {
    sessionStorage.clear();
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
    const { HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    slotDoHeader = document.createElement("div");
    slotDoHeader.id = HEADER_CENTER_SLOT_ID;
    document.body.appendChild(slotDoHeader);
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    mockValidateCoupon.mockReset();
    mockConfig.shippingCoverage = "national";
    mockConfig.originCep = "38500-000";
    mockConfig.localCepRange = undefined;
    mockConfig.localDeliveryFee = 1234.5;
    mockConfig.freeShippingMin = 0;
    mockUseCartOverrides.freteGratis = false;
    mockUseCartOverrides.freteIndefinido = false;
    mockUseCartOverrides.selectedShippingOption = null;
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

  afterEach(async () => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    slotDoHeader.remove();
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrir(cart: CartItem[], subtotal: number, shipping: number) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={subtotal}
          shipping={shipping}
          total={subtotal + shipping}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
  }

  async function abrirOPainel() {
    const gatilho = [...slotDoHeader.querySelectorAll("button")].find((b) =>
      b.hasAttribute("aria-expanded"),
    ) as HTMLButtonElement;
    await act(async () => {
      gatilho.click();
    });
    return document.body.querySelector(
      '[role="dialog"][aria-label="Resumo do pedido"]',
    )!;
  }

  function barraDeBaixo() {
    const finalizar = [...document.body.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Finalizar pedido",
    )!;
    return finalizar.closest(".bottom-docked-navigation")!;
  }

  it("frete pago com cupom: item, subtotal, frete, desconto e total saem com ponto de milhar no resumo e na barra", async () => {
    mockConfig.freeShippingMin = 0;
    mockUseCartOverrides.selectedShippingOption = {
      id: "local-delivery",
      name: "Entrega Local",
      price: 1234.5,
      deliveryDays: 1,
      provider: "local",
    };
    mockValidateCoupon.mockResolvedValue({ valid: true, discount: 1000.5 });
    await abrir([{ product: produto(1299.9), quantity: 1 }], 1299.9, 1234.5);

    act(() => digitar("coupon-code-input", "GRANDE"));
    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((b) => b.textContent === "Aplicar")!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const barra = barraDeBaixo();
    const painel = await abrirOPainel();
    for (const [nome, superficie] of [
      ["barra de baixo", barra],
      ["resumo de cima", painel],
    ] as const) {
      const texto = superficie.textContent ?? "";
      expect(texto, nome).toContain("R$ 1.299,90");
      expect(texto, nome).toContain("R$ 1.234,50");
      expect(texto, nome).toContain("-R$ 1.000,50");
      expect(texto, nome).toContain("R$ 1.533,90");
      expect(texto, nome).not.toMatch(DINHEIRO_SEM_MILHAR);
    }
    expect(painel.textContent).toContain("1 × R$ 1.299,90");
    expect(
      barra.querySelector('[aria-label="Desconto de R$ 1.000,50"]'),
    ).not.toBeNull();
  });

  it("frete grátis com economia: o valor riscado da Entrega leva o ponto de milhar", async () => {
    mockConfig.shippingCoverage = "local";
    mockConfig.originCep = "01310-100";
    mockConfig.freeShippingMin = 0.01;
    mockUseCartOverrides.freteGratis = true;
    mockUseCartOverrides.selectedShippingOption = {
      id: "local-delivery",
      name: "Entrega Local",
      price: 0,
      deliveryDays: 1,
      provider: "local",
    };
    await abrir([{ product: produto(1299.9), quantity: 1 }], 1299.9, 0);

    const barra = barraDeBaixo();
    const painel = await abrirOPainel();
    for (const [nome, superficie] of [
      ["barra de baixo", barra],
      ["resumo de cima", painel],
    ] as const) {
      const riscado = superficie.querySelector(".line-through");
      expect(riscado?.textContent, nome).toBe("R$ 1.234,50");
      expect(superficie.textContent, nome).toContain("Grátis");
      expect(superficie.textContent, nome).not.toMatch(DINHEIRO_SEM_MILHAR);
    }
  });

  it("frete com desconto da loja (não grátis): o cheio riscado e o final levam o ponto de milhar", async () => {
    mockUseCartOverrides.selectedShippingOption = {
      id: "pac",
      name: "PAC",
      price: 1000.5,
      precoCheio: 2234.5,
      deliveryDays: 7,
      provider: "melhor-envio",
    } as ShippingOption;
    await abrir([{ product: produto(1299.9), quantity: 1 }], 1299.9, 1000.5);

    const barra = barraDeBaixo();
    const painel = await abrirOPainel();
    for (const [nome, superficie] of [
      ["barra de baixo", barra],
      ["resumo de cima", painel],
    ] as const) {
      expect(superficie.querySelector(".line-through")?.textContent, nome).toBe(
        "R$ 2.234,50",
      );
      expect(superficie.textContent, nome).toContain("R$ 1.000,50");
      expect(superficie.textContent, nome).not.toMatch(DINHEIRO_SEM_MILHAR);
    }
  });

  it("abaixo de mil reais o texto é o de sempre (centavos, vírgula, espaço comum)", async () => {
    mockUseCartOverrides.selectedShippingOption = {
      id: "local-delivery",
      name: "Entrega Local",
      price: 5,
      deliveryDays: 1,
      provider: "local",
    };
    await abrir([{ product: produto(15), quantity: 1 }], 15, 5);

    const barra = barraDeBaixo();
    const painel = await abrirOPainel();
    for (const superficie of [barra, painel]) {
      const texto = superficie.textContent ?? "";
      expect(texto).toContain("R$ 15,00");
      expect(texto).toContain("R$ 5,00");
      expect(texto).toContain("R$ 20,00");
      expect(texto).not.toContain(" ");
    }
    expect(painel.textContent).toContain("1 × R$ 15,00");
  });
});

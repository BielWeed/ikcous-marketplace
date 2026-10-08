import type { CartItem, Product, ShippingOption } from "@/types";
// @vitest-environment jsdom
//
// CUPONS DESLIGADOS (issue #645, decisão do dono em 08/10/2026): com a chave
// `store_config.enable_coupons` em FALSO nenhum desconto de cupom entra no
// pedido — nem o de quem aplicou o cupom antes de a lojista desligar, nem o
// que o rascunho da sessão repõe ao reabrir o checkout. O campo de cupom já
// sumia com a chave desligada; o que faltava era o DESCONTO sumir junto.
//
// O que se prova aqui, contra a tela de verdade (a regra no servidor é do
// gatilho da migration 20261203000000, provado em tests/banco):
//   1. chave desligada + rascunho com cupom: o cupom não é revalidado nem
//      aplicado, o pedido sai SEM `couponCode` e com o total cheio, o rascunho
//      da sessão perde o código e a tela diz POR QUÊ (aviso fixo, fora do
//      bloco do campo de cupom que está oculto);
//   2. chave ligada, mesmo rascunho: nada muda (revalida, aplica o desconto,
//      o pedido leva o cupom e o total com desconto, sem aviso);
//   3. a chave vira para desligada com a tela ABERTA e o cupom já aplicado: o
//      desconto sai na hora (a config chega depois do cupom).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-1" });
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    originCep: "38500-000",
    localCepRange: undefined as string | undefined,
    localDeliveryFee: 12.9 as number | undefined,
    freeShippingMin: 0.01,
    enableCoupons: true as boolean | undefined,
  },
}));

const { mockUseCartOverrides } = vi.hoisted(() => ({
  mockUseCartOverrides: {
    freteGratis: true,
    selectedShippingOption: {
      id: "local-delivery",
      name: "Entrega Local",
      price: 0,
      deliveryDays: 1,
      provider: "local",
    } as ShippingOption | null,
    freteIndefinido: false,
  },
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

// Referência ESTÁVEL de `user` (ver checkout-economia-do-frete-na-barra).
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

const { mockValidateCoupon } = vi.hoisted(() => ({
  mockValidateCoupon: vi.fn(),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: mockValidateCoupon }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_DO_RASCUNHO = "ikcous-rascunho-do-checkout-v1";

function produto(overrides: Partial<Product> = {}): Product {
  return {
    id: overrides.id ?? "prod-1",
    name: overrides.name ?? "Produto Teste",
    description: "",
    price: overrides.price ?? 80,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const CART: CartItem[] = [
  { product: produto({ name: "Camiseta", price: 80 }), quantity: 1 },
];

async function esperar(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function localizarBotaoFinalizar() {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === "Finalizar pedido",
  ) as HTMLButtonElement | undefined;
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

function semearRascunhoComCupom(cupom: string | null) {
  globalThis.sessionStorage.setItem(
    CHAVE_DO_RASCUNHO,
    JSON.stringify({
      nome: "",
      whatsapp: "",
      cep: "",
      numero: "",
      rua: "",
      bairro: "",
      cidade: "",
      estado: "",
      complemento: "",
      notas: "",
      cupom,
    }),
  );
}

const AVISO = /A loja desativou os cupons de desconto/;

describe("CheckoutView — chave de cupons desligada descarta o cupom aplicado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  const montar = async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const el = (
      <CheckoutView
        cart={CART}
        subtotal={80}
        shipping={0}
        total={80}
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />
    );
    return el;
  };

  const finalizar = async () => {
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const botao = localizarBotaoFinalizar()!;
    expect(botao.disabled).toBe(false);
    await act(async () => {
      botao.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
    return createOrder.mock.calls[0][0];
  };

  beforeEach(async () => {
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
    createOrder.mockClear();
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    mockValidateCoupon.mockReset();
    mockValidateCoupon.mockResolvedValue({ valid: true, discount: 10 });
    mockConfig.enableCoupons = true;
    globalThis.sessionStorage.clear();
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
    globalThis.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("chave DESLIGADA + rascunho com cupom: não revalida, não aplica, pedido sai sem cupom e com o total cheio, rascunho limpo e aviso na tela", async () => {
    mockConfig.enableCoupons = false;
    semearRascunhoComCupom("CUPOM10");

    await act(async () => {
      raiz.render(await montar());
    });
    await esperar(420);

    // Nunca consulta nem aplica: o desconto some, não "vale até o fim".
    expect(mockValidateCoupon).not.toHaveBeenCalled();
    // O motivo está na tela (o campo de cupom está oculto com a chave desligada).
    expect(document.body.textContent).toMatch(AVISO);
    expect(document.body.textContent).toContain("CUPOM10");
    // O rascunho da sessão não guarda mais o código.
    const rascunho = JSON.parse(
      globalThis.sessionStorage.getItem(CHAVE_DO_RASCUNHO) ?? "{}",
    );
    expect(rascunho.cupom ?? null).toBeNull();

    const pedido = await finalizar();
    expect(pedido.couponCode).toBeUndefined();
    expect(pedido.totalAmount).toBe(80);
  });

  it("chave LIGADA + o mesmo rascunho: nada muda — revalida, aplica o desconto, o pedido leva o cupom e o total com desconto, sem aviso", async () => {
    mockConfig.enableCoupons = true;
    semearRascunhoComCupom("CUPOM10");

    await act(async () => {
      raiz.render(await montar());
    });
    await esperar(420);

    expect(mockValidateCoupon).toHaveBeenCalledWith("CUPOM10", 80);
    expect(document.body.textContent).not.toMatch(AVISO);

    const pedido = await finalizar();
    expect(pedido.couponCode).toBe("CUPOM10");
    expect(pedido.totalAmount).toBe(70);
  });

  it("a chave vira DESLIGADA com a tela aberta e o cupom já aplicado: o desconto sai, o aviso aparece e o pedido sai sem cupom", async () => {
    mockConfig.enableCoupons = true;
    semearRascunhoComCupom("CUPOM10");

    await act(async () => {
      raiz.render(await montar());
    });
    await esperar(420);
    expect(mockValidateCoupon).toHaveBeenCalledWith("CUPOM10", 80);
    expect(document.body.textContent).not.toMatch(AVISO);

    // A lojista desliga; a config nova chega (realtime/refresh) e a tela re-renderiza.
    mockConfig.enableCoupons = false;
    await act(async () => {
      raiz.render(await montar());
    });
    await esperar(50);

    expect(document.body.textContent).toMatch(AVISO);
    const pedido = await finalizar();
    expect(pedido.couponCode).toBeUndefined();
    expect(pedido.totalAmount).toBe(80);
  });
});

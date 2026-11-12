// @vitest-environment jsdom
//
// TOTAL NUNCA NEGATIVO COM CUPOM VELHO NA TELA (dinheiro, so exibicao). O cupom
// de valor fixo ja conferido (subtotal 100, desconto R$ 60) continua na tela
// quando o carrinho encolhe (subtotal 30) e a nova conferencia ainda nao
// chegou (ou nao teve resposta de rede). `finalTotal = total - discount`
// somava o desconto ANTIGO ao subtotal novo: o Total aparecia "-R$ 20,00" e,
// com frete gratis, a conta zerava e a tela passava a dizer "nao tem valor a
// pagar" para um pedido que TEM valor, escondendo o pagamento pelo app.
// O envio nunca esteve em risco (o Finalizar fica travado em
// `cupomEmConferencia`); o defeito era o que a cliente ENXERGA e a forma de
// pagamento. O desconto aplicado ao total nunca passa do subtotal de produtos.
import type { CartItem, Product, ShippingOption } from "@/types";
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

// Referência ESTÁVEL de `user` (ver checkout-economia-do-frete-na-barra). A
// conta é trocável entre renders: o caso "convidada entra na conta" muda `quem`.
const { mockUser, quemEstaLogado } = vi.hoisted(() => ({
  mockUser: { id: "user-1" },
  quemEstaLogado: { user: null as { id: string } | null },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: quemEstaLogado.user,
    profile: null,
    loading: false,
  }),
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

type RespostaDoCupom = {
  valid: boolean;
  discount: number;
  message?: string;
  networkError?: boolean;
};

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

/** Os props que o React guardou no nó: o handler real, mesmo com `disabled`. */
function propsDoReact(el: Element): { onClick?: () => void } {
  const entrada = Object.entries(el).find(([k]) =>
    k.startsWith("__reactProps$"),
  );
  return (entrada?.[1] ?? {}) as { onClick?: () => void };
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

/** Cada chamada de `validateCoupon` fica pendente até o teste responder. */
let respostasPendentes: Array<(r: RespostaDoCupom) => void> = [];
function responderAConferencia(r: RespostaDoCupom) {
  const responder = respostasPendentes.shift();
  if (!responder) throw new Error("nenhuma conferência de cupom pendente");
  return act(async () => {
    responder(r);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function preencherDados() {
  await act(async () => {
    digitar("checkout-name", "Cliente Teste");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    digitar("checkout-tel", "34999999999");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Toca no handler REAL do botão (o `disabled` do DOM não vale para quem chama o handler por outro caminho). */
async function tocarEmFinalizar() {
  const botao = localizarBotaoFinalizar()!;
  await act(async () => {
    propsDoReact(botao).onClick?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** O que a tela mostra ao lado de cada rótulo "Total" (barra de baixo e painel do resumo). */
function totaisNaTela(): string[] {
  return [...document.body.querySelectorAll("p, span")]
    .filter((el) => el.textContent?.trim() === "Total")
    .map((el) => el.nextElementSibling?.textContent?.trim() ?? "");
}

/** A forma de pagamento marcada (o `radio` com `aria-checked`). */
function formaMarcada(): string[] {
  return [
    ...document.body.querySelectorAll('[role="radio"][aria-checked="true"]'),
  ].map((el) => el.textContent?.trim() ?? "");
}

describe("CheckoutView — total nunca negativo com o cupom velho na tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  const montar = async (subtotal: number, frete: number) => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    return (
      <CheckoutView
        cart={CART}
        subtotal={subtotal}
        shipping={frete}
        total={subtotal + frete}
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />
    );
  };

  /** Abre com o cupom no rascunho e deixa a conferência responder `desconto`. */
  const abrirComCupomConferido = async (
    subtotal: number,
    frete: number,
    desconto: number,
  ) => {
    semearRascunhoComCupom("FIXO60");
    await act(async () => {
      raiz.render(await montar(subtotal, frete));
    });
    await esperar(420);
    await preencherDados();
    await responderAConferencia({ valid: true, discount: desconto });
  };

  const encolherCarrinho = async (subtotal: number, frete: number) => {
    await act(async () => {
      raiz.render(await montar(subtotal, frete));
    });
    await esperar(50);
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
    respostasPendentes = [];
    quemEstaLogado.user = mockUser;
    mockValidateCoupon.mockReset();
    mockValidateCoupon.mockImplementation(
      () =>
        new Promise<RespostaDoCupom>((resolve) => {
          respostasPendentes.push(resolve);
        }),
    );
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

  // A exibição usa o checkout real, não uma conta repetida no teste. Porém,
  // formatCurrency também arredonda: estes casos não detectam a retirada do
  // arredondarParaCentavos de finalTotal (mutante conferido separadamente).
  it.each([
    [29.95, 3, "R$ 26,95"],
    [0.3, 0.1, "R$ 0,20"],
  ])(
    "subtotal R$ %s e desconto R$ %s: o checkout renderizado mostra %s",
    async (subtotal, desconto, esperado) => {
      await abrirComCupomConferido(subtotal, 0, desconto);
      expect(totaisNaTela()).not.toHaveLength(0);
      for (const total of totaisNaTela()) expect(total).toBe(esperado);
    },
  );

  it("controle: com o cupom conferido, o Total mostra produtos − desconto + frete", async () => {
    await abrirComCupomConferido(100, 10, 60);
    expect(totaisNaTela()).not.toHaveLength(0);
    for (const total of totaisNaTela()) expect(total).toBe("R$ 50,00");
  });

  it("carrinho encolhe (100 → 30) com o cupom fixo de R$ 60 e a conferência pendente: o Total não fica negativo, não diz 'sem valor a pagar' e a forma marcada não troca", async () => {
    await abrirComCupomConferido(100, 10, 60);
    const marcadaAntes = formaMarcada();
    expect(marcadaAntes).toHaveLength(1);

    await encolherCarrinho(30, 10);
    expect(mockValidateCoupon).toHaveBeenLastCalledWith("FIXO60", 30);
    expect(respostasPendentes).toHaveLength(1);

    expect(totaisNaTela()).not.toHaveLength(0);
    for (const total of totaisNaTela()) {
      expect(total).toBe("R$ 10,00");
    }
    expect(document.body.textContent).not.toContain("não tem valor a pagar");
    expect(formaMarcada()).toEqual(marcadaAntes);
    // O envio segue travado enquanto a conferência não chega.
    expect(localizarBotaoFinalizar()!.disabled).toBe(true);
    await tocarEmFinalizar();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("mesma coisa com a conferência SEM resposta de rede: o desconto antigo fica, o Total não fica negativo e o envio continua travado", async () => {
    await abrirComCupomConferido(100, 10, 60);
    const marcadaAntes = formaMarcada();

    await encolherCarrinho(30, 10);
    await responderAConferencia({
      valid: false,
      discount: 0,
      message: "Erro na conexão com servidor",
      networkError: true,
    });

    expect(totaisNaTela()).not.toHaveLength(0);
    for (const total of totaisNaTela()) {
      expect(total).toBe("R$ 10,00");
    }
    expect(document.body.textContent).not.toContain("não tem valor a pagar");
    expect(formaMarcada()).toEqual(marcadaAntes);
    expect(localizarBotaoFinalizar()!.disabled).toBe(true);
    await tocarEmFinalizar();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("borda, frete grátis: com o desconto velho maior que os produtos o total até zera na conta, mas a tela NÃO diz 'sem valor a pagar' enquanto a conferência não chega", async () => {
    await abrirComCupomConferido(100, 0, 60);
    const marcadaAntes = formaMarcada();

    await encolherCarrinho(30, 0);
    expect(totaisNaTela()).not.toHaveLength(0);
    for (const total of totaisNaTela()) expect(total).toBe("R$ 0,00");
    expect(document.body.textContent).not.toContain("não tem valor a pagar");
    expect(formaMarcada()).toEqual(marcadaAntes);

    // A conferência chega: desconto real de R$ 6 → total R$ 24, pedido normal.
    await responderAConferencia({ valid: true, discount: 6 });
    for (const total of totaisNaTela()) expect(total).toBe("R$ 24,00");
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);
    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].totalAmount).toBe(24);
    expect(createOrder.mock.calls[0][0].couponCode).toBe("FIXO60");
  });
});

// @vitest-environment jsdom
//
// COMPRA QUE FECHA EM R$ 0,00 (decisão do dono, 14/10/2026): cupom que zera o
// produto + frete grátis (ou retirada) deixa o total em zero, e o app não
// cobra pedido sem valor (`criar-pagamento` recusa). Antes, quem trocava para
// "Pagar agora com PIX" travava. Agora, com total zero, a tela:
//
//   1. esconde o grupo "No app", marca sozinha a primeira forma "na
//      retirada/entrega" que a loja aceita e diz "não tem valor a pagar";
//   2. trava o Finalizar, com explicação e saída, quando a loja só recebe
//      pelo app ou o envio é por transportadora;
//   3. volta ao pagamento pelo app quando o cupom sai e o total tem valor;
//   4. com total ACIMA de zero é a tela de sempre.
import type { CartItem, Product, ShippingOption } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-1" });
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastInfo = vi.fn();
const toastError = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    originCep: "38500-000",
    localCepRange: undefined as string | undefined,
    localDeliveryFee: 12.9 as number | undefined,
    freeShippingMin: 0.01,
    enableCoupons: true as boolean | undefined,
    formasPagamentoEntrega: ["pix", "card", "cash"] as string[],
  },
}));

const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 0,
  deliveryDays: 1,
  provider: "local",
};
const RETIRADA: ShippingOption = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "local",
};
const TRANSPORTADORA: ShippingOption = {
  id: "melhor-envio-CorreiosSedex",
  name: "Sedex",
  price: 0,
  deliveryDays: 3,
  provider: "melhor_envio",
};

const { mockUseCartOverrides } = vi.hoisted(() => ({
  mockUseCartOverrides: {
    freteGratis: true,
    selectedShippingOption: null as ShippingOption | null,
    freteIndefinido: false,
  },
}));

let flagPagamentoOnline = true;
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => flagPagamentoOnline,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
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
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: toastInfo },
}));

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

function botaoFinalizar() {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === "Finalizar pedido",
  ) as HTMLButtonElement | undefined;
}

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
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

const SEM_VALOR = "não tem valor a pagar";

describe("CheckoutView — compra que fecha em R$ 0,00", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  const montar = async (
    valores: { subtotal: number; total: number } = {
      subtotal: 80,
      total: 80,
    },
  ) => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={CART}
          subtotal={valores.subtotal}
          shipping={0}
          total={valores.total}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperar(420);
  };

  // `comCpf`: envio por transportadora exige o CPF de quem recebe; sem ele o
  // Finalizar fica apagado por OUTRO motivo e o teste não prova a trava nova.
  const preencherIdentificacao = async (comCpf = false) => {
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (comCpf) {
      await act(async () => {
        digitar("checkout-cpf", "11144477735");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  const marcado = (texto: string) =>
    botaoPorTexto(texto)?.getAttribute("aria-checked");

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
    toastInfo.mockClear();
    toastError.mockClear();
    mockValidateCoupon.mockReset();
    // Cupom de 100%: zera os R$ 80 de produto.
    mockValidateCoupon.mockResolvedValue({ valid: true, discount: 80 });
    mockConfig.enableCoupons = true;
    mockConfig.formasPagamentoEntrega = ["pix", "card", "cash"];
    mockUseCartOverrides.selectedShippingOption = LOCAL;
    flagPagamentoOnline = true;
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

  it("cupom que zera a compra na entrega local: o app some, 'Pix na Entrega' fica marcado, a tela diz que não há valor e o pedido fecha", async () => {
    semearRascunhoComCupom("CUPOM100");
    await montar();

    expect(mockValidateCoupon).toHaveBeenCalledWith("CUPOM100", 80);
    // O grupo "No app" sumiu — nada de "Pagar agora com PIX".
    expect(botaoPorTexto("Pagar agora com PIX")).toBeUndefined();
    expect(document.body.textContent).not.toContain("No app");
    // A primeira forma da loja foi marcada sozinha.
    expect(marcado("Pix na Entrega")).toBe("true");
    expect(
      document.querySelector('[data-testid="checkout-pedido-sem-valor"]')
        ?.textContent,
    ).toContain(SEM_VALOR);
    expect(document.body.textContent).toContain("na entrega");

    await preencherIdentificacao();
    expect(botaoFinalizar()!.disabled).toBe(false);
    await act(async () => {
      botaoFinalizar()!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
    const pedido = createOrder.mock.calls[0][0];
    expect(pedido.totalAmount).toBe(0);
    expect(pedido.paymentMethod).toBe("pix");
    expect(pedido.couponCode).toBe("CUPOM100");
  });

  it("cupom que zera a compra na RETIRADA: o texto fala de retirada e a forma marcada é a da retirada", async () => {
    mockUseCartOverrides.selectedShippingOption = RETIRADA;
    semearRascunhoComCupom("CUPOM100");
    await montar();

    expect(botaoPorTexto("Pagar agora com PIX")).toBeUndefined();
    expect(marcado("Pix na Retirada")).toBe("true");
    expect(
      document.querySelector('[data-testid="checkout-pedido-sem-valor"]')
        ?.textContent,
    ).toContain("na retirada");
  });

  it("a loja só aceita dinheiro na entrega: marca 'Dinheiro na Entrega' em vez do Pix", async () => {
    mockConfig.formasPagamentoEntrega = ["cash"];
    semearRascunhoComCupom("CUPOM100");
    await montar();

    expect(botaoPorTexto("Pix na Entrega")).toBeUndefined();
    expect(marcado("Dinheiro na Entrega")).toBe("true");
    expect(botaoPorTexto("Pagar agora com PIX")).toBeUndefined();
  });

  it("total zero + loja que SÓ aceita o app: o Finalizar trava com a explicação, e 'Tirar o cupom' devolve o pagamento pelo app", async () => {
    mockConfig.formasPagamentoEntrega = [];
    semearRascunhoComCupom("CUPOM100");
    await montar();
    await preencherIdentificacao();

    expect(botaoPorTexto("Pagar agora com PIX")).toBeUndefined();
    expect(botaoFinalizar()!.disabled).toBe(true);
    const alerta = document.querySelector(
      '[data-testid="checkout-total-zero-trava"]',
    );
    expect(alerta?.textContent).toContain("Tire o cupom");
    expect(document.body.textContent).toContain("só recebe pelo app");
    // Sem o aviso de "entre na conta" nem o de "forma indisponível": a tela
    // não manda a cliente para um caminho que não existe.
    expect(document.body.textContent).not.toContain("Esta forma de pagamento");
    expect(createOrder).not.toHaveBeenCalled();

    // A saída: tirar o cupom. O total volta a ter valor e o app volta.
    await act(async () => {
      botaoPorTexto("Tirar o cupom")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperar(50);

    expect(botaoPorTexto("Pagar agora com PIX")).toBeDefined();
    expect(
      document.querySelector('[data-testid="checkout-total-zero-trava"]'),
    ).toBeNull();
    expect(document.body.textContent).not.toContain(SEM_VALOR);
    expect(botaoFinalizar()!.disabled).toBe(false);
  });

  it("cupom que zera uma compra com TRANSPORTADORA: o Finalizar trava e oferece escolher outro frete", async () => {
    mockUseCartOverrides.selectedShippingOption = TRANSPORTADORA;
    semearRascunhoComCupom("CUPOM100");
    await montar();
    await preencherIdentificacao(true);

    expect(botaoPorTexto("Pagar agora com PIX")).toBeUndefined();
    expect(botaoPorTexto("Pix na Entrega")).toBeUndefined();
    expect(botaoFinalizar()!.disabled).toBe(true);
    // O CPF está preenchido e correto: o botão não fica apagado por ele.
    expect(
      document.querySelector('[data-testid="checkout-resumo-falta-cpf"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="checkout-pedido-sem-valor"]')
        ?.textContent,
    ).toContain("transportadora");
    expect(
      document.querySelector('[data-testid="checkout-total-zero-trava"]')
        ?.textContent,
    ).toContain("retirada na loja");

    await act(async () => {
      botaoPorTexto("Escolher outro frete")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onNavigate).toHaveBeenCalledWith("cart");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("total zero desde o primeiro pintar (produto grátis) + transportadora: o efeito da transportadora NÃO empurra o 'PIX no app' — a tela trava", async () => {
    mockUseCartOverrides.selectedShippingOption = TRANSPORTADORA;
    await montar({ subtotal: 0, total: 0 });
    await preencherIdentificacao(true);

    expect(toastInfo).not.toHaveBeenCalled();
    expect(botaoPorTexto("Pagar agora com PIX")).toBeUndefined();
    expect(botaoFinalizar()!.disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="checkout-total-zero-trava"]'),
    ).not.toBeNull();
    // Sem cupom, a saída não fala de cupom.
    expect(document.body.textContent).not.toContain("tire o cupom");
  });

  it("total ACIMA de zero (cupom de R$ 10): a tela é a de sempre — grupo 'No app' presente, sem aviso de pedido sem valor", async () => {
    mockValidateCoupon.mockResolvedValue({ valid: true, discount: 10 });
    semearRascunhoComCupom("CUPOM10");
    await montar();

    expect(botaoPorTexto("Pagar agora com PIX")).toBeDefined();
    expect(document.body.textContent).toContain("No app");
    expect(botaoPorTexto("Pix na Entrega")).toBeDefined();
    expect(document.body.textContent).not.toContain(SEM_VALOR);
    expect(
      document.querySelector('[data-testid="checkout-total-zero-trava"]'),
    ).toBeNull();
    // O padrão do componente segue valendo: nada foi trocado sozinho.
    expect(marcado("Pix na Entrega")).toBe("true");
  });

  it("total acima de zero e loja só-app: continua sem aviso de total zero (trava só existe com total zero)", async () => {
    mockConfig.formasPagamentoEntrega = [];
    await montar();

    expect(document.body.textContent).not.toContain(SEM_VALOR);
    expect(
      document.querySelector('[data-testid="checkout-total-zero-trava"]'),
    ).toBeNull();
    expect(botaoPorTexto("Pagar agora com PIX")).toBeDefined();
  });

  it("quem tinha escolhido 'Pagar agora com PIX', aplica um cupom que zera e depois o remove: a escolha do app volta sozinha", async () => {
    await montar();

    // Escolhe o pagamento pelo app, sem cupom.
    await act(async () => {
      botaoPorTexto("Pagar agora com PIX")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(marcado("Pagar agora com PIX")).toBe("true");

    // Aplica o cupom que zera a compra pelo campo da tela.
    await act(async () => {
      digitar("coupon-code-input", "CUPOM100");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      botaoPorTexto("Aplicar")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperar(50);

    expect(botaoPorTexto("Pagar agora com PIX")).toBeUndefined();
    expect(marcado("Pix na Entrega")).toBe("true");
    expect(document.body.textContent).toContain(SEM_VALOR);

    // Tira o cupom: o total volta a ter valor e a escolha do app volta.
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Remover cupom"]')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperar(50);

    expect(document.body.textContent).not.toContain(SEM_VALOR);
    expect(marcado("Pagar agora com PIX")).toBe("true");
    expect(marcado("Pix na Entrega")).toBe("false");
  });

  it("se a cliente escolheu OUTRA forma enquanto o total estava zerado, tirar o cupom não a desfaz", async () => {
    await montar();
    await act(async () => {
      botaoPorTexto("Pagar agora com PIX")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      digitar("coupon-code-input", "CUPOM100");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      botaoPorTexto("Aplicar")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperar(50);

    // O total zerou (o app saiu) e ela mesma troca para dinheiro.
    expect(botaoPorTexto("Pagar agora com PIX")).toBeUndefined();
    await act(async () => {
      botaoPorTexto("Dinheiro na Entrega")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Remover cupom"]')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperar(50);

    expect(marcado("Dinheiro na Entrega")).toBe("true");
    expect(marcado("Pagar agora com PIX")).toBe("false");
  });
});

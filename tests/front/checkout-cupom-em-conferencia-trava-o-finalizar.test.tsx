// @vitest-environment jsdom
//
// CUPOM EM CONFERÊNCIA NÃO DEIXA FINALIZAR (dinheiro). Ao reabrir o checkout, o
// cupom do rascunho volta com desconto 0 e é revalidado em segundo plano; a tela
// já diz "Conferindo o desconto…". Até esta correção o "Finalizar Pedido" ficava
// livre nesse intervalo: o pedido saía com o total SEM o desconto (ou com o
// desconto de um subtotal velho) e o servidor, que só tolera R$ 0,05 de
// diferença, recusava com "Os valores do pedido mudaram...", ou criava o pedido
// sem o desconto que a cliente achava ter.
//
// Provado contra a tela de verdade (harness de checkout-cupons-desligados-
// descartam-o-cupom.test.tsx), com a resposta da revalidação na mão do teste:
//   1. revalidação pendente: botão desabilitado E o handler ignora o envio;
//   2. revalidação válida: habilita, e o pedido leva cupom + total com desconto;
//   3. revalidação inválida: o cupom sai e o pedido sai sem ele, total cheio;
//   4. revalidação sem resposta (rede): NÃO trava para sempre — o motivo aparece
//      e remover o cupom libera o envio (total cheio, sem cupom);
//   5. subtotal que muda com o cupom aplicado (carrinho encolheu): o desconto
//      velho também não vai no pedido enquanto a nova conferência não chega.
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

describe("CheckoutView — cupom em conferência não deixa finalizar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  // `semRemontar`: a `CheckoutView` real remonta a tela inteira (`key` = conta)
  // quando a conta muda; `CheckoutViewDaConta` é a mesma tela SEM esse remonte,
  // o único jeito de a conta mudar com o estado vivo e provar a comparação.
  const montar = async (subtotal = 80, semRemontar = false) => {
    const { CheckoutView, CheckoutViewDaConta } = await import(
      "@/views/customer/CheckoutView"
    );
    const Tela = semRemontar ? CheckoutViewDaConta : CheckoutView;
    return (
      <Tela
        cart={CART}
        subtotal={subtotal}
        shipping={0}
        total={subtotal}
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />
    );
  };

  const preencherDados = async () => {
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  /** Toca no handler REAL do botão (o `disabled` do DOM não vale para quem chama o handler por outro caminho). */
  const tocarEmFinalizar = async () => {
    const botao = localizarBotaoFinalizar()!;
    await act(async () => {
      propsDoReact(botao).onClick?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const abrirComRascunho = async (subtotal = 80, semRemontar = false) => {
    semearRascunhoComCupom("CUPOM10");
    await act(async () => {
      raiz.render(await montar(subtotal, semRemontar));
    });
    await esperar(420);
    await preencherDados();
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

  it("revalidação pendente: botão apagado e o envio é ignorado; ao chegar válida, habilita e o pedido leva cupom e total com desconto", async () => {
    await abrirComRascunho();

    expect(mockValidateCoupon).toHaveBeenCalledWith("CUPOM10", 80);
    expect(document.body.textContent).toContain("Conferindo o desconto");
    expect(localizarBotaoFinalizar()!.disabled).toBe(true);

    await tocarEmFinalizar();
    expect(createOrder).not.toHaveBeenCalled();

    await responderAConferencia({ valid: true, discount: 10 });
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);

    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    const pedido = createOrder.mock.calls[0][0];
    expect(pedido.couponCode).toBe("CUPOM10");
    expect(pedido.totalAmount).toBe(70);
  });

  it("revalidação diz que o cupom é inválido: o cupom sai, o botão habilita e o pedido sai sem cupom e com o total cheio", async () => {
    await abrirComRascunho();
    expect(localizarBotaoFinalizar()!.disabled).toBe(true);

    await responderAConferencia({
      valid: false,
      discount: 0,
      message: "Cupom expirado.",
    });
    expect(document.body.textContent).toContain("Cupom expirado.");
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);

    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    const pedido = createOrder.mock.calls[0][0];
    expect(pedido.couponCode).toBeUndefined();
    expect(pedido.totalAmount).toBe(80);
  });

  it("revalidação SEM resposta (rede): não trava para sempre — explica e, ao remover o cupom, o pedido sai sem ele", async () => {
    await abrirComRascunho();

    await responderAConferencia({
      valid: false,
      discount: 0,
      message: "Erro na conexão com servidor",
      networkError: true,
    });
    // Sem resposta, o desconto real é desconhecido: segue travado, mas a tela diz o porquê.
    expect(localizarBotaoFinalizar()!.disabled).toBe(true);
    expect(document.body.textContent).toMatch(/Não deu para conferir/);
    await tocarEmFinalizar();
    expect(createOrder).not.toHaveBeenCalled();

    const remover = [...document.body.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Remover cupom",
    ) as HTMLButtonElement;
    expect(remover).toBeDefined();
    await act(async () => {
      remover.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);

    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    const pedido = createOrder.mock.calls[0][0];
    expect(pedido.couponCode).toBeUndefined();
    expect(pedido.totalAmount).toBe(80);
  });

  it("subtotal muda com o cupom já conferido (carrinho encolheu): o desconto velho não vai no pedido até a nova conferência chegar", async () => {
    await abrirComRascunho(80);
    await responderAConferencia({ valid: true, discount: 10 });
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);

    await act(async () => {
      raiz.render(await montar(60));
    });
    await esperar(50);
    expect(mockValidateCoupon).toHaveBeenLastCalledWith("CUPOM10", 60);
    expect(localizarBotaoFinalizar()!.disabled).toBe(true);
    await tocarEmFinalizar();
    expect(createOrder).not.toHaveBeenCalled();

    await responderAConferencia({ valid: true, discount: 6 });
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);
    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].couponCode).toBe("CUPOM10");
  });

  it("convidada com o cupom já conferido entra na conta (tela real, que remonta): o cupom volta do rascunho e trava até a conferência da conta chegar", async () => {
    quemEstaLogado.user = null;
    await abrirComRascunho(80);
    await responderAConferencia({ valid: true, discount: 10 });

    quemEstaLogado.user = mockUser;
    await act(async () => {
      raiz.render(await montar(80));
    });
    await esperar(420);
    await preencherDados();
    expect(mockValidateCoupon).toHaveBeenCalledTimes(2);
    expect(localizarBotaoFinalizar()!.disabled).toBe(true);
    await tocarEmFinalizar();
    expect(createOrder).not.toHaveBeenCalled();

    await responderAConferencia({ valid: true, discount: 10 });
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);
    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].totalAmount).toBe(70);
  });

  it("a conta muda com a tela viva e o cupom já conferido (código e subtotal iguais): a conferência era de OUTRA conta — trava até a nova chegar", async () => {
    quemEstaLogado.user = null;
    await abrirComRascunho(80, true);
    expect(mockValidateCoupon).toHaveBeenCalledTimes(1);
    await responderAConferencia({ valid: true, discount: 10 });
    expect(document.body.textContent).not.toContain("Conferindo o desconto");

    // A conta entra com o cupom na tela: o cupom fica (convidado → conta não é
    // troca), mas a conferência dele era de OUTRA conta.
    quemEstaLogado.user = mockUser;
    await act(async () => {
      raiz.render(await montar(80, true));
    });
    await esperar(50);
    expect(mockValidateCoupon).toHaveBeenCalledTimes(2);
    expect(mockValidateCoupon).toHaveBeenLastCalledWith("CUPOM10", 80);
    expect(localizarBotaoFinalizar()!.disabled).toBe(true);
    await tocarEmFinalizar();
    expect(createOrder).not.toHaveBeenCalled();

    await responderAConferencia({ valid: true, discount: 10 });
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);
    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    const pedido = createOrder.mock.calls[0][0];
    expect(pedido.couponCode).toBe("CUPOM10");
    expect(pedido.totalAmount).toBe(70);
  });
});

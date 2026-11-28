// @vitest-environment jsdom
//
// O CUPOM MUDOU ENQUANTO A CLIENTE FINALIZAVA (caça 27/11/2026). A lojista
// edita o cupom (valor, percentual) com o checkout aberto e o cupom aplicado:
// a RPC recalcula o desconto, o total diverge e ela recusa com "Os valores do
// pedido mudaram. Atualize o carrinho e tente novamente." — e a tela mandava a
// cliente ao CARRINHO, sem dizer que quem mudou foi o CUPOM.
//
// Agora, com cupom no pedido recusado, a tela relê o cupom antes de soltar o
// Finalizar:
//   1. desconto novo: a frase nomeia o cupom e o desconto conferido, o total
//      da tela passa a ser o novo e o toque seguinte leva esse total;
//   2. o cupom não vale mais: a frase diz isso e oferece tirar o cupom;
//   3. desconto igual (controle): o motivo foi outro (preço) — fica a frase e
//      a saída de sempre;
//   4. conferência sem resposta: também fica a frase de sempre;
//   5. cupom intacto (controle): o pedido fecha sem conferência extra.
// Harness de checkout-cupom-em-conferencia-trava-o-finalizar.test.tsx.
import type { CartItem, Product, ShippingOption } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const createOrder = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();

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

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
      addresses: [
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
      ],
      addAddress: vi.fn(),
      updateAddress: vi.fn(),
      loading: false,
    }),
}));

const { mockUser } = vi.hoisted(() => ({ mockUser: { id: "user-1" } }));
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

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_DO_RASCUNHO = "ikcous-rascunho-do-checkout-v1";

/** A recusa do passo 6 da create_marketplace_order_v24 (total divergente). */
const RECUSA_DOS_VALORES = {
  code: "P0001",
  message:
    "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
};

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
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function painelDaRecusa(): HTMLElement | null {
  return (
    (document.body
      .querySelector("[data-acao]")
      ?.closest('[role="alert"]') as HTMLElement | null) ?? null
  );
}

describe("CheckoutView — o cupom mudou enquanto a cliente finalizava", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  const montar = async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    return (
      <CheckoutView
        cart={CART}
        subtotal={80}
        shipping={0}
        total={80}
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />
    );
  };

  const tocarEmFinalizar = async () => {
    const botao = localizarBotaoFinalizar()!;
    await act(async () => {
      propsDoReact(botao).onClick?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  /** Abre com o CUPOM10 do rascunho já conferido em R$ 10,00 (total R$ 70,00). */
  const abrirComCupomConferido = async () => {
    semearRascunhoComCupom("CUPOM10");
    await act(async () => {
      raiz.render(await montar());
    });
    await esperar(420);
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await responderAConferencia({ valid: true, discount: 10 });
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);
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
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "ped-1" });
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    toastError.mockReset();
    respostasPendentes = [];
    mockValidateCoupon.mockReset();
    mockValidateCoupon.mockImplementation(
      () =>
        new Promise<RespostaDoCupom>((resolve) => {
          respostasPendentes.push(resolve);
        }),
    );
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

  it("desconto novo: a tela relê o cupom com o Finalizar travado, diz que o CUPOM mudou com o desconto conferido, e o toque seguinte leva o total novo", async () => {
    await abrirComCupomConferido();
    createOrder.mockRejectedValueOnce(RECUSA_DOS_VALORES);

    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].totalAmount).toBe(70);

    // A recusa chegou: a tela relê o cupom ANTES de soltar o Finalizar.
    expect(mockValidateCoupon).toHaveBeenCalledTimes(2);
    expect(mockValidateCoupon).toHaveBeenLastCalledWith("CUPOM10", 80);
    expect(localizarBotaoFinalizar()!.disabled).toBe(true);
    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);

    // A lojista baixou o cupom para R$ 5,00.
    await responderAConferencia({ valid: true, discount: 5 });

    const painel = painelDaRecusa();
    expect(painel?.textContent).toContain(
      "O cupom CUPOM10 mudou enquanto você finalizava",
    );
    expect(painel?.textContent).toMatch(/R\$\s5,00/);
    expect(painel?.textContent).not.toContain("Atualize o carrinho");
    // A saída oferecida é tirar o cupom (nunca "Atualizar o carrinho").
    expect(
      painel?.querySelector("[data-acao]")?.getAttribute("data-acao"),
    ).toBe("remover_cupom");
    // Toast e painel dizem a MESMA coisa.
    const ultimoToast = String(toastError.mock.calls.at(-1)?.[0] ?? "");
    expect(ultimoToast).toContain(
      "O cupom CUPOM10 mudou enquanto você finalizava",
    );
    expect(ultimoToast).not.toContain("Atualize o carrinho");
    // A cliente não foi mandada a lugar nenhum: o problema está nesta tela.
    expect(onNavigate).not.toHaveBeenCalledWith("cart");

    // O total da tela já é o novo; o toque seguinte leva ESSE total.
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);
    expect(document.body.textContent).toMatch(/R\$\s75,00/);
    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(2);
    const pedido = createOrder.mock.calls[1][0];
    expect(pedido.couponCode).toBe("CUPOM10");
    expect(pedido.totalAmount).toBe(75);
    // A conferência da recusa vale: nenhuma terceira consulta antes do envio.
    expect(mockValidateCoupon).toHaveBeenCalledTimes(2);
  });

  it("o cupom não vale mais na releitura: a frase diz que o cupom mudou e oferece tirar; tirado, o pedido sai com o total cheio", async () => {
    await abrirComCupomConferido();
    createOrder.mockRejectedValueOnce(RECUSA_DOS_VALORES);

    await tocarEmFinalizar();
    await responderAConferencia({
      valid: false,
      discount: 0,
      message: "Cupom expirado.",
    });

    const painel = painelDaRecusa();
    expect(painel?.textContent).toContain(
      "O cupom CUPOM10 mudou enquanto você finalizava e não vale mais",
    );
    expect(painel?.textContent).not.toContain("Atualize o carrinho");
    const botao = painel?.querySelector("[data-acao]") as HTMLButtonElement;
    expect(botao.getAttribute("data-acao")).toBe("remover_cupom");

    await act(async () => {
      botao.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(painelDaRecusa()).toBeNull();
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);

    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(2);
    const pedido = createOrder.mock.calls[1][0];
    expect(pedido.couponCode).toBeUndefined();
    expect(pedido.totalAmount).toBe(80);
  });

  it("controle — o desconto do cupom NÃO mudou: a recusa é do preço e fica com a frase e a saída dela", async () => {
    await abrirComCupomConferido();
    createOrder.mockRejectedValueOnce(RECUSA_DOS_VALORES);

    await tocarEmFinalizar();
    await responderAConferencia({ valid: true, discount: 10 });

    const painel = painelDaRecusa();
    expect(painel?.textContent).toContain(RECUSA_DOS_VALORES.message);
    expect(painel?.textContent).not.toContain("O cupom CUPOM10 mudou");
    expect(
      painel?.querySelector("[data-acao]")?.getAttribute("data-acao"),
    ).toBe("reconferir_carrinho");
    // O desconto da tela continua o mesmo.
    expect(document.body.textContent).toMatch(/R\$\s70,00/);
  });

  it("a releitura do cupom fica sem resposta: não inventa motivo — fica a frase de sempre", async () => {
    await abrirComCupomConferido();
    createOrder.mockRejectedValueOnce(RECUSA_DOS_VALORES);

    await tocarEmFinalizar();
    await responderAConferencia({
      valid: false,
      discount: 0,
      message: "A conexão está lenta. Tente aplicar o cupom de novo.",
      networkError: true,
    });

    const painel = painelDaRecusa();
    expect(painel?.textContent).toContain(RECUSA_DOS_VALORES.message);
    expect(
      painel?.querySelector("[data-acao]")?.getAttribute("data-acao"),
    ).toBe("reconferir_carrinho");
  });

  it("controle — cupom intacto: o pedido fecha sem nenhuma releitura extra do cupom", async () => {
    await abrirComCupomConferido();

    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].totalAmount).toBe(70);
    expect(mockValidateCoupon).toHaveBeenCalledTimes(1);
    expect(painelDaRecusa()).toBeNull();
  });
});

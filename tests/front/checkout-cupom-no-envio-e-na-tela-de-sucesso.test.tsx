// @vitest-environment jsdom
//
// CAÇA 4 (24/10/2026), achados C1 e C4 do checkout:
//
// C1 — depois do pedido fechado o carrinho esvazia, o subtotal vai a zero e o
//   efeito que revalida o cupom rodava mesmo assim: a conferência com subtotal
//   0 devolvia "mínimo não atingido" (o cupom saía do estado) ou desconto 0 —
//   a tela "Pedido Celebrado!" perdia o selo "Vantagem Ativa: R$ X OFF" ou
//   mostrava R$ 0,00. Compra concluída não confere cupom de novo.
//
// C4 — o cupom podia ser aplicado ou removido enquanto o pedido estava sendo
//   enviado: a tela mudava (total, selo), o pedido já tinha ido com o outro
//   desconto. Com o envio em curso, aplicar e remover ficam travados.
import type { CartItem, Product, ShippingOption } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    originCep: "38500-000",
    localCepRange: undefined as string | undefined,
    localDeliveryFee: 12.9 as number | undefined,
    freeShippingMin: 0,
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

// Desligado: o pedido fecha na tela de sucesso (não em "aguardando pagamento").
let flagPagamentoOnline = false;
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

// Referência ESTÁVEL de `user` (um objeto novo por render reabriria efeitos).
const USUARIA = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIA, profile: null, loading: false }),
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
      freteGratis: false,
      selectedShippingOption: LOCAL,
      freteIndefinido: false,
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
  useOrders: () => ({
    createOrder,
    updateOrderStatus: vi.fn(),
    // A tela de aguardar o pagamento pede o PIX; aqui ele nunca chega.
    criarPagamento: () => new Promise(() => {}),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(): Product {
  return {
    id: "prod-1",
    name: "Camiseta",
    description: "",
    price: 80,
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

const CART: CartItem[] = [{ product: produto(), quantity: 1 }];

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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CheckoutView — cupom no envio e na tela de sucesso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  // O mesmo desenho do app: o `onClearCart` da conclusão esvazia o carrinho que
  // a tela recebe (carrinho e subtotal vão a zero).
  const montar = async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const desenhar = (cart: CartItem[], subtotal: number) => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={subtotal}
          shipping={0}
          total={subtotal}
          onClearCart={() => desenhar([], 0)}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    };
    await act(async () => {
      desenhar(CART, 80);
    });
    await esperar(420);
  };

  const preencherIdentificacao = async () => {
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const aplicarCupom = async (codigo: string) => {
    await act(async () => {
      digitar("coupon-code-input", codigo);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Aplicar")!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperar(50);
  };

  const botaoRemoverCupom = () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Remover cupom"]');

  const cupomAplicadoNaTela = () =>
    document.querySelector('[data-testid="cupom-aplicado"]');

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
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    mockValidateCoupon.mockReset();
    // Como o servidor: cupom de R$ 10 com mínimo de R$ 50 em produtos.
    mockValidateCoupon.mockImplementation(
      async (_codigo: string, subtotal: number) =>
        subtotal >= 50
          ? { valid: true, discount: 10 }
          : { valid: false, message: "Compra mínima de R$ 50,00" },
    );
    mockConfig.enableCoupons = true;
    flagPagamentoOnline = false;
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

  it("C1: pedido fechado com cupom — a tela de sucesso mantém o selo com o valor do desconto e não confere o cupom com carrinho vazio", async () => {
    createOrder.mockResolvedValue({ id: "ped-1", totalAmount: 70 });
    await montar();
    await aplicarCupom("DEZ");
    expect(mockValidateCoupon).toHaveBeenLastCalledWith("DEZ", 80);
    await preencherIdentificacao();
    expect(botaoFinalizar()!.disabled).toBe(false);

    await act(async () => {
      botaoFinalizar()!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperar(50);

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].couponCode).toBe("DEZ");
    // É a tela de sucesso.
    expect(document.body.textContent).toContain("Pedido Celebrado!");
    // O selo guarda o desconto do pedido, não o de uma conferência com R$ 0.
    expect(document.body.textContent).toContain("Vantagem Ativa: R$ 10,00 OFF");
    // Nenhuma conferência de cupom com o carrinho já vazio.
    expect(
      mockValidateCoupon.mock.calls.filter(([, subtotal]) => subtotal === 0),
    ).toEqual([]);
  });

  it("C1: pedido com pagamento pelo app — a tela de aguardar o pagamento também não confere o cupom com carrinho vazio", async () => {
    flagPagamentoOnline = true;
    createOrder.mockResolvedValue({ id: "ped-3", totalAmount: 70 });
    await montar();
    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Pagar agora com PIX"))!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await aplicarCupom("DEZ");
    await preencherIdentificacao();
    expect(botaoFinalizar()!.disabled).toBe(false);

    await act(async () => {
      botaoFinalizar()!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperar(50);

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][1]).toEqual({ comPagamentoOnline: true });
    expect(
      mockValidateCoupon.mock.calls.filter(([, subtotal]) => subtotal === 0),
    ).toEqual([]);
  });

  it("C4: com o pedido sendo enviado, 'Remover' do cupom fica travado e o cupom segue na tela", async () => {
    let concluirEnvio: (pedido: { id: string; totalAmount: number }) => void =
      () => {};
    createOrder.mockReturnValue(
      new Promise((resolve) => {
        concluirEnvio = resolve;
      }),
    );
    await montar();
    await aplicarCupom("DEZ");
    await preencherIdentificacao();

    await act(async () => {
      botaoFinalizar()!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // O envio está em curso: o pedido saiu e ainda não houve resposta.
    expect(createOrder).toHaveBeenCalledTimes(1);

    expect(botaoRemoverCupom()?.disabled).toBe(true);
    await act(async () => {
      botaoRemoverCupom()!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(cupomAplicadoNaTela()).not.toBeNull();
    expect(document.body.textContent).toContain("DEZ");

    // Quem chama o handler por fora do botão apagado (o `disabled` do DOM só
    // barra o clique) também é barrado: o handler capturado dos props do React.
    const chaveProps = Object.keys(botaoRemoverCupom()!).find((k) =>
      k.startsWith("__reactProps$"),
    )!;
    const props = (
      botaoRemoverCupom() as unknown as Record<string, { onClick?: () => void }>
    )[chaveProps];
    expect(typeof props?.onClick).toBe("function");
    await act(async () => {
      props.onClick!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(cupomAplicadoNaTela()).not.toBeNull();

    // Quando a resposta chega, a tela de sucesso mostra o desconto do pedido.
    await act(async () => {
      concluirEnvio({ id: "ped-2", totalAmount: 70 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperar(50);
    expect(document.body.textContent).toContain("Vantagem Ativa: R$ 10,00 OFF");
  });

  it("C4: com o pedido sendo enviado, aplicar um cupom (mesmo por fora do botão) não consulta nem muda nada", async () => {
    createOrder.mockReturnValue(new Promise(() => {}));
    await montar();
    await preencherIdentificacao();

    await act(async () => {
      botaoFinalizar()!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
    mockValidateCoupon.mockClear();

    await act(async () => {
      digitar("coupon-code-input", "DEZ");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Com código digitado, só o envio em curso apaga o botão.
    const aplicar = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Aplicar",
    ) as HTMLButtonElement;
    expect(aplicar.disabled).toBe(true);
    // O envio do formulário por outro caminho (Enter no campo) é barrado pelo
    // próprio handler.
    await act(async () => {
      document
        .getElementById("coupon-code-input")!
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperar(50);

    expect(mockValidateCoupon).not.toHaveBeenCalled();
    expect(cupomAplicadoNaTela()).toBeNull();
  });
});

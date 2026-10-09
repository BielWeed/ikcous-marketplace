// @vitest-environment jsdom
//
// Frente B (28/09/2026), refeita sobre o principal (09/10/2026): o cupom no
// CheckoutView.
//   - um toque em "Aplicar" valida UMA vez e toque duplo com a validação em
//     voo não valida de novo;
//   - a resposta da validação que chega depois de a conta trocar é descartada
//     (o cupom de uma conta nunca aparece aplicado na tela da outra);
//   - o rascunho da sessão só devolve o cupom para a MESMA conta que o aplicou;
//   - trocar de conta com o checkout aberto tira o cupom aplicado;
//   - o desconto sempre vale para o subtotal de AGORA (100 -> 150 -> 100).
// Dublês no molde de checkout-view-selos-contraste-aa.test.tsx. As provas que
// dirigem o campo "Tem um código de cupom?" valem antes e depois da seção de
// cartões (o campo continua na tela); as dos cartões ficam no fim.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

let mockUser: { id: string } | null = null;
let mockAuthLoading = false;
let respostaDaValidacao: () => Promise<{
  valid: boolean;
  discount: number;
  message?: string;
}> = async () => ({ valid: true, discount: 15 });
const validateCoupon = vi.fn((_codigo: string, _subtotal: number) =>
  respostaDaValidacao(),
);

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: true,
      whatsappNumber: "34999998888",
    },
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
  useAuth: () => ({
    user: mockUser,
    profile: null,
    loading: mockAuthLoading,
  }),
}));

const produtoCarrinho = {
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
};

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [{ product: produtoCarrinho, quantity: 1 }],
      cartTotal: 100,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: "01310-100",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  // Estável entre renders, como o useCallback([]) real.
  useCoupons: () => ({ validateCoupon }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => false,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

type Props = { subtotal?: number };

async function renderizar(props: Props = {}) {
  const { CheckoutView } = await import("@/views/customer/CheckoutView");
  await act(async () => {
    raiz.render(
      <CheckoutView
        {...props}
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />,
    );
  });
  return CheckoutView;
}

async function esvaziarFila() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function digitarNoCampo(valor: string) {
  const el = hospedeiro.querySelector(
    "#coupon-code-input",
  ) as HTMLInputElement | null;
  if (!el) throw new Error("campo de cupom fora da tela");
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** O botão "Aplicar" do campo (type=submit do formulário do cupom). */
const botaoDoCampo = () =>
  hospedeiro
    .querySelector("#coupon-code-input")
    ?.closest("form")
    ?.querySelector('button[type="submit"]') as HTMLButtonElement | null;

/** Digita o código no campo e toca em "Aplicar" (uma vez). */
async function aplicarPeloCampo(codigo: string) {
  await act(async () => {
    digitarNoCampo(codigo);
  });
  await act(async () => {
    botaoDoCampo()!.click();
  });
}

beforeEach(() => {
  validateCoupon.mockClear();
  respostaDaValidacao = async () => ({ valid: true, discount: 15 });
  mockUser = null;
  mockAuthLoading = false;
  sessionStorage.clear();
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
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("CheckoutView — a validação do toque em 'Aplicar' (tarefa 18)", () => {
  it("toque duplo com a validação em voo não valida de novo", async () => {
    respostaDaValidacao = () => new Promise(() => {});
    await renderizar();
    await act(async () => {
      digitarNoCampo("VIP15");
    });
    // Dois toques no MESMO instante (antes de o React redesenhar): a trava
    // tem de ser síncrona, não depender do estado já redesenhado.
    await act(async () => {
      botaoDoCampo()!.click();
      botaoDoCampo()!.click();
    });
    expect(validateCoupon).toHaveBeenCalledTimes(1);
    expect(validateCoupon).toHaveBeenCalledWith("VIP15", 100);
  });

  it("validação em voo da conta A não aplica o cupom na tela da conta B", async () => {
    // A resposta que chega depois da troca é descartada: o cupom de uma conta
    // nunca aparece aplicado na tela da outra, nem no rascunho da sessão.
    let soltar: (v: { valid: boolean; discount: number }) => void = () => {};
    respostaDaValidacao = () =>
      new Promise((r) => {
        soltar = r;
      });
    mockUser = { id: "conta-ana" };
    const CheckoutView = await renderizar();
    await aplicarPeloCampo("VIP15");
    mockUser = { id: "conta-bia" };
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      soltar({ valid: true, discount: 15 });
    });
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");
    expect(
      sessionStorage.getItem("ikcous-rascunho-do-checkout-v1") ?? "",
    ).not.toContain("VIP15");
  });

  it("a conta nova não fica presa atrás da validação da conta antiga que nunca responde", async () => {
    respostaDaValidacao = () => new Promise(() => {});
    mockUser = { id: "conta-ana" };
    const CheckoutView = await renderizar();
    await aplicarPeloCampo("VIP15");
    expect(validateCoupon).toHaveBeenCalledTimes(1);

    mockUser = { id: "conta-bia" };
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await aplicarPeloCampo("BIA10");
    expect(validateCoupon).toHaveBeenCalledTimes(2);
    expect(validateCoupon).toHaveBeenLastCalledWith("BIA10", 100);
  });

  it("recusa do servidor mostra o motivo e libera um novo toque", async () => {
    respostaDaValidacao = async () => ({
      valid: false,
      discount: 0,
      message: "Cupom inválido ou expirado.",
    });
    await renderizar();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("Cupom inválido ou expirado.");
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");

    await aplicarPeloCampo("OUTRO");
    expect(validateCoupon).toHaveBeenCalledTimes(2);
  });

  it("validação que lança erro avisa e libera um novo toque", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    respostaDaValidacao = async () => {
      throw new Error("boom");
    };
    await renderizar();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("Erro ao validar cupom");

    respostaDaValidacao = async () => ({ valid: true, discount: 15 });
    validateCoupon.mockClear();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(validateCoupon).toHaveBeenCalledWith("VIP15", 100);
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    erro.mockRestore();
  });
});

// @vitest-environment jsdom
//
// Frente B (28/09/2026): a seção "Cupons" DENTRO do CheckoutView.
//   - um toque em "Aplicar" valida UMA vez (antes: o toque validava e o
//     efeito de revalidação repetia a mesma consulta — defeito 6);
//   - toque duplo com a validação em voo não valida de novo;
//   - o rascunho da sessão só devolve o cupom para a MESMA conta que o
//     aplicou (o código de um exclusivo não aparece na tela de outra conta);
//   - trocar de conta com o checkout aberto tira o cupom aplicado.
// Dublês no molde de checkout-view-selos-contraste-aa.test.tsx.
import type { CupomDisponivel } from "@/lib/cupons-do-checkout";
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
let descontoPorSubtotal: ((subtotal: number) => number) | null = null;
const validateCoupon = vi.fn((_codigo: string, subtotal: number) =>
  descontoPorSubtotal
    ? Promise.resolve({ valid: true, discount: descontoPorSubtotal(subtotal) })
    : respostaDaValidacao(),
);

const CUPONS: CupomDisponivel[] = [
  {
    codigo: "VIP15",
    tipo: "fixed",
    valor: 15,
    minimo: 0,
    validoAte: null,
    exclusivo: true,
    aplica: true,
    falta: 0,
    desconto: 15,
  },
];
const tentarDeNovo = vi.fn();

vi.mock("@/hooks/useCuponsDoCheckout", () => ({
  useCuponsDoCheckout: () => ({
    cupons: CUPONS,
    situacao: "pronto",
    tentarDeNovo,
  }),
}));

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

const CHAVE_DO_RASCUNHO = "ikcous-rascunho-do-checkout-v1";

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function renderizar() {
  const { CheckoutView } = await import("@/views/customer/CheckoutView");
  await act(async () => {
    raiz.render(
      <CheckoutView
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />,
    );
  });
  return CheckoutView;
}

const botaoAplicarVip = () =>
  hospedeiro.querySelector(
    'button[aria-label="Aplicar o cupom VIP15"]',
  ) as HTMLButtonElement | null;

async function esvaziarFila() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  validateCoupon.mockClear();
  respostaDaValidacao = async () => ({ valid: true, discount: 15 });
  descontoPorSubtotal = null;
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

describe("CheckoutView — seção de cupons disponíveis", () => {
  it("um toque em 'Aplicar' no cartão valida UMA vez e mostra a economia", async () => {
    await renderizar();
    expect(botaoAplicarVip()).not.toBeNull();
    await act(async () => {
      botaoAplicarVip()!.click();
    });
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a015,00");
    expect(validateCoupon).toHaveBeenCalledTimes(1);
    expect(validateCoupon).toHaveBeenCalledWith("VIP15", 100);
  });

  it("toque duplo com a validação em voo não valida de novo", async () => {
    let soltar: (v: { valid: boolean; discount: number }) => void = () => {};
    respostaDaValidacao = () =>
      new Promise((r) => {
        soltar = r;
      });
    await renderizar();
    await act(async () => {
      botaoAplicarVip()!.click();
    });
    expect(botaoAplicarVip()!.textContent).toBe("Aplicando…");
    await act(async () => {
      botaoAplicarVip()!.click();
    });
    expect(validateCoupon).toHaveBeenCalledTimes(1);
    await act(async () => {
      soltar({ valid: true, discount: 15 });
    });
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    expect(validateCoupon).toHaveBeenCalledTimes(1);
  });

  it("rascunho com o cupom de OUTRA conta: o código não aparece", async () => {
    mockUser = { id: "conta-bia" };
    sessionStorage.setItem(
      CHAVE_DO_RASCUNHO,
      JSON.stringify({ notas: "x", cupom: "VIP15", contaDoCupom: "conta-ana" }),
    );
    await renderizar();
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");
    expect(validateCoupon).not.toHaveBeenCalled();
  });

  it("rascunho com o cupom da MESMA conta volta — mesmo com a autenticação chegando depois", async () => {
    mockUser = null;
    mockAuthLoading = true;
    sessionStorage.setItem(
      CHAVE_DO_RASCUNHO,
      JSON.stringify({ notas: "x", cupom: "VIP15", contaDoCupom: "conta-ana" }),
    );
    const CheckoutView = await renderizar();
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");

    mockUser = { id: "conta-ana" };
    mockAuthLoading = false;
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    expect(validateCoupon).toHaveBeenCalledWith("VIP15", 100);
  });

  it("subtotal que vai e volta (100 → 150 → 100) revalida e volta ao desconto de 100", async () => {
    // Revisão de risco, M1: o atalho da revalidação guardava só o par do
    // toque — na volta para 100 a tela ficava com o desconto de 150.
    descontoPorSubtotal = (subtotal) => subtotal / 10;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const comSubtotal = async (subtotal: number) => {
      await act(async () => {
        raiz.render(
          <CheckoutView
            subtotal={subtotal}
            onNavigate={onNavigate}
            onSetBackOverride={onSetBackOverride}
          />,
        );
      });
      await esvaziarFila();
    };
    await comSubtotal(100);
    await act(async () => {
      botaoAplicarVip()!.click();
    });
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a010,00");
    await comSubtotal(150);
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a015,00");
    await comSubtotal(100);
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a010,00");
  });

  it("convidado aplica, entra na conta e volta: o cupom fica e é revalidado para a conta", async () => {
    // Revisão, I1: o funil da P6 manda o convidado entrar na conta no meio
    // do checkout — cupom de convidado nunca é exclusivo, então volta.
    mockUser = null;
    await renderizar();
    await act(async () => {
      botaoAplicarVip()!.click();
    });
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    mockUser = { id: "conta-ana" };
    await renderizar();
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    // Uma validação do toque + uma revalidação para a conta nova.
    expect(validateCoupon).toHaveBeenCalledTimes(2);
  });

  it("validação em voo da conta A não aplica o cupom na tela da conta B", async () => {
    // Revisão, I2: a resposta que chega depois da troca é descartada.
    let soltar: (v: { valid: boolean; discount: number }) => void = () => {};
    respostaDaValidacao = () =>
      new Promise((r) => {
        soltar = r;
      });
    mockUser = { id: "conta-ana" };
    const CheckoutView = await renderizar();
    await act(async () => {
      botaoAplicarVip()!.click();
    });
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
    expect(sessionStorage.getItem(CHAVE_DO_RASCUNHO) ?? "").not.toContain(
      "VIP15",
    );
  });

  for (const destino of [null, "conta-bia"]) {
    it(`Ana aplica o exclusivo, a aba passa para ${destino ?? "sem conta"} e a Bia abre o checkout: o código nunca aparece para a Bia`, async () => {
      // Revisão de risco, 2ª rodada (R2-1): no commit da troca, o rascunho
      // era regravado com o cupom da Ana carimbado com a conta NOVA (ou
      // convidado) — a Bia via "VIP15 aplicado" na próxima montagem.
      respostaDaValidacao = async () =>
        mockUser?.id === "conta-ana"
          ? { valid: true, discount: 15 }
          : {
              valid: false,
              discount: 0,
              message: "Cupom inválido ou expirado.",
            };
      mockUser = { id: "conta-ana" };
      const CheckoutView = await renderizar();
      await act(async () => {
        botaoAplicarVip()!.click();
      });
      await esvaziarFila();
      expect(hospedeiro.textContent).toContain("VIP15 aplicado");

      mockUser = destino ? { id: destino } : null;
      await act(async () => {
        raiz.render(
          <CheckoutView
            onNavigate={onNavigate}
            onSetBackOverride={onSetBackOverride}
          />,
        );
      });
      await esvaziarFila();

      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      validateCoupon.mockClear();
      let viuAplicado = false;
      const olho = new MutationObserver(() => {
        if (hospedeiro.textContent?.includes("VIP15 aplicado")) {
          viuAplicado = true;
        }
      });
      olho.observe(hospedeiro, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      mockUser = { id: "conta-bia" };
      await renderizar();
      await esvaziarFila();
      olho.disconnect();
      expect(viuAplicado).toBe(false);
      expect(validateCoupon).not.toHaveBeenCalled();
    });
  }

  it("trocar de conta com o checkout aberto tira o cupom aplicado", async () => {
    mockUser = { id: "conta-ana" };
    const CheckoutView = await renderizar();
    await act(async () => {
      botaoAplicarVip()!.click();
    });
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");

    mockUser = { id: "conta-bia" };
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");
  });
});

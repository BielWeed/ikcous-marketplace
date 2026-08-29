// @vitest-environment jsdom
//
// Defeito: dois selos das telas terminais do checkout usavam
// `text-emerald-600`, que mede 3,58-3,77:1 contra o mínimo AA (4,5:1) de
// texto normal. `text-emerald-700` mede 5,21:1 e passa.
//
//   - "Vantagem Ativa: R$ X OFF" (SuccessView, pedido concluído com cupom
//     aplicado, pagamento na entrega);
//   - "R$ X recebido" (PagamentoConfirmadoView, pagamento online confirmado).
//
// Modelo estrutural copiado de checkout-view-flag-off.test.tsx (chegar ao
// sucesso, convidado) e checkout-view-pix-confirmacao.test.tsx (chegar à
// confirmação, via `onRealtimeEvent` capturado do `useOrders` mocado) --
// mesmos dublês, adaptados para as DUAS telas nascerem no mesmo arquivo (um
// `mockUser` mutável escolhe convidado x autenticado por teste).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const updateOrderStatus = vi.fn();
const clearCart = vi.fn();
const addToCart = vi.fn();
const confettiMock = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

type EventoRealtime = (payload: {
  eventType: string;
  new?: Record<string, unknown>;
}) => void;

// Mutável: convidado (cupom + sucesso) x autenticado (pagamento online).
let mockUser: { id: string } | null = null;
let couponResultado: { valid: boolean; discount: number; message?: string } = {
  valid: true,
  discount: 15,
};
let onRealtimeEventCapturado: EventoRealtime | null = null;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: true,
      whatsappNumber: "34999998888",
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: mockUser
      ? [
          {
            id: "addr-1",
            user_id: "user-1",
            name: "Casa",
            recipient_name: "Cliente Teste",
            cep: "38500-000",
            street: "Rua Teste",
            number: "100",
            neighborhood: "Centro",
            city: "Monte Carmelo",
            state: "MG",
            is_default: true,
          },
        ]
      : [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
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

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [{ product: produtoCarrinho, quantity: 1 }],
    cartTotal: 100,
    shippingFee: 0,
    clearCart,
    addToCart,
    selectedShippingOption: null,
    shippingCep: "38500-000",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    validateCoupon: vi.fn(async () => couponResultado),
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: (
    _enabled?: boolean,
    _isAdmin?: boolean,
    options?: { onRealtimeEvent?: EventoRealtime },
  ) => {
    onRealtimeEventCapturado = options?.onRealtimeEvent ?? null;
    return { createOrder, updateOrderStatus };
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// A verificação periódica (polling) não é exercitada por nenhum teste deste
// arquivo -- a confirmação chega pelo `onRealtimeEvent` capturado acima, e
// nenhum teste espera os 10s do intervalo. Um objeto vazio é suficiente
// (mesmo raciocínio de checkout-view-flag-off.test.tsx).
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("canvas-confetti", () => ({ default: confettiMock }));

vi.mock("@/lib/flags", () => ({
  PAGAMENTO_ONLINE_LIGADO: true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
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

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — selos de pagamento usam text-emerald-700 (contraste AA), não mais text-emerald-600", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    updateOrderStatus.mockClear();
    clearCart.mockClear();
    addToCart.mockClear();
    confettiMock.mockClear();
    onNavigate.mockClear();
    onRealtimeEventCapturado = null;
    mockUser = null;
    couponResultado = { valid: true, discount: 15 };
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cupom aplicado + pedido concluído (pagamento na entrega): o selo 'Vantagem Ativa' troca de tom", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    // Aplica o cupom ANTES de finalizar -- é o que faz `appliedCoupon` (e
    // portanto `discount`) existir quando a tela de sucesso renderizar.
    await act(async () => {
      digitar("coupon-code-input", "PROMO10");
      const botaoAplicar = localizarBotaoPorTexto(hospedeiro, "Aplicar")!;
      botaoAplicar.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hospedeiro.textContent).toContain("PROMO10");

    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("guest-street", "Rua Teste");
      digitar("guest-number", "100");
      digitar("guest-neighborhood", "Centro");
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      digitar("guest-cep", "01310-100");
      await Promise.resolve();
    });
    await act(async () => {
      digitar("guest-city", "Cidade Teste");
      await Promise.resolve();
    });
    await act(async () => {
      digitar("guest-state", "SP");
      await Promise.resolve();
    });

    // O botão "Finalizar Pedido" só existe depois que useDeferredRender(380)
    // resolve -- espera o tempo real, como o componente exige.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;
    await act(async () => {
      botaoFinalizar.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // A armadilha precisa estar de fato presente: sem chegar de verdade na
    // tela de sucesso com o cupom aplicado, o par abaixo não prova nada.
    expect(hospedeiro.textContent).toContain("Pedido Celebrado!");
    expect(hospedeiro.textContent).toContain("Vantagem Ativa");

    const selo = Array.from(hospedeiro.querySelectorAll("div")).find((d) =>
      d.textContent?.startsWith("Vantagem Ativa"),
    );
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("text-emerald-600")).toBe(false);
  });

  it("pagamento online confirmado: o valor recebido troca de tom", async () => {
    mockUser = { id: "user-1" };
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const botaoOnline = localizarBotaoPorTexto(
      hospedeiro,
      "Pagar agora com PIX",
    )!;
    await act(async () => {
      botaoOnline.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;
    await act(async () => {
      botaoFinalizar.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).toContain("Finalize o pagamento");

    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "ped-999", payment_status: "pago" },
      });
    });

    // A armadilha precisa estar de fato presente: sem chegar de verdade na
    // tela de pagamento confirmado, o par abaixo não prova nada.
    expect(hospedeiro.textContent).toContain("Pagamento Confirmado!");

    const paragrafos = Array.from(hospedeiro.querySelectorAll("p"));
    const valorRecebido = paragrafos.find((p) =>
      p.textContent?.includes("recebido"),
    );
    expect(valorRecebido).not.toBeUndefined();
    expect(valorRecebido?.classList.contains("text-emerald-700")).toBe(true);
    expect(valorRecebido?.classList.contains("text-emerald-600")).toBe(false);
  });
});

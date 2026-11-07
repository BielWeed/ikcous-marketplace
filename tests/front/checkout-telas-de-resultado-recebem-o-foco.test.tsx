// @vitest-environment jsdom
//
// Acessibilidade do checkout (lote r64-a): três telas SUBSTITUEM a tela
// inteira e o botão que tinha o foco (Finalizar, "Copiar código Pix") some
// junto — o foco caía no corpo da página e o leitor de tela ficava em
// silêncio: quem não enxerga o check verde não sabia se o pedido foi feito
// nem se o PIX foi pago.
//   - "Pedido recebido!"        (pedido feito, pagamento na entrega)
//   - "Pagamento Confirmado!"   (PIX pago, confirmado em segundo plano)
//   - "Finalize o pagamento"    (pedido feito, falta pagar online)
// O título de cada uma passa a receber o foco quando a tela aparece: o leitor
// de tela fala o título e o teclado recomeça dali. Modelo estrutural copiado
// de checkout-view-pix-confirmacao.test.tsx (mesmos dublês), com relógio real.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi
  .fn()
  .mockResolvedValue({ id: "ped-999", totalAmount: 100 });
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const clearCart = vi.fn();
const addToCart = vi.fn();
const confettiMock = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;
type EventoRealtime = (payload: {
  eventType: string;
  new?: Record<string, unknown>;
}) => void;

const mockUser: { id: string } = { id: "user-1" };
let onRealtimeEventCapturado: EventoRealtime | null = null;

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: "34999998888",
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [
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
    ],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

let mockCart = [
  {
    product: {
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
    },
    quantity: 1,
  },
];
let mockCartTotal = 100;

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCartTotal,
      shippingFee: 0,
      clearCart: () => {
        clearCart();
        mockCart = [];
        mockCartTotal = 0;
      },
      addToCart: (
        product: unknown,
        quantity: number,
        variantId?: string,
        variantNames?: string,
      ) => addToCart(product, quantity, variantId, variantNames),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: "38500-000",
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: { payment_status: "aguardando", expires_at: null },
              error: null,
            }),
        }),
      }),
    }),
  },
}));

vi.mock("canvas-confetti", () => ({ default: confettiMock }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/checkout/PagamentoOnline")
    >();
  return { ...real, PagamentoOnline: () => null };
});

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
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

function titulo(texto: string): HTMLElement {
  const achado = [...document.querySelectorAll("h1,h2")].find(
    (h) => h.textContent?.trim() === texto,
  );
  expect(achado, `título "${texto}" na tela`).toBeDefined();
  return achado as HTMLElement;
}

describe("CheckoutView — as telas que trocam a tela inteira levam o foco ao título", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    clearCart.mockClear();
    confettiMock.mockClear();
    onNavigate.mockClear();
    onRealtimeEventCapturado = null;
    mockCart = [
      {
        product: {
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
        },
        quantity: 1,
      },
    ];
    mockCartTotal = 100;
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

  const renderizar = (Componente: TelaCheckout) =>
    act(async () => {
      raiz.render(
        <Componente
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

  /** Preenche o formulário e aperta Finalizar com o foco NO botão — o
   * mesmo que quem usa só o teclado tem na mão. */
  async function finalizar(Componente: TelaCheckout, comPix: boolean) {
    await renderizar(Componente);
    await act(async () => {
      if (comPix) {
        localizarBotaoPorTexto(hospedeiro, "Pagar agora com PIX")!.click();
      }
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
    botaoFinalizar.focus();
    expect(document.activeElement).toBe(botaoFinalizar);
    await act(async () => {
      botaoFinalizar.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    return botaoFinalizar;
  }

  it("pedido feito (pagamento na entrega): o foco sai do Finalizar, que sumiu, e vai para 'Pedido recebido!'", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const botaoFinalizar = await finalizar(CheckoutView, false);

    const h = titulo("Pedido recebido!");
    expect(document.body.contains(botaoFinalizar)).toBe(false);
    expect(document.activeElement).toBe(h);
    // Alvo de foco só por código: fora da ordem de Tab, e nunca um "botão".
    expect(h.getAttribute("tabindex")).toBe("-1");
  });

  it("PIX pago em segundo plano: o foco vai para 'Pagamento Confirmado!' mesmo que estivesse em outro lugar da tela do QR", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await finalizar(CheckoutView, true);
    expect(hospedeiro.textContent).toContain("Finalize o pagamento");

    // Onde estivesse o "Copiar código Pix" (que some junto com o QR): um
    // botão qualquer da tela do PIX com o foco.
    const naTelaDoQr = document.createElement("button");
    hospedeiro.firstElementChild!.appendChild(naTelaDoQr);
    naTelaDoQr.focus();
    expect(document.activeElement).toBe(naTelaDoQr);

    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "ped-999", payment_status: "pago" },
      });
    });

    const h = titulo("Pagamento Confirmado!");
    expect(document.activeElement).toBe(h);
    expect(h.getAttribute("tabindex")).toBe("-1");
  });

  it("pedido feito para pagar online: o foco vai para 'Finalize o pagamento'", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await finalizar(CheckoutView, true);

    const h = titulo("Finalize o pagamento");
    expect(h.tagName).toBe("H1");
    expect(document.activeElement).toBe(h);
    expect(h.getAttribute("tabindex")).toBe("-1");
  });

  it("limite: o foco vai UMA vez só — quem já está em outro botão da tela do PIX não é puxado de volta a cada atualização da tela", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await finalizar(CheckoutView, true);
    expect(document.activeElement).toBe(titulo("Finalize o pagamento"));

    // "Copiar código Pix": a pessoa foi até ele.
    const copiar = document.createElement("button");
    hospedeiro.firstElementChild!.appendChild(copiar);
    copiar.focus();

    // A tela é redesenhada várias vezes (verificação periódica, relógio da
    // reserva...) — nenhuma pode roubar o foco do botão onde a pessoa está.
    await renderizar(CheckoutView);
    await renderizar(CheckoutView);
    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "ped-999", payment_status: "aguardando" },
      });
    });

    expect(document.activeElement).toBe(copiar);
  });
});

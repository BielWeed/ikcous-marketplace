// @vitest-environment jsdom
// Montagem baseada em checkout-resposta-e-pagamento-regressoes.test.tsx.
// Sem a trava síncrona do handleSubmitEvent, os dois cliques atravessam
// form.trigger() antes do próximo render e chegam duas vezes a createOrder.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
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

const USUARIO = { id: "user-1", email: "cliente@exemplo.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIO, profile: null, loading: false }),
}));
const CARRINHO = [
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
      createdAt: "2026-11-10T00:00:00.000Z",
    },
    quantity: 1,
  },
];
const ENTREGA_LOCAL = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 20,
  deliveryDays: 1,
  provider: "local",
};
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: CARRINHO,
      cartTotal: 100,
      shippingFee: 20,
      clearCart: vi.fn(),
      removeFromCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: ENTREGA_LOCAL,
      shippingCep: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => false,
  lerFlagPagamentoOnline: (valor: string | undefined) => valor === "true",
}));
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(null) };
});
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CheckoutView — dois cliques no Finalizar antes do próximo render", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockReset();
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
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
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("envia um único pedido mesmo com dois cliques no mesmo instante", async () => {
    // Toda chamada fica pendente até a contagem, inclusive a segunda que
    // apareceria sem a trava. Nenhuma resposta limpa o carrinho no meio.
    let responder!: (pedido: { id: string; totalAmount: number }) => void;
    const pedidoPendente = new Promise<{ id: string; totalAmount: number }>(
      (resolve) => {
        responder = resolve;
      },
    );
    createOrder.mockReturnValue(pedidoPendente);

    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botao = [...document.body.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Finalizar Pedido"),
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);
    expect(createOrder).not.toHaveBeenCalled();

    try {
      await act(async () => {
        // Sem await entre os cliques: disabled ainda não recebeu o estado
        // do próximo render. Ambos usam o botão e o handler reais.
        botao.click();
        botao.click();
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      });
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(createOrder.mock.calls[0][0]).toMatchObject({
        totalAmount: 120,
      });
    } finally {
      await act(async () => {
        responder({ id: "ped-777", totalAmount: 120 });
        await esperarMicrotarefas();
      });
    }
  });
});

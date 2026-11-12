// @vitest-environment jsdom
//
// Montagem de checkout-view-cancelar-pagamento-falho.test.tsx: o pedido
// já nasceu e o pagamento falhou. Só a releitura após cancelar fica sem resposta.
import { PRAZO_DA_CONSULTA_DO_CHECKOUT_MS } from "@/lib/prazo-da-requisicao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUser = { id: "user-1" };
const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const clearCart = vi.fn();
const addToCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const confettiMock = vi.fn();
const relerStatus = vi.fn();
const filtrarPedido = vi.fn(() => ({ single: relerStatus }));
const selecionarStatus = vi.fn(() => ({ eq: filtrarPedido }));
const consultarTabela = vi.fn(() => ({ select: selecionarStatus }));
const pagamentoOnlineOnErro: Array<
  (msg: string, categoria: "recuperavel" | "terminal") => void
> = [];

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
  useAuth: () => ({
    user: mockUser,
    profile: null,
    loading: false,
  }),
}));

const itemDoPedido = {
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
  quantity: 2,
  variantId: "var-azul",
  variantNames: "Cor: Azul",
};
let mockCart = [itemDoPedido];
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCart.length ? 100 : 0,
      shippingFee: mockCart.length ? 20 : 0,
      clearCart: () => {
        clearCart();
        mockCart = [];
      },
      addToCart,
      selectedShippingOption: mockCart.length
        ? {
            id: "opt-mock",
            name: "Entrega Padrão",
            price: 20,
            deliveryDays: 3,
            provider: "flat_fee",
          }
        : null,
      shippingCep: "38500-000",
    })),
  };
});
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return { ...real, useOrders: () => ({ createOrder, updateOrderStatus }) };
});
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: consultarTabela },
}));
vi.mock("canvas-confetti", () => ({ default: confettiMock }));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: {
    onErro: (msg: string, categoria: "recuperavel" | "terminal") => void;
  }) => {
    pagamentoOnlineOnErro.push(props.onErro);
    return null;
  },
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

function localizarBotaoPorTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — releitura do cancelamento sem resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateOrderStatus.mockResolvedValue(undefined);
    relerStatus.mockReset();
    relerStatus.mockResolvedValue({
      data: { status: "cancelled" },
      error: null,
    });
    mockCart = [itemDoPedido];
    pagamentoOnlineOnErro.length = 0;
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function chegarAoCancelamento() {
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
      localizarBotaoPorTexto(hospedeiro, "Pagar agora com PIX")!.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("checkout-cpf", "11144477735");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    await act(async () => {
      localizarBotaoPorTexto(document.body, "Finalizar Pedido")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(clearCart).toHaveBeenCalledTimes(1);
    expect(mockCart).toHaveLength(0);
    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Não foi possível gerar a cobrança.",
        "terminal",
      );
    });
    return localizarBotaoPorTexto(
      hospedeiro,
      "Cancelar pedido e voltar ao carrinho",
    )!;
  }

  it("releitura pendurada: ao esgotar o prazo avisa, libera o botão e não devolve itens nem navega", async () => {
    const botao = await chegarAoCancelamento();
    relerStatus.mockReturnValueOnce(new Promise(() => {}));
    // Só a etapa sob teste usa relógio falso; a montagem segue o teste vizinho.
    vi.useFakeTimers();
    await act(async () => botao.click());

    expect(updateOrderStatus).toHaveBeenCalledExactlyOnceWith(
      "ped-999",
      "cancelled",
      undefined,
      true,
    );
    expect(consultarTabela).toHaveBeenCalledWith("marketplace_orders");
    expect(selecionarStatus).toHaveBeenCalledWith("status");
    expect(filtrarPedido).toHaveBeenCalledWith("id", "ped-999");
    expect(relerStatus).toHaveBeenCalledTimes(1);
    expect(botao.disabled).toBe(true);
    expect(botao.querySelector(".animate-spin")).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_CHECKOUT_MS - 1);
    });
    expect(botao.disabled).toBe(true);
    expect(hospedeiro.textContent).not.toContain(
      "Não foi possível confirmar o cancelamento",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(hospedeiro.textContent).toContain(
      "Não foi possível confirmar o cancelamento. Tente novamente.",
    );
    expect(botao.disabled).toBe(false);
    expect(botao.querySelector(".animate-spin")).toBeNull();
    expect(addToCart).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("controle: releitura que confirma cancelled continua devolvendo os itens e levando ao carrinho", async () => {
    const botao = await chegarAoCancelamento();
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(updateOrderStatus).toHaveBeenCalledExactlyOnceWith(
      "ped-999",
      "cancelled",
      undefined,
      true,
    );
    expect(relerStatus).toHaveBeenCalledTimes(1);
    expect(addToCart).toHaveBeenCalledExactlyOnceWith(
      itemDoPedido.product,
      2,
      "var-azul",
      "Cor: Azul",
    );
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("cart");
  });
});

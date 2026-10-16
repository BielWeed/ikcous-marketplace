// @vitest-environment jsdom
// Regressões A3/A4/A5/A8; montagem de checkout-view-cartao-online.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigDoCartao } from "@/lib/config-do-cartao";
import type { CartItem } from "@/types";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-777" });
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const limparCarrinho = vi.fn();
const removerDoCarrinho = vi.fn();
const restaurarNoCarrinho = vi.fn();
const atualizarStatus = vi.fn();
const validarCupom = vi.fn();
const propsDoPagamento: Array<Record<string, unknown>> = [];

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: true,
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

let mockUser: { id: string; email?: string } | null = {
  id: "user-1",
  email: "cliente@exemplo.com",
};
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

const item = () => ({
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
});

let mockCart: CartItem[] = [item()];
let mockCartTotal = 100;
let mockShippingFee = 20;
let mockSelectedShippingOption: {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
} | null = null;

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
      cart: mockCart,
      cartTotal: mockCartTotal,
      shippingFee: mockShippingFee,
      clearCart: limparCarrinho,
      removeFromCart: removerDoCarrinho,
      addToCart: restaurarNoCarrinho,
      selectedShippingOption: mockSelectedShippingOption,
      shippingCep: null,
      setSelectedShippingOption: (opt: typeof mockSelectedShippingOption) => {
        mockSelectedShippingOption = opt;
      },
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: validarCupom }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: atualizarStatus }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { status: "cancelled" }, error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// `null` = cartão não oferecido (o hook já resolve a falha fechada).
let mockConfigDoCartao: ConfigDoCartao | null = null;
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(mockConfigDoCartao) };
});

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: Record<string, unknown>) => {
    propsDoPagamento.push(props);
    return null;
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function botaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
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

type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar(Tela: TelaCheckout) {
  await act(async () => {
    raiz.render(
      <Tela onNavigate={onNavigate} onSetBackOverride={onSetBackOverride} />,
    );
  });
  await act(async () => {
    await esperarMicrotarefas();
  });
}

async function clicar(botao: HTMLElement) {
  await act(async () => {
    botao.click();
    await esperarMicrotarefas();
  });
}

async function finalizar() {
  await act(async () => {
    digitar("checkout-name", "Cliente Teste");
    digitar("checkout-tel", "34999999999");
    await esperarMicrotarefas();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
  const botao = botaoPorTexto(document.body, "Finalizar Pedido")!;
  expect(botao.disabled).toBe(false);
  await act(async () => {
    botao.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

function respostaPendente() {
  let resolver!: (pedido: { id: string }) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<{ id: string }>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  createOrder.mockReturnValueOnce(promessa);
  return { resolver, rejeitar };
}

describe("CheckoutView — resposta atrasada, centavos e reserva por método", () => {
  beforeEach(() => {
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "ped-777" });
    limparCarrinho.mockReset();
    limparCarrinho.mockImplementation(() => {
      mockCart = [];
      mockCartTotal = 0;
    });
    removerDoCarrinho.mockReset();
    removerDoCarrinho.mockImplementation((id: string, variante?: string) => {
      mockCart = mockCart.filter(
        (linha) => linha.product.id !== id || linha.variantId !== variante,
      );
    });
    restaurarNoCarrinho.mockReset();
    atualizarStatus.mockReset();
    atualizarStatus.mockResolvedValue(undefined);
    validarCupom.mockReset();
    validarCupom.mockResolvedValue({ valid: true, discount: 0.505 });
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    propsDoPagamento.length = 0;
    mockUser = { id: "user-1", email: "cliente@exemplo.com" };
    mockCart = [item()];
    mockCartTotal = 100;
    mockShippingFee = 20;
    mockSelectedShippingOption = { ...ENTREGA_LOCAL };
    mockConfigDoCartao = { credito: true, debito: true, parcelasMax: 6 };
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

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    globalThis.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resposta dentro do prazo preserva o carrinho novo montado durante o envio", async () => {
    const resposta = respostaPendente();
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await finalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    mockCart = [{ ...item(), product: { ...item().product, id: "prod-novo" } }];
    await montar(CheckoutView);
    await act(async () => resposta.resolver({ id: "ped-777" }));
    expect(mockCart.map((linha) => linha.product.id)).toEqual(["prod-novo"]);
    expect(limparCarrinho).not.toHaveBeenCalled();
    expect(removerDoCarrinho).not.toHaveBeenCalled();
  });

  it("se só adicionou outra linha, remove a comprada e preserva a nova", async () => {
    const resposta = respostaPendente();
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await finalizar();
    mockCart = [
      item(),
      { ...item(), product: { ...item().product, id: "novo" } },
    ];
    await montar(CheckoutView);
    await act(async () => resposta.resolver({ id: "ped-777" }));
    expect(mockCart.map((linha) => linha.product.id)).toEqual(["novo"]);
    expect(limparCarrinho).not.toHaveBeenCalled();
    expect(removerDoCarrinho).toHaveBeenCalledWith("prod-1", undefined);
  });

  it.each(["quantidade", "variacao"])(
    "preserva a linha que mudou de %s durante o envio",
    async (mudanca) => {
      const resposta = respostaPendente();
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await montar(CheckoutView);
      await finalizar();
      if (mudanca === "quantidade") mockCart[0].quantity = 2;
      else mockCart[0].variantId = "outra";
      await montar(CheckoutView);
      await act(async () => resposta.resolver({ id: "ped-777" }));
      expect(mockCart).toHaveLength(1);
      expect(limparCarrinho).not.toHaveBeenCalled();
      expect(removerDoCarrinho).not.toHaveBeenCalled();
    },
  );

  it("sem mudança de composição, limpa o carrinho depois de criar o pedido", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await finalizar();
    expect(mockCart).toEqual([]);
    expect(limparCarrinho).toHaveBeenCalledTimes(1);
  });

  it("cancelar depois preserva a quantidade que nunca saiu do carrinho", async () => {
    const resposta = respostaPendente();
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(botaoPorTexto(hospedeiro, "Pagar agora com PIX")!);
    await finalizar();
    mockCart = [{ ...item(), quantity: 2 }];
    await montar(CheckoutView);
    await act(async () => resposta.resolver({ id: "ped-777" }));
    await act(async () => {
      const onErro = propsDoPagamento.at(-1)!.onErro as (
        mensagem: string,
        categoria: string,
      ) => void;
      onErro("Pagamento indisponível", "terminal");
    });
    await clicar(botaoPorTexto(hospedeiro, "Cancelar pedido")!);
    expect(atualizarStatus).toHaveBeenCalledWith(
      "ped-777",
      "cancelled",
      undefined,
      true,
    );
    expect(restaurarNoCarrinho).not.toHaveBeenCalled();
    expect(mockCart[0].quantity).toBe(2);
    expect(onNavigate).toHaveBeenCalledWith("cart");
  });

  it("sucesso depois de sair da tela não limpa o carrinho nem inicia o pagamento", async () => {
    const resposta = respostaPendente();
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(botaoPorTexto(hospedeiro, "Pagar agora com PIX")!);
    await finalizar();
    await act(async () => raiz.render(null));
    mockCart = [{ ...item(), quantity: 3 }];
    await act(async () => resposta.resolver({ id: "ped-777" }));
    expect(mockCart[0].quantity).toBe(3);
    expect(limparCarrinho).not.toHaveBeenCalled();
    expect(removerDoCarrinho).not.toHaveBeenCalled();
    expect(propsDoPagamento).toEqual([]);
  });

  it("erro depois de sair da tela não dispara toast da tela desmontada", async () => {
    const resposta = respostaPendente();
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await finalizar();
    await act(async () => raiz.render(null));
    await act(async () => resposta.rejeitar(new Error("Sem rede")));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("storage que falha ao esquecer não impede o pedido criado de abrir o pagamento", async () => {
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(botaoPorTexto(hospedeiro, "Pagar agora com PIX")!);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("Storage bloqueado");
    });
    await finalizar();
    expect(propsDoPagamento.at(-1)?.orderId).toBe("ped-777");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("cupom de meio centavo envia 9,60 ao pedido e ao pagamento", async () => {
    mockCartTotal = 10.1;
    mockShippingFee = 0;
    mockSelectedShippingOption = { ...ENTREGA_LOCAL, price: 0 };
    mockCart = [{ ...item(), product: { ...item().product, price: 10.1 } }];
    globalThis.sessionStorage.setItem(
      "ikcous-rascunho-do-checkout-v1",
      JSON.stringify({ cupom: "CINCO", contaDoCupom: "user-1" }),
    );
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!);
    expect(validarCupom).toHaveBeenCalledWith("CINCO", 10.1);
    await finalizar();
    expect(createOrder.mock.calls[0][0].totalAmount).toBe(9.6);
    expect(propsDoPagamento.at(-1)?.valor).toBe(9.6);
  });

  it.each(["pix", "cartao"])(
    "aviso de reserva acompanha o método %s",
    async (metodo) => {
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await montar(CheckoutView);
      await clicar(
        botaoPorTexto(
          hospedeiro,
          metodo === "pix"
            ? "Pagar agora com PIX"
            : "Cartão de crédito ou débito",
        )!,
      );
      await finalizar();
      const texto = hospedeiro.textContent?.replace(/\s+/g, " ");
      const avisoPix =
        "Seu pedido está reservado. Se o pagamento não sair em 30 minutos, os itens voltam para o estoque e o pedido é cancelado.";
      const avisoCartao =
        "Reservamos seus itens enquanto o pagamento é concluído. Se o banco não confirmar a tempo, o pedido é cancelado e os itens voltam para a loja.";
      expect(texto).toContain(metodo === "pix" ? avisoPix : avisoCartao);
      expect(texto).not.toContain(metodo === "pix" ? avisoCartao : avisoPix);
      if (metodo === "cartao") {
        await act(async () => {
          (propsDoPagamento.at(-1)!.onTrocarParaPix as () => void)();
        });
        expect(hospedeiro.textContent?.replace(/\s+/g, " ")).toContain(
          avisoPix,
        );
      }
    },
  );
});

// @vitest-environment jsdom
//
// LOTE 210 (caça 8) — textos e caminhos da tela de pagamento do checkout.
// NENHUM cálculo de total/frete/desconto, chave de idempotência, chamada à
// edge, status de pagamento ou estoque muda aqui: o que se prova é o que o
// COMPRADOR lê e por onde ele sai.
//
//   - PIX venceu com a tela aberta: "Voltar ao carrinho" devolve os itens
//     (mesmo mecanismo do "pagamento não concluído") e o topo deixa de dizer
//     "Seu pedido está reservado" / "Finalize o pagamento".
//   - "Seu pedido está reservado" não promete "30 minutos" fixos.
//   - "Pago na entrega": a tela de sucesso mostra o total e a forma, com
//     português simples e texto próprio para retirada.
//   - Valor recebido com ponto de milhar (R$ 1.234,50).
//
// Montagem copiada de checkout-view-pix-confirmacao.test.tsx (mesmos dublês),
// com o PagamentoOnline REAL e um `criarPagamento` que devolve um PIX.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const criarPagamento = vi.fn();
const clearCart = vi.fn();
const addToCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;
type EventoRealtime = (payload: {
  eventType: string;
  new?: Record<string, unknown>;
}) => void;

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

const { usuario } = vi.hoisted(() => ({ usuario: { id: "user-1" } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, profile: null, loading: false }),
}));

const ENTREGA_LOCAL = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 0,
  deliveryDays: 1,
  provider: "local",
};
const RETIRADA = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "pickup",
};

const novoItem = () => ({
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

let mockCart = [novoItem()];
let mockCartTotal = 100;
let mockShippingFee = 0;
let mockOpcaoDeFrete: typeof ENTREGA_LOCAL | typeof RETIRADA | null =
  ENTREGA_LOCAL;

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCartTotal,
      shippingFee: mockShippingFee,
      // Como o carrinho real: limpar a compra também derruba a opção de frete.
      // O resumo do pedido entregue TEM de ter sido guardado antes disto.
      clearCart: () => {
        clearCart();
        mockCart = [];
        mockCartTotal = 0;
        mockShippingFee = 0;
        mockOpcaoDeFrete = null;
      },
      addToCart: (
        product: unknown,
        quantity: number,
        variantId?: string,
        variantNames?: string,
      ) => addToCart(product, quantity, variantId, variantNames),
      selectedShippingOption: mockOpcaoDeFrete,
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
    // O PagamentoOnline REAL também chama useOrders (sem opções): só quem
    // passa o callback do realtime — o CheckoutView — o regrava.
    if (options?.onRealtimeEvent) {
      onRealtimeEventCapturado = options.onRealtimeEvent;
    }
    return { createOrder, updateOrderStatus, criarPagamento };
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

let mockRespostaPoll: {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
} = { data: { payment_status: "aguardando", expires_at: null }, error: null };

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (coluna: string, valor: string) => ({
          single: () =>
            coluna === "id" && valor === "ped-999"
              ? Promise.resolve(mockRespostaPoll)
              : Promise.resolve({
                  data: null,
                  error: { message: "not found" },
                }),
        }),
      }),
    }),
  },
}));

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

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

function botaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — lote 210: textos e caminhos do pagamento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const texto = () => hospedeiro.textContent?.replace(/\s/g, " ") ?? "";

  beforeEach(() => {
    createOrder
      .mockReset()
      .mockResolvedValue({ id: "ped-999", totalAmount: 100 });
    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      qrCode: "000201CODIGOCOPIAECOLA",
      qrCodeBase64: "abc123",
    });
    updateOrderStatus.mockClear();
    clearCart.mockClear();
    addToCart.mockClear();
    onNavigate.mockClear();
    onRealtimeEventCapturado = null;
    mockRespostaPoll = {
      data: { payment_status: "aguardando", expires_at: null },
      error: null,
    };
    mockCart = [novoItem()];
    mockCartTotal = 100;
    mockShippingFee = 0;
    mockOpcaoDeFrete = ENTREGA_LOCAL;
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
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
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Escolhe a forma (texto do botão) e fecha o pedido; devolve com a tela seguinte. */
  async function fecharPedidoCom(
    CheckoutViewComponente: TelaCheckout,
    formaDePagamento: string,
  ) {
    await act(async () => {
      raiz.render(
        <CheckoutViewComponente
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      botaoPorTexto(hospedeiro, formaDePagamento)!.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(420);
    });
    const finalizar = botaoPorTexto(document.body, "Finalizar Pedido")!;
    expect(finalizar.disabled).toBe(false);
    await act(async () => {
      finalizar.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function lerOServidor(resposta: Record<string, unknown>) {
    mockRespostaPoll = {
      data: { gateway_payment_id: "pay-1", expires_at: null, ...resposta },
      error: null,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
  }

  describe("PIX que venceu com a tela aberta", () => {
    it("CONTROLE: com o pedido vivo o topo reserva o pedido, sem '30 minutos' fixos e sem 'Voltar ao carrinho'", async () => {
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Pagar agora com PIX");

      expect(texto()).toContain("Finalize o pagamento");
      expect(texto()).toContain("Seu pedido está reservado");
      // Item 6: o prazo real está no "Prazo informado: até HH:MM" do PIX; o
      // topo não repete um número que pode já estar errado (faltando 5 min).
      expect(texto()).not.toMatch(/\d+\s*minutos/);
      expect(texto()).toContain("Prazo informado");
      expect(botaoPorTexto(hospedeiro, "Voltar ao carrinho")).toBeUndefined();
    });

    it("payment_status 'expirado' num pedido criado nesta tela: tira o 'reservado', mostra 'Voltar ao carrinho' e o botão devolve os itens", async () => {
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Pagar agora com PIX");
      expect(texto()).toContain("Seu pedido está reservado");

      await lerOServidor({ payment_status: "expirado", status: "pending" });

      // Item 4: pedido morto não tem "reservado" nem "Finalize o pagamento".
      expect(texto()).not.toContain("Seu pedido está reservado");
      expect(texto()).not.toContain("Finalize o pagamento");
      expect(texto()).toContain("Este código não vale mais");

      // Item 3: a saída que restaura os itens.
      const voltar = botaoPorTexto(hospedeiro, "Voltar ao carrinho");
      expect(voltar).toBeDefined();
      await act(async () => {
        voltar!.click();
      });
      expect(addToCart).toHaveBeenCalledTimes(1);
      expect(addToCart.mock.calls[0][0].id).toBe("prod-1");
      expect(addToCart.mock.calls[0][1]).toBe(1);
      expect(onNavigate).toHaveBeenCalledWith("cart");
    });

    it("'aguardando' + 'cancelled' (cancelado): mesma saída, mesmo topo limpo", async () => {
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Pagar agora com PIX");

      await lerOServidor({ payment_status: "aguardando", status: "cancelled" });

      expect(texto()).not.toContain("Seu pedido está reservado");
      expect(texto()).not.toContain("Finalize o pagamento");
      expect(botaoPorTexto(hospedeiro, "Voltar ao carrinho")).toBeDefined();
    });

    it("voltar ao carrinho só devolve UMA vez (a lista de itens é consumida)", async () => {
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Pagar agora com PIX");
      await lerOServidor({ payment_status: "expirado", status: "pending" });

      await act(async () => {
        botaoPorTexto(hospedeiro, "Voltar ao carrinho")!.click();
      });
      await act(async () => {
        botaoPorTexto(hospedeiro, "Voltar ao carrinho")?.click();
      });
      expect(addToCart).toHaveBeenCalledTimes(1);
    });
  });

  describe("valor recebido com ponto de milhar", () => {
    it("PIX confirmado: R$ 1.234,50 recebido (não 'R$ 1234,50')", async () => {
      createOrder.mockResolvedValue({ id: "ped-999", totalAmount: 1234.5 });
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Pagar agora com PIX");

      await act(async () => {
        onRealtimeEventCapturado?.({
          eventType: "UPDATE",
          new: { id: "ped-999", payment_status: "pago" },
        });
      });
      expect(texto()).toContain("Pagamento Confirmado");
      expect(texto()).toContain("R$ 1.234,50 recebido");
      expect(texto()).not.toContain("1234,50");
    });

    it("pago fora do prazo: R$ 1.234,50 recebido", async () => {
      createOrder.mockResolvedValue({ id: "ped-999", totalAmount: 1234.5 });
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Pagar agora com PIX");

      await act(async () => {
        onRealtimeEventCapturado?.({
          eventType: "UPDATE",
          new: { id: "ped-999", payment_status: "pago_apos_expirar" },
        });
      });
      expect(texto()).toContain("Pagamento Recebido");
      expect(texto()).toContain("R$ 1.234,50 recebido");
      expect(texto()).not.toContain("1234,50");
    });

    it("valor sem milhar segue igual: R$ 100,00 recebido", async () => {
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Pagar agora com PIX");
      await act(async () => {
        onRealtimeEventCapturado?.({
          eventType: "UPDATE",
          new: { id: "ped-999", payment_status: "pago" },
        });
      });
      expect(texto()).toContain("R$ 100,00 recebido");
    });
  });

  describe("tela de sucesso do pedido pago na entrega/retirada", () => {
    it("entrega: mostra o total e a forma, em português simples, sem o texto de logística", async () => {
      mockCartTotal = 1100;
      mockShippingFee = 134.5;
      createOrder.mockResolvedValue({ id: "ped-999", totalAmount: 1234.5 });
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Dinheiro na Entrega");

      // Só o total que o pedido devolveu (o mesmo que a tela mandou); nada recalculado aqui.
      expect(createOrder.mock.calls[0][0].totalAmount).toBe(1234.5);
      expect(texto()).toContain("Pedido recebido!");
      expect(texto()).toContain("Número do pedido: #ED-999");
      expect(texto()).toContain("Total a pagar na entrega: R$ 1.234,50");
      expect(texto()).toContain("Forma de pagamento: Dinheiro");
      expect(texto()).toContain("A loja vai cuidar da entrega");
      for (const velho of [
        "Pedido Celebrado",
        "Identificador",
        "Vantagem Ativa",
        "logística",
        "retirar",
        "retirada",
      ]) {
        expect(texto()).not.toContain(velho);
      }
    });

    it("cartão na entrega usa o rótulo que o app já tem em forma-de-pagamento", async () => {
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Cartão na Entrega");
      expect(texto()).toContain("Forma de pagamento: Cartão na entrega");
      expect(texto()).toContain("Total a pagar na entrega: R$ 100,00");
    });

    it("retirada: fala de retirada (total, forma e texto), mesmo com o carrinho já limpo", async () => {
      mockOpcaoDeFrete = RETIRADA;
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Cartão na Retirada");

      // O dublê do carrinho zera a opção de frete ao limpar; a tela guardou a
      // modalidade no instante do envio.
      expect(texto()).toContain("Pedido recebido!");
      expect(texto()).toContain("Total a pagar na retirada: R$ 100,00");
      expect(texto()).toContain("Forma de pagamento: Cartão na retirada");
      expect(texto()).toContain("separar os itens para você retirar");
      expect(texto()).not.toContain("entrega");
      expect(texto()).not.toContain("logística");
    });

    it("total gravado zero: 'Sem valor a pagar', sem 'Total a pagar: R$ 0,00'", async () => {
      createOrder.mockResolvedValue({ id: "ped-999", totalAmount: 0 });
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await fecharPedidoCom(CheckoutView, "Dinheiro na Entrega");
      expect(texto()).toContain("Pedido recebido!");
      expect(texto()).toContain("Sem valor a pagar");
      expect(texto()).not.toContain("Total a pagar");
      expect(texto()).not.toContain("R$ 0,00");
    });
  });
});

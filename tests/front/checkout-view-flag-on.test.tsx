// @vitest-environment jsdom
//
// Par do checkout-view-flag-off.test.tsx, mas com PAGAMENTO_ONLINE_LIGADO
// LIGADA — a metade da invariante que faltava. O bloqueador da rodada de
// correção 1 só existia neste caminho: `onClearCart()` roda ANTES de
// `setAguardandoPagamento(true)`, o React 18 agrupa os dois updates, e o
// render seguinte já tem carrinho vazio (cartTotal/shippingFee zerados) E a
// tela de pagamento — o Brick nascia com `valor: 0` enquanto o pedido já
// tinha sido gravado no banco com o total de verdade. Este teste falha se
// essa correção (congelar o total num estado próprio no momento do submit,
// como o orderId já é congelado) for revertida — é a prova por mutação
// pedida na revisão, ver o relatório da task para a saída do teste vermelho.
//
// `<PagamentoOnline>` é substituído por um dublê que só GRAVA as props
// recebidas — é exatamente o que este arquivo precisa auditar (`valor`), e
// evita depender do SDK real do Mercado Pago (que este arquivo não testa;
// isso já está coberto em pagamento-online.test.tsx, Task 4).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const clearCart = vi.fn();
const confettiMock = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const pagamentoOnlineProps: Array<{ orderId: string; valor: number }> = [];

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
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));

// Carrinho de R$100 + R$20 de frete — exatamente o cenário do bloqueador. O
// mock precisa ser REATIVO de verdade (não um objeto estático), porque o bug
// só existe na sequência real: `clearCart()` muta o estado, o CheckoutView
// re-renderiza (o mesmo lote de updates que também liga
// `aguardandoPagamento`), e SÓ NESSE PONTO `useCart()` é chamado de novo e
// devolve os valores zerados. Um dublê estático nunca reproduziria isso —
// devolveria sempre 100/20, mascarando o bug que a rodada de correção 1
// encontrou.
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
let mockShippingFee = 20;

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: mockCart,
    cartTotal: mockCartTotal,
    shippingFee: mockShippingFee,
    clearCart: () => {
      clearCart();
      // Espelha CartContext.tsx:690-706/726/741: setCart([]) e frete/CEP
      // zerados, cartTotal reduzindo sobre [] e shippingFee com o guard
      // `cart.length === 0`.
      mockCart = [];
      mockCartTotal = 0;
      mockShippingFee = 0;
    },
    selectedShippingOption: null,
    shippingCep: "38500-000",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// Idêntico ao par flag-off: o que este arquivo testa é o que o CheckoutView
// PASSA para createOrder, não a escolha de RPC em si (já provada em
// create-order-rpc.test.ts, Task 3).
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder }),
}));

vi.mock("canvas-confetti", () => ({ default: confettiMock }));

// Flag ligada — sem isso, "Pagar agora" nem aparece na lista para ser
// clicada.
vi.mock("@/lib/flags", () => ({
  PAGAMENTO_ONLINE_LIGADO: true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// Dublê do componente da Task 4: só grava as props recebidas. Renderizar o
// Brick de verdade (SDK externo, `mp-container`) não é o que esta task
// prova — é a Task 4 que já prova isso.
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: {
    orderId: string;
    valor: number;
    onErro: (msg: string) => void;
  }) => {
    pagamentoOnlineProps.push({ orderId: props.orderId, valor: props.valor });
    return null;
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// pagamento-online.test.tsx e do par flag-off.
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

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView com PAGAMENTO_ONLINE_LIGADO ligada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    clearCart.mockClear();
    confettiMock.mockClear();
    pagamentoOnlineProps.length = 0;
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
    mockShippingFee = 20;
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

  it("escolhe 'Pagar agora', chama createOrder com comPagamentoOnline:true, não solta confete, mostra a tela de aguardar e entrega o valor CONGELADO (não 0) ao PagamentoOnline", async () => {
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
      "Pagar agora (PIX ou cartão)",
    );
    expect(botaoOnline).toBeDefined();

    await act(async () => {
      botaoOnline!.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("guest-street", "Rua Teste");
      digitar("guest-number", "100");
      digitar("guest-neighborhood", "Centro");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    // O botão "Finalizar Pedido" só existe depois que useDeferredRender(380)
    // resolve — espera o tempo real, como o componente exige.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    );
    expect(botaoFinalizar).toBeDefined();
    expect(botaoFinalizar!.disabled).toBe(false);

    await act(async () => {
      botaoFinalizar!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(expect.anything(), {
      comPagamentoOnline: true,
    });

    // O front nunca declara pagamento: sem confete, sem tela de sucesso.
    expect(confettiMock).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toContain("Pedido Celebrado!");
    expect(hospedeiro.textContent).toContain("Finalize o pagamento");

    // A prova do bloqueador da rodada de correção 1: o total é 100 (produto)
    // + 20 (frete) = 120, gravado no pedido ANTES do onClearCart() zerar o
    // carrinho. Se o CheckoutView ler `finalTotal` (derivado do carrinho, já
    // limpo) em vez do valor congelado no submit, este número vem 0.
    expect(pagamentoOnlineProps).toHaveLength(1);
    expect(pagamentoOnlineProps[0]).toEqual({ orderId: "ped-999", valor: 120 });
  });
});

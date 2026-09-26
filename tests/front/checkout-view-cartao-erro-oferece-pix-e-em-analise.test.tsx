// @vitest-environment jsdom
//
// B1 e B3 da revisão de risco pré-publicação (26/09/2026, PR #666):
//
// B1 — em modo cartão, a caixa de erro não oferecia PIX: "Tentar de novo"
// remontava a tela com `metodoDoPedido` ainda em "cartao", e um Brick
// bloqueado pelo COEP (o próprio risco que o commit do cartão já declara)
// entrava em loop. Correção: um botão "Pagar com PIX" na caixa de erro
// quando `metodoDoPedido === "cartao"`, que troca o método e limpa o erro.
//
// B3 — cancelar um pedido com o cartão ainda em análise é DINHEIRO: o 409
// "Há um pagamento com cartão em análise para este pedido."
// (criar-pagamento/index.ts) aparecia como erro recuperável comum, com
// "Cancelar pedido e voltar ao carrinho" logo abaixo. Se o banco aprova
// DEPOIS do cancelamento, o cliente é cobrado por um pedido morto.
// Correção: detectar o 409 pelo campo `cartaoEmAnalise` (contrato do lado da
// edge) OU pelo texto exato como reserva (funciona antes e depois da edge
// mandar o campo), esconder "Cancelar pedido" e mostrar que o banco ainda
// está decidindo — a verificação periódica que o CheckoutView já roda
// continua de pé (não é tocada por este teste) e leva à confirmação sozinha
// se o banco aprovar.
//
// Andaime: MESMO modelo de checkout-view-cancelar-pagamento-falho.test.tsx
// (PagamentoOnline mocado, expõe `onErro`) somado ao mock de
// useConfigDoCartao de checkout-view-cartao-online.test.tsx (para chegar em
// `metodoDoPedido === "cartao"` pela UI de verdade).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigDoCartao } from "@/lib/config-do-cartao";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const pagamentoOnlineProps: Array<Record<string, unknown>> = [];

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

const mockUser: { id: string; email?: string } = {
  id: "user-1",
  email: "cliente@exemplo.com",
};
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
let mockShippingFee = 20;
let mockSelectedShippingOption: {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
} | null = {
  id: "opt-mock",
  name: "Entrega Padrão",
  price: 20,
  deliveryDays: 3,
  provider: "flat_fee",
};

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCartTotal,
      shippingFee: mockShippingFee,
      clearCart: () => {
        mockCart = [];
        mockCartTotal = 0;
        mockShippingFee = 0;
        mockSelectedShippingOption = null;
      },
      addToCart: vi.fn(),
      selectedShippingOption: mockSelectedShippingOption,
      shippingCep: "38500-000",
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// `null` = cartão não oferecido — sobrescrito por teste que precisa dele.
let mockConfigDoCartao: ConfigDoCartao | null = {
  credito: true,
  debito: true,
  parcelasMax: 6,
};
vi.mock("@/hooks/useConfigDoCartao", () => ({
  useConfigDoCartao: () => mockConfigDoCartao,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: { status: "cancelled" }, error: null }),
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

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: Record<string, unknown>) => {
    pagamentoOnlineProps.push(props);
    return null;
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
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

function botaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;

describe("CheckoutView — cartão: a caixa de erro oferece PIX (B1) e não deixa cancelar com o cartão em análise (B3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    createOrder.mockResolvedValue({ id: "ped-999" });
    updateOrderStatus.mockReset();
    updateOrderStatus.mockResolvedValue(undefined);
    onNavigate.mockClear();
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
    mockSelectedShippingOption = {
      id: "opt-mock",
      name: "Entrega Padrão",
      price: 20,
      deliveryDays: 3,
      provider: "flat_fee",
    };
    mockConfigDoCartao = { credito: true, debito: true, parcelasMax: 6 };
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

  /** Chega em "Finalize o pagamento" já com o cartão escolhido como método. */
  async function chegarNoPagamentoComCartao(
    CheckoutViewComponente: TelaCheckout,
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
      await esperarMicrotarefas();
    });

    const cartao = botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!;
    await act(async () => {
      cartao.click();
      await esperarMicrotarefas();
    });

    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      // Compra por transportadora exige CPF do destinatário para a etiqueta
      // — sem ele o Finalizar segue travado (mesmo achado do checkout
      // compacto, 23/09/2026).
      digitar("checkout-cpf", "11144477735");
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = botaoPorTexto(document.body, "Finalizar Pedido")!;
    await act(async () => {
      botaoFinalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("B1: em modo cartão, a caixa de erro recuperável tem 'Pagar com PIX'; clicar troca o método e limpa o erro", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    expect(pagamentoOnlineProps.at(-1)!.metodo).toBe("cartao");

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )("Não foi possível carregar o pagamento.", "recuperavel");
    });

    const pix = botaoPorTexto(hospedeiro, "Pagar com PIX");
    expect(pix).toBeDefined();

    await act(async () => {
      pix!.click();
    });

    // O erro sumiu (a caixa vermelha dá lugar ao <PagamentoOnline> de novo)
    // e a próxima montagem já é em PIX.
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(pagamentoOnlineProps.at(-1)!.metodo).toBe("pix");
  });

  it("B1: em modo PIX, a caixa de erro NÃO ganha o botão 'Pagar com PIX' (já está em PIX)", async () => {
    mockConfigDoCartao = null;
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
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("checkout-cpf", "11144477735");
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    const botaoFinalizar = botaoPorTexto(document.body, "Finalizar Pedido")!;
    await act(async () => {
      botaoFinalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(pagamentoOnlineProps.at(-1)!.metodo).toBe("pix");

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )("Não foi possível gerar a cobrança.", "recuperavel");
    });

    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(botaoPorTexto(hospedeiro, "Tentar de novo")).toBeDefined();
  });

  it("B3: 409 com cartaoEmAnalise:true esconde 'Cancelar pedido' e avisa que o banco está decidindo", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
          cartaoEmAnalise?: boolean,
        ) => void
      )(
        "Há um pagamento com cartão em análise para este pedido.",
        "recuperavel",
        true,
      );
    });

    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Seu cartão está em análise pelo banco. Aguarde a resposta; você será avisado aqui.",
    );
  });

  it("B3: MESMO sem o campo cartaoEmAnalise (edge antiga), a mensagem exata já basta como reserva", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )(
        "Há um pagamento com cartão em análise para este pedido.",
        "recuperavel",
      );
    });

    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Seu cartão está em análise pelo banco. Aguarde a resposta; você será avisado aqui.",
    );
  });

  it("controle: um 409 recuperável comum (sem o sinal de cartão em análise) continua oferecendo 'Cancelar pedido'", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )("Não foi possível gerar a cobrança.", "recuperavel");
    });

    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeDefined();
    expect(hospedeiro.textContent).not.toContain(
      "Seu cartão está em análise pelo banco",
    );
  });
});

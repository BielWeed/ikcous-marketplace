// @vitest-environment jsdom
//
// S1 (dinheiro, 04/10/2026, migration 20261198000000): na retomada do
// pagamento, "Cancelar pedido e voltar ao carrinho" agora passa pela edge
// `criar-pagamento` (ação `cancelar`), que anula a cobrança no Mercado Pago
// antes de cancelar no banco. Quando a edge NÃO cancela, `useOrders` lança
// `ErroCancelamentoNaoConcluido` com a frase dela (silent=true: sem toast) e
// esta tela tem de:
//   - mostrar a frase da edge (nunca o genérico, nunca levar ao carrinho);
//   - em análise / já pago: esconder o botão de cancelar (bater de novo dá a
//     mesma resposta) — mesmo tratamento da guarda P0001 da migration 80;
//   - recuperável: manter o botão (tentar de novo é a saída).
// Harness copiado de checkout-view-cancelar-pagamento-falho.test.tsx (mesmos
// dublês, mesma forma de chegar em "Finalize o pagamento").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const clearCart = vi.fn();
const addToCart = vi.fn();
const confettiMock = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const pagamentoOnlineOnErro: Array<
  (msg: string, categoria: "recuperavel" | "terminal") => void
> = [];

type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;

// Mutável porque a suíte precisa provar os dois lados: sessão autenticada
// (botão funciona) e convidado (botão não aparece — update_order_status_atomic
// recusa chamador sem auth.uid() desde o PEDIDO-010, #115).
let mockUser: { id: string } | null = { id: "user-1" };

// A calculadora de frete do checkout (cotação automática pelo endereço)
// tem suíte própria (shipping-calculator-*.test.tsx e
// checkout-frete-automatico-*.test.tsx). Aqui ela é neutra: não cota, não
// mexe na opção de frete que o teste preparou e não reporta status.
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

// Achado 1, rodada 7: mutável — `undefined` por padrão (a maioria dos
// testes deste arquivo não depende de WhatsApp), sobrescrito só no teste do
// beco sem saída.
let mockWhatsappNumber: string | undefined;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: mockWhatsappNumber,
    },
    isLoaded: true,
  }),
}));

// Um endereço padrão: o efeito de CheckoutView auto-seleciona o `is_default`
// assim que `addresses` chega não-vazio, o que satisfaz o guard
// `if (user && !selectedAddressId)` de handleSubmitEvent sem precisar
// simular o clique em "Selecionar endereço". Só é lido quando `mockUser`
// está preenchido — o teste de convidado não depende disto.
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

// Carrinho de R$100 + R$20 de frete — precisa ser reativo (como no par
// flag-on), porque a prova central deste arquivo é que os itens voltam
// depois que clearCart() já os zerou.
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
    quantity: 2,
    variantId: "var-azul",
    variantNames: "Cor: Azul",
  },
];
let mockCartTotal = 100;
let mockShippingFee = 20;
// Achado da revisão do bloco "o app para de inventar endereço" (18/08/2026):
// `shippingFee` positivo sem `selectedShippingOption` é exatamente o estado
// que o CheckoutView passou a barrar no botão "Finalizar Pedido" (a cotação
// que gerou R$20 aqui, em produção, só existe porque uma opção FOI
// selecionada — `shippingFee` de CartContext.tsx:758-762 só cai no valor
// fixo de fallback quando não há `selectedShippingOption`). Sem este objeto
// o mock representava um estado inatingível pela UI real, e mascarava o
// próprio defeito que este bloco fecha — mesmo ajuste de
// checkout-view-flag-on.test.tsx.
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
        clearCart();
        mockCart = [];
        mockCartTotal = 0;
        mockShippingFee = 0;
        mockSelectedShippingOption = null;
      },
      addToCart: (
        product: unknown,
        quantity: number,
        variantId?: string,
        variantNames?: string,
      ) => addToCart(product, quantity, variantId, variantNames),
      selectedShippingOption: mockSelectedShippingOption,
      shippingCep: "38500-000",
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// Achado 2, rodada 5: `mensagemAmigavelErroAtualizacaoStatus` fica com a
// implementação REAL (via `importOriginal`) — só `useOrders` é trocado pelo
// dublê. É ela quem decide se o texto cru da guarda P0001 (migration 80)
// passa direto para a tela ou vira o genérico.
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return { ...real, useOrders: () => ({ createOrder, updateOrderStatus }) };
});

// BLOQUEIO 1 da revisão do #197: o sinal de rede que já existe no
// repositório (mesmo hook usado por ShippingCalculator) — mutável para
// simular o cliente perdendo conexão entre o clique e a resposta.
let mockIsOffline = false;
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mockIsOffline,
}));

// BLOQUEIO 1 e 2: a correção não confia no retorno de updateOrderStatus —
// releitura o pedido depois. `mockStatusAposCancelar` é o que o "banco"
// devolve nessa releitura; `mockErroLeituraStatus` simula a releitura em
// si falhando (rede caiu de novo bem no meio).
let mockStatusAposCancelar: string | null = "cancelled";
let mockErroLeituraStatus: { message: string } | null = null;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve(
              mockErroLeituraStatus
                ? { data: null, error: mockErroLeituraStatus }
                : { data: { status: mockStatusAposCancelar }, error: null },
            ),
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

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: {
    orderId: string;
    valor: number;
    onErro: (msg: string, categoria: "recuperavel" | "terminal") => void;
  }) => {
    pagamentoOnlineOnErro.push(props.onErro);
    return null;
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
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

describe("CheckoutView — retomada: cancelar pela edge (S1) mostra o desfecho dela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    updateOrderStatus.mockReset();
    updateOrderStatus.mockResolvedValue(undefined);
    clearCart.mockClear();
    addToCart.mockClear();
    confettiMock.mockClear();
    onNavigate.mockClear();
    pagamentoOnlineOnErro.length = 0;
    mockUser = { id: "user-1" };
    mockIsOffline = false;
    mockStatusAposCancelar = "cancelled";
    mockErroLeituraStatus = null;
    mockWhatsappNumber = undefined;
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
        quantity: 2,
        variantId: "var-azul",
        variantNames: "Cor: Azul",
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

  async function chegarNaTelaDeAguardarPagamento(
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

    const botaoOnline = localizarBotaoPorTexto(
      hospedeiro,
      "Pagar agora com PIX",
    )!;

    await act(async () => {
      botaoOnline.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      // TRANSPORTADORA EXIGE CPF (checkout compacto + CPF, 23/09/2026): o
      // caminho "Pagar agora com PIX" só existe com transportadora — sem
      // CPF válido o formulário fica inválido e o Finalizar nunca chega à
      // tela de aguardar pagamento que este teste precisa.
      digitar("checkout-cpf", "11144477735");
      // Campos de endereço de convidado só existem no DOM quando `!user` —
      // com sessão, o endereço vem do mock de useAddresses (auto-selecionado
      // pelo efeito de CheckoutView).
      if (!mockUser) {
        digitar("guest-street", "Rua Teste");
        digitar("guest-number", "100");
        digitar("guest-neighborhood", "Centro");
      }
      await esperarMicrotarefas();
      await esperarMicrotarefas();
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
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  async function cancelarNaTelaDeErro(erroDaEdge: unknown) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);
    updateOrderStatus.mockRejectedValueOnce(erroDaEdge);
    // A edge não cancelou: a releitura do banco confirma `pending`.
    mockStatusAposCancelar = "pending";
    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Este pagamento foi recusado e não pode ser tentado novamente.",
        "terminal",
      );
    });
    const botaoCancelar = localizarBotaoPorTexto(
      hospedeiro,
      "Cancelar pedido e voltar ao carrinho",
    )!;
    expect(botaoCancelar).toBeDefined();
    await act(async () => {
      botaoCancelar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    // silent=true: quem mostra o desfecho é a tela, num banner fixo.
    expect(updateOrderStatus).toHaveBeenCalledWith(
      "ped-999",
      "cancelled",
      undefined,
      true,
    );
  }

  it.each([
    [
      "em_analise",
      "Há um pagamento com cartão em análise para este pedido. Ele não pode ser cancelado agora — aguarde a confirmação do banco.",
    ],
    [
      "ja_pago",
      "Este pedido acabou de ser pago e não foi cancelado. A confirmação do pagamento aparece em instantes.",
    ],
  ] as const)(
    "edge responde %s: a frase dela aparece, NÃO volta ao carrinho, e o botão de cancelar some",
    async (desfecho, mensagem) => {
      const { ErroCancelamentoNaoConcluido } = await import(
        "@/hooks/useOrders"
      );
      await cancelarNaTelaDeErro(
        new ErroCancelamentoNaoConcluido({ desfecho, mensagem }),
      );

      expect(onNavigate).not.toHaveBeenCalledWith("cart");
      expect(addToCart).not.toHaveBeenCalled();
      expect(hospedeiro.textContent).toContain(mensagem);
      expect(hospedeiro.textContent).not.toContain(
        "Não foi possível confirmar o cancelamento",
      );
      expect(
        localizarBotaoPorTexto(
          hospedeiro,
          "Cancelar pedido e voltar ao carrinho",
        ),
      ).toBeUndefined();
    },
  );

  it("edge responde recuperável: a frase dela aparece, NÃO volta ao carrinho, e o botão de cancelar CONTINUA (tentar de novo é a saída)", async () => {
    const { ErroCancelamentoNaoConcluido } = await import("@/hooks/useOrders");
    const mensagem =
      "Não foi possível confirmar o cancelamento com o Mercado Pago agora. O pedido NÃO foi cancelado — tente de novo em instantes.";
    await cancelarNaTelaDeErro(
      new ErroCancelamentoNaoConcluido({ desfecho: "recuperavel", mensagem }),
    );

    expect(onNavigate).not.toHaveBeenCalledWith("cart");
    expect(addToCart).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain(mensagem);
    expect(
      localizarBotaoPorTexto(
        hospedeiro,
        "Cancelar pedido e voltar ao carrinho",
      ),
    ).toBeDefined();
  });

  it("controle: edge cancelou (updateOrderStatus resolve e a releitura confirma) — volta ao carrinho com os itens, como sempre", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);
    mockStatusAposCancelar = "cancelled";
    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Este pagamento foi recusado e não pode ser tentado novamente.",
        "terminal",
      );
    });
    await act(async () => {
      localizarBotaoPorTexto(
        hospedeiro,
        "Cancelar pedido e voltar ao carrinho",
      )!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(onNavigate).toHaveBeenCalledWith("cart");
    expect(addToCart).toHaveBeenCalled();
  });
});

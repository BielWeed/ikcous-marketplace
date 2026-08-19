// @vitest-environment jsdom
//
// CHECKOUT-070 (#197): saída do cliente cujo pagamento online falhou.
// Modelo estrutural copiado de checkout-view-flag-on.test.tsx (mesmos
// dublês, mesma forma de chegar em "Finalize o pagamento") — este arquivo só
// acrescenta o que muda a partir de lá: o botão "Cancelar pedido e voltar ao
// carrinho".
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

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
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
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus }),
}));

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
  PAGAMENTO_ONLINE_LIGADO: true,
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

describe("CheckoutView — saída do pagamento online falho (CHECKOUT-070, #197)", () => {
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

  it("caso terminal: 'Cancelar pedido e voltar ao carrinho' é a ÚNICA ação", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Este pagamento foi recusado e não pode ser tentado novamente.",
        "terminal",
      );
    });

    expect(
      localizarBotaoPorTexto(hospedeiro, "Tentar de novo"),
    ).toBeUndefined();
    expect(
      localizarBotaoPorTexto(
        hospedeiro,
        "Cancelar pedido e voltar ao carrinho",
      ),
    ).toBeDefined();
  });

  it("caso recuperável: o botão de saída aparece JUNTO com 'Tentar de novo', sem roubar o lugar dele", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Não foi possível gerar a cobrança.",
        "recuperavel",
      );
    });

    expect(localizarBotaoPorTexto(hospedeiro, "Tentar de novo")).toBeDefined();
    expect(
      localizarBotaoPorTexto(
        hospedeiro,
        "Cancelar pedido e voltar ao carrinho",
      ),
    ).toBeDefined();
  });

  it("clicar cancela o pedido pela mesma RPC da #180 (update_order_status_atomic via updateOrderStatus) e devolve os itens ao carrinho já esvaziado", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    // clearCart já rodou no submit — o carrinho global está vazio agora.
    expect(mockCart).toHaveLength(0);

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

    await act(async () => {
      botaoCancelar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(updateOrderStatus).toHaveBeenCalledWith(
      "ped-999",
      "cancelled",
      undefined,
      true,
    );
    // O item devolvido é o MESMO que estava no pedido no momento do submit —
    // não o carrinho (já vazio) lido de novo. Fixture com variantId,
    // variantNames e quantity:2 (achado "antes de crescer" da revisão do
    // #197): uma implementação que perdesse variação ou quantidade na
    // reidratação (`addToCart(item.product, 1)`, issues #78/#79) derrubaria
    // esta asserção.
    expect(addToCart).toHaveBeenCalledTimes(1);
    expect(addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ id: "prod-1" }),
      2,
      "var-azul",
      "Cor: Azul",
    );
    expect(onNavigate).toHaveBeenCalledWith("cart");
  });

  it("clique duplo cancela o pedido uma vez só", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    // Promise que só resolve depois dos dois cliques — simula a latência de
    // rede real, onde os dois cliques acontecem ANTES da primeira resposta.
    let resolverChamada: () => void = () => {};
    updateOrderStatus.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolverChamada = resolve;
        }),
    );

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

    await act(async () => {
      botaoCancelar.click();
      botaoCancelar.click();
    });

    // Achado da 2ª revisão: sem esta asserção, trocar `setIsCancelandoPedido(true)`
    // por `(false)` sobrevivia a toda a suíte — a reentrância é barrada pelo ref
    // síncrono, então nenhum teste percebia o botão deixar de sinalizar
    // "processando". O cliente ficaria sem retorno visual nenhum durante a
    // espera de rede, justo na tela em que ele já viu um pagamento falhar.
    expect(botaoCancelar.disabled).toBe(true);

    resolverChamada();
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
  });

  it("falha genérica no cancelamento (RPC falha E a releitura não confirma) mostra erro e NÃO leva ao carrinho", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    updateOrderStatus.mockRejectedValueOnce(
      new Error("Falha de rede ao cancelar."),
    );
    // BLOQUEIO 1/2 da revisão do #197: não basta a RPC falhar — a correção
    // relê o pedido antes de decidir. Aqui a releitura também não confirma
    // 'cancelled' (pedido segue 'pending'), então é falha de verdade.
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

    await act(async () => {
      botaoCancelar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(onNavigate).not.toHaveBeenCalledWith("cart");
    expect(addToCart).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain(
      "Não foi possível confirmar o cancelamento",
    );
    // Continua na tela de aguardar pagamento — não desaparece nem finge êxito.
    expect(hospedeiro.textContent).toContain(
      "Cancelar pedido e voltar ao carrinho",
    );
  });

  it("pedido já não-pendente, mas a releitura confirma 'cancelled' (expirado pelo pg_cron antes do clique): não tenta creditar estoque de novo — só devolve ao carrinho", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    updateOrderStatus.mockRejectedValueOnce(
      new Error("Apenas pedidos pendentes podem ser cancelados pelo usuário."),
    );
    // A guarda da RPC recusa por dois motivos possíveis com a MESMA
    // mensagem P0001 (achado da revisão do #197): o pg_cron já cancelou OU
    // o lojista adiantou. A releitura abaixo (default do beforeEach:
    // 'cancelled') é o que distingue este caso do de "processing" logo
    // adiante — e é ela, não a string do erro, que decide se navega.
    mockStatusAposCancelar = "cancelled";

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

    await act(async () => {
      botaoCancelar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    // A RPC foi chamada UMA vez (não houve segunda tentativa que pudesse
    // creditar estoque em dobro), e o cliente é levado ao carrinho porque a
    // releitura confirmou 'cancelled' — o estoque já voltou pela varredura
    // do pg_cron.
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(addToCart).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("cart");
  });

  it("BLOQUEIO 2 (#197): pedido adiantado para 'processing' pelo lojista — mesma mensagem P0001 da RPC, mas a releitura NÃO confirma 'cancelled', então NÃO navega e avisa que não foi cancelado", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    updateOrderStatus.mockRejectedValueOnce(
      new Error("Apenas pedidos pendentes podem ser cancelados pelo usuário."),
    );
    // Único ponto de diferença em relação ao teste do pg_cron acima: aqui o
    // "banco" ainda tem o pedido vivo, sendo preparado.
    mockStatusAposCancelar = "processing";

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

    await act(async () => {
      botaoCancelar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    // Nem o carrinho global é restaurado nem a navegação acontece — o
    // cliente teria pego a mesma unidade que continua reservada no pedido.
    expect(addToCart).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalledWith("cart");
    expect(hospedeiro.textContent).toContain("não está mais pendente");
    expect(hospedeiro.textContent).toContain(
      "Cancelar pedido e voltar ao carrinho",
    );
  });

  it("BLOQUEIO 1 (#197): sem conexão, o clique NÃO chama a RPC, NÃO navega e avisa que é preciso se reconectar", async () => {
    // Ligado ANTES do render — a leitura de `isOffline` acontece no render
    // do componente (hook `useOnlineStatus`), não no clique. O caminho mais
    // provável descrito na revisão (perder sinal no meio do pagamento) já
    // deixa o app offline bem antes deste clique.
    mockIsOffline = true;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

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

    await act(async () => {
      botaoCancelar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    // Sem rede o ramo offline de useOrders empilharia a mudança e
    // resolveria sem lançar (ele serve o admin) — por isso o front nem
    // chega a chamar updateOrderStatus quando já sabe que está offline.
    expect(updateOrderStatus).not.toHaveBeenCalled();
    expect(addToCart).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalledWith("cart");
    expect(hospedeiro.textContent).toContain("conexão");
    expect(hospedeiro.textContent).toContain(
      "Cancelar pedido e voltar ao carrinho",
    );
  });

  // Reescrito (16/08/2026, pagamento online exige conta — decisão do
  // Gabriel, achado da revisão): este teste chamava
  // `chegarNaTelaDeAguardarPagamento` já como CONVIDADO — isso sim deixou
  // de ser alcançável pela UI, porque sem sessão o clique em "Pagar agora
  // com PIX" navega para "auth" em vez de selecionar o método (ver
  // `tests/front/checkout-view-flag-on.test.tsx`, "convidado: clicar em
  // 'Pagar agora com PIX' NÃO seleciona o método"). Mas isso só cobre quem
  // TENTA ENTRAR sem conta — não cobre o cliente LOGADO cuja sessão CAI
  // com a tela já aberta (token vencendo, refresh falhando):
  // `aguardandoPagamento` é `useState` local, o componente não desmonta, e
  // o próximo render lê `user === null` — exatamente o ramo `user ?
  // <botão cancelar> : <texto explicando>` que este teste prova.
  it("sessão cai (refresh do token falha) com a tela de erro do pagamento já aberta: o botão de cancelar SOME e o texto dos 30 min aparece — mesma tela, sem desmontar", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Este pagamento foi recusado e não pode ser tentado novamente.",
        "terminal",
      );
    });

    expect(
      localizarBotaoPorTexto(
        hospedeiro,
        "Cancelar pedido e voltar ao carrinho",
      ),
    ).toBeDefined();

    // Sessão cai DEPOIS de já estar na tela — não é o convidado entrando
    // (isso a UI já bloqueia antes de chegar aqui, ver o comentário acima).
    // `raiz.render` de novo com o MESMO tipo de componente re-renderiza
    // (React reconcilia, não desmonta) — é assim que `useAuth()` lê o
    // `mockUser` atualizado, como uma renderização disparada pelo
    // AuthContext real faria quando `setUser(null)` roda.
    mockUser = null;
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    expect(
      localizarBotaoPorTexto(
        hospedeiro,
        "Cancelar pedido e voltar ao carrinho",
      ),
    ).toBeUndefined();
    // BLOQUEIO 3 (#197): tela morta vira tela que explica — que não dá para
    // cancelar por aqui, e a alternativa (entrar na conta).
    //
    // NÃO afirmar "30 minutos" aqui: achado da 5ª revisão (16/08/2026) — esse
    // trecho também está no cabeçalho da tela de espera, que renderiza SEMPRE,
    // fora do ramo `user ? botão : parágrafo`. A asserção passava mesmo com o
    // parágrafo do convidado apagado por completo, e o comentário anterior
    // afirmava uma prova que ela não fazia. Os dois trechos abaixo são
    // exclusivos deste parágrafo.
    expect(hospedeiro.textContent).toContain(
      "não é possível cancelar por aqui",
    );
    expect(hospedeiro.textContent).toContain("entre na sua conta");
  });
});

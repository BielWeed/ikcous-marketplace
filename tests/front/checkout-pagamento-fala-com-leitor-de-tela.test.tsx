// @vitest-environment jsdom
//
// O PAGAMENTO FALA COM O LEITOR DE TELA (caça TalkBack/VoiceOver, 27/11/2026).
// O erro do PIX/cartão trocava a tela em silêncio: a caixa vermelha só virava
// aviso falado com `anunciar`, a caixa âmbar nunca, e o foco caía no corpo da
// página quando o formulário sumia. E a forma de pagamento mudava sozinha
// (transportadora, forma desligada pela loja) sem ninguém dizer.
// Andaime copiado de checkout-view-cancelar-pagamento-falho.test.tsx (mesmos
// dublês, mesma forma de chegar em "Finalize o pagamento").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const clearCart = vi.fn();
const addToCart = vi.fn();
const confettiMock = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const pagamentoOnlineOnErro: Array<
  (
    msg: string,
    categoria: "recuperavel" | "terminal",
    sinal?: "cartaoEmAnalise" | "semCobranca",
  ) => void
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
// A conferência da sessão antes de enviar (caça 7) tem suíte própria
// (checkout-pedido-chave-voltar-e-sessao.test.tsx); aqui a sessão está viva.
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

// Achado 1, rodada 7: mutável — `undefined` por padrão (a maioria dos
// testes deste arquivo não depende de WhatsApp), sobrescrito só no teste do
// beco sem saída.
let mockWhatsappNumber: string | undefined;
// Mutável: o teste da forma desligada pela loja liga só o dinheiro.
let mockFormasNaEntrega: string[] | undefined;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: mockWhatsappNumber,
      formasPagamentoEntrega: mockFormasNaEntrega,
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
  useAddresses: () =>
    comReleituraDeEnderecos({
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
    onErro: (typeof pagamentoOnlineOnErro)[number];
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

describe("CheckoutView — o pagamento fala com o leitor de tela", () => {
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
    mockFormasNaEntrega = undefined;
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
    sessionStorage.clear();
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

  // O formulário (PagamentoOnline) some quando o erro entra: o navegador
  // larga o foco no corpo da página. O dublê não tem foco nenhum, então o
  // teste solta o foco do título "Finalize o pagamento" à mão.
  function largarOFoco() {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
  }

  function paragrafoComTexto(texto: string): HTMLElement | undefined {
    return [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.includes(texto),
    );
  }

  function avisoDaFormaDePagamento(): HTMLElement {
    const regiao = document.getElementById(
      "checkout-aviso-da-forma-de-pagamento",
    );
    expect(regiao).not.toBeNull();
    return regiao!;
  }

  it("erro do PIX vindo do formulário vira aviso falado, e o foco perdido vai para o texto do erro", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);
    largarOFoco();

    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Não foi possível gerar o QR code do PIX.",
        "recuperavel",
      );
    });

    const aviso = paragrafoComTexto("Não foi possível gerar o QR code do PIX.");
    expect(document.activeElement).toBe(aviso);
    // Um canal só (lote 486): o foco já faz o leitor ler o texto; com
    // `role="alert"` no MESMO elemento, VoiceOver/NVDA leem duas vezes.
    expect(aviso?.getAttribute("role")).toBeNull();
    expect(hospedeiro.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  // O erro que já levou o foco troca de frase sem a cliente tocar em nada (a
  // verificação periódica fecha o pedido: "…e o prazo para pagar acabou"). O
  // foco já estava no texto, então nada o movia, e o alerta voltava no MESMO
  // elemento junto com a troca de texto — o leitor de tela pode calar. A frase
  // nova tem de nascer num elemento novo, que recebe o foco (um canal só).
  it("erro trocado com o foco no texto: a frase nova é outro elemento, recebe o foco e fala uma vez", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);
    largarOFoco();

    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Não foi possível gerar o QR code do PIX.",
        "recuperavel",
      );
    });
    const antigo = paragrafoComTexto(
      "Não foi possível gerar o QR code do PIX.",
    );
    expect(document.activeElement).toBe(antigo);

    const fechou =
      "O pagamento com cartão não foi concluído, e o prazo para pagar este pedido acabou.";
    await act(async () => {
      pagamentoOnlineOnErro[0](fechou, "terminal");
    });

    const novo = paragrafoComTexto(fechou);
    expect(novo).toBeDefined();
    expect(
      novo,
      "a frase nova reaproveitou o elemento que já tinha o foco",
    ).not.toBe(antigo);
    expect(document.activeElement).toBe(novo);
    expect(novo?.getAttribute("role")).toBeNull();
    expect(hospedeiro.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it("'Tentar de novo' some ao tocar: a falha seguinte também fala e recebe o foco", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Não foi possível gerar o QR code do PIX.",
        "recuperavel",
      );
    });
    const tentarDeNovo = localizarBotaoPorTexto(hospedeiro, "Tentar de novo")!;
    tentarDeNovo.focus();
    await act(async () => {
      tentarDeNovo.click();
    });
    // O botão saiu da tela junto com a caixa: o foco ficou no vazio.
    expect(document.activeElement).toBe(document.body);
    const remontado = pagamentoOnlineOnErro.at(-1)!;
    expect(pagamentoOnlineOnErro.length).toBeGreaterThan(1);

    const demorou =
      "O Pix está demorando mais que o normal para ser gerado. Verifique sua conexão e toque em Tentar de novo.";
    await act(async () => {
      remontado(demorou, "recuperavel");
    });

    const aviso = paragrafoComTexto(demorou);
    expect(document.activeElement).toBe(aviso);
    expect(aviso?.getAttribute("role")).toBeNull();
  });

  it("caixa âmbar (cobrança do cartão em dúvida na tela do PIX) fala e recebe o foco perdido", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);
    largarOFoco();

    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Erro qualquer do servidor",
        "recuperavel",
        "cartaoEmAnalise",
      );
    });

    const aviso = paragrafoComTexto(
      "Não conseguimos confirmar se a tentativa de pagamento com cartão",
    );
    expect(aviso).toBeDefined();
    expect(document.activeElement).toBe(aviso);
    expect(aviso?.getAttribute("role")).toBeNull();
    expect(hospedeiro.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it("caixa âmbar terminal (frase da edge) também fala", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    const frase =
      "O prazo deste PIX venceu antes do pagamento ser confirmado. Faça um pedido novo para gerar um QR code novo.";
    await act(async () => {
      pagamentoOnlineOnErro[0](frase, "terminal", "cartaoEmAnalise");
    });

    expect(paragrafoComTexto(frase)?.getAttribute("role")).toBe("alert");
  });

  it("foco que está num lugar vivo da tela não é puxado para o erro", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);
    const titulo = [...hospedeiro.querySelectorAll("h1")].find((h) =>
      h.textContent?.includes("Finalize o pagamento"),
    )!;
    titulo.focus();

    await act(async () => {
      pagamentoOnlineOnErro[0](
        "Não foi possível gerar o QR code do PIX.",
        "recuperavel",
      );
    });

    expect(document.activeElement).toBe(titulo);
    // Sem o foco, quem fala é o alerta.
    expect(
      paragrafoComTexto(
        "Não foi possível gerar o QR code do PIX.",
      )?.getAttribute("role"),
    ).toBe("alert");
  });

  it("transportadora: a troca automática para o PIX no app é anunciada, e a escolha da própria cliente não", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const regiao = avisoDaFormaDePagamento();
    expect(regiao.getAttribute("role")).toBe("status");
    expect(regiao.textContent).toBe(
      "Forma de pagamento alterada para Pagar agora com PIX.",
    );

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Pagar agora com PIX")!.click();
    });
    expect(avisoDaFormaDePagamento().textContent).toBe("");
  });

  it("a loja desligou a forma marcada: a troca para a que sobrou é anunciada", async () => {
    mockUser = null;
    mockFormasNaEntrega = ["cash"];
    mockSelectedShippingOption = {
      id: "local-delivery",
      name: "Entrega da loja",
      price: 20,
      deliveryDays: 1,
      provider: "local",
    };
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    expect(avisoDaFormaDePagamento().textContent).toBe(
      "Forma de pagamento alterada para Dinheiro na Entrega.",
    );
  });

  it("sem troca automática, a região existe e fica calada", async () => {
    mockSelectedShippingOption = {
      id: "local-delivery",
      name: "Entrega da loja",
      price: 20,
      deliveryDays: 1,
      provider: "local",
    };
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    expect(avisoDaFormaDePagamento().textContent).toBe("");
  });

  // Lote 486: o aviso nasce da FORMA trocada, não do rótulo. Virar retirada
  // troca "na Entrega" por "na Retirada" no texto da opção, mas a forma é a
  // mesma: a região não pode falar de novo.
  it("virar retirada não repete o aviso: a forma não mudou, só o rótulo", async () => {
    mockUser = null;
    mockFormasNaEntrega = ["cash"];
    mockSelectedShippingOption = {
      id: "local-delivery",
      name: "Entrega da loja",
      price: 20,
      deliveryDays: 1,
      provider: "local",
    };
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const desenhar = () =>
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    await act(async () => {
      desenhar();
    });
    expect(avisoDaFormaDePagamento().textContent).toBe(
      "Forma de pagamento alterada para Dinheiro na Entrega.",
    );

    mockSelectedShippingOption = {
      id: "store-pickup",
      name: "Retirar na loja",
      price: 0,
      deliveryDays: 0,
      provider: "local",
    };
    await act(async () => {
      desenhar();
    });
    // A tela mudou mesmo para retirada (senão o teste não prova nada).
    expect(
      localizarBotaoPorTexto(hospedeiro, "Dinheiro na Retirada")?.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(avisoDaFormaDePagamento().textContent).not.toContain("Retirada");

    // E voltar para a entrega também não refala o aviso antigo.
    mockSelectedShippingOption = {
      id: "local-delivery",
      name: "Entrega da loja",
      price: 20,
      deliveryDays: 1,
      provider: "local",
    };
    await act(async () => {
      desenhar();
    });
    expect(avisoDaFormaDePagamento().textContent).toBe("");
  });

  // `CheckoutViewDaConta`: a MESMA instância atravessa a queda da sessão (o
  // `CheckoutView` remonta pela chave da conta e começaria do zero).
  it("a sessão caiu com o PIX do app marcado: a volta para o Pix na entrega é anunciada", async () => {
    mockSelectedShippingOption = {
      id: "local-delivery",
      name: "Entrega da loja",
      price: 20,
      deliveryDays: 1,
      provider: "local",
    };
    const { CheckoutViewDaConta } = await import(
      "@/views/customer/CheckoutView"
    );
    const desenhar = () =>
      raiz.render(
        <CheckoutViewDaConta
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    await act(async () => {
      desenhar();
    });
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Pagar agora com PIX")!.click();
    });
    expect(avisoDaFormaDePagamento().textContent).toBe("");

    mockUser = null;
    await act(async () => {
      desenhar();
    });
    expect(
      localizarBotaoPorTexto(hospedeiro, "Pix na Entrega")?.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(avisoDaFormaDePagamento().textContent).toBe(
      "Forma de pagamento alterada para Pix na Entrega.",
    );
  });

  it("o troco do rascunho remarca o dinheiro em silêncio: é a escolha dela voltando", async () => {
    mockSelectedShippingOption = {
      id: "local-delivery",
      name: "Entrega da loja",
      price: 20,
      deliveryDays: 1,
      provider: "local",
    };
    const { salvarRascunhoDoCheckout } = await import(
      "@/lib/rascunho-do-checkout"
    );
    salvarRascunhoDoCheckout(sessionStorage, {
      nome: "",
      whatsapp: "",
      cep: "",
      numero: "",
      rua: "",
      bairro: "",
      cidade: "",
      estado: "",
      complemento: "",
      notas: "",
      trocoPara: "200",
      cupom: null,
      contaDosDados: "user-1",
    });
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    expect(
      localizarBotaoPorTexto(hospedeiro, "Dinheiro na Entrega")?.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(avisoDaFormaDePagamento().textContent).toBe("");
  });
});
